import { t, authenticatedProcedure, scopedProcedure } from "@server/trpc";
import { z } from "zod";
import { organizationService } from "@server/services/organization.service";
import { TRPCError } from "@trpc/server";
import { SupportedLanguage } from "@server/types/language.types";
import { DateFormat, TimeFormat, Timezone } from "@server/types/organization-settings.types";
import { AppDataSource } from "@server/database/data-source";
import { Organization } from "@server/entities/organization.entity";
import { UserOrganization } from "@server/entities/user-organization.entity";
import { User } from "@server/entities/user.entity";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { auditLogService } from "@server/services/audit-log.service";
import { handleUpload } from "@server/lib/upload-helper";
import { StorageService } from "@server/services/storage.service";

/**
 * Helper function to count active owners in an organization
 */
async function getOwnerCount(organizationId: string): Promise<number> {
  const userOrgRepository = AppDataSource.getRepository(UserOrganization);
  return await userOrgRepository.count({
    where: {
      organizationId,
      role: "owner",
      isActive: true,
    },
  });
}

const updateSettingsSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  defaultLanguage: z.nativeEnum(SupportedLanguage).optional(),
  dateFormat: z.nativeEnum(DateFormat).optional(),
  timeFormat: z.nativeEnum(TimeFormat).optional(),
  timezone: z.nativeEnum(Timezone).optional(),
  defaultAgentId: z.string().uuid().nullable().optional(),
  testModeDefault: z.boolean().optional(),
});

export const organizationsRouter = t.router({
  // ============================================================================
  // ORGANIZATION CREATION
  // ============================================================================

  /**
   * Create a new organization and add the current user as owner
   * Requires: authenticated user
   */
  create: authenticatedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        slug: z.string().min(1).max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { name, slug: customSlug } = input;

      // Use transaction for atomicity
      return await AppDataSource.transaction(async (manager) => {
        const organizationRepository = manager.getRepository(Organization);
        const userOrgRepository = manager.getRepository(UserOrganization);

        // Generate or validate slug
        let orgSlug: string;
        if (customSlug) {
          // User provided a custom slug, check if it's available
          const existingOrg = await organizationService.findBySlug(customSlug);
          if (existingOrg) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Organization slug already exists",
            });
          }
          orgSlug = customSlug;
        } else {
          // Generate a unique slug automatically
          orgSlug = await organizationService.generateUniqueSlug(name);
        }

        // Create the organization
        const organization = organizationRepository.create({
          name,
          slug: orgSlug,
          isActive: true,
          limits: {
            maxUsers: 5,
            maxDocuments: 100,
            maxApiKeys: 10,
            maxJobs: 50,
            maxStorageGb: 1,
          },
        });

        await organizationRepository.save(organization);

        // Add the current user as owner
        const userOrg = userOrgRepository.create({
          userId: ctx.user!.id,
          organizationId: organization.id,
          role: "owner",
          isActive: true,
          joinedAt: new Date(),
        });

        await userOrgRepository.save(userOrg);

        return {
          success: true,
          message: "Organization created successfully",
          data: {
            id: organization.id,
            name: organization.name,
            slug: organization.slug,
            role: userOrg.role,
            permissions: userOrg.permissions,
          },
        };
      }).then(async (result) => {
        // Log audit event after transaction completes
        // This ensures the organization exists in the database before creating the audit log
        try {
          await auditLogService.logOrganizationCreated(
            ctx.user!.id,
            result.data.id,
            {
              name: result.data.name,
              slug: result.data.slug,
            },
          );
        } catch (error) {
          console.error("Failed to create audit log:", error);
        }
        return result;
      });
    }),

  // ============================================================================
  // ORGANIZATION SETTINGS
  // ============================================================================

  getSettings: scopedProcedure(RESOURCES.ORGANIZATION_SETTINGS, ACTIONS.READ).query(
    async ({ ctx }) => {
      const organization = await organizationService.findOneWithUrls(ctx.organizationId!);

      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      return {
        name: organization.name,
        defaultLanguage: organization.defaultLanguage,
        dateFormat: organization.dateFormat,
        timeFormat: organization.timeFormat,
        timezone: organization.timezone,
        defaultAgentId: organization.defaultAgentId,
        testModeDefault: organization.settings?.testModeDefault || false,
        logoUrl: organization.logoUrl || null,
      };
    },
  ),

  updateSettings: scopedProcedure(RESOURCES.ORGANIZATION_SETTINGS, ACTIONS.UPDATE)
    .input(updateSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      const organization = await organizationService.findOne(ctx.organizationId!);

      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      // Extract testModeDefault from input as it goes into the settings JSONB field
      const { testModeDefault, ...topLevelFields } = input;

      // Prepare update payload
      const updatePayload: any = {
        ...topLevelFields,
      };

      // Handle testModeDefault in settings JSONB field
      if (testModeDefault !== undefined) {
        updatePayload.settings = {
          ...(organization.settings || {}),
          testModeDefault,
        };
      }

      const updatedOrg = await organizationService.update(ctx.organizationId!, updatePayload);

      return {
        success: true,
        message: "Settings updated successfully",
        data: {
          name: updatedOrg.name,
          defaultLanguage: updatedOrg.defaultLanguage,
          dateFormat: updatedOrg.dateFormat,
          timeFormat: updatedOrg.timeFormat,
          timezone: updatedOrg.timezone,
          defaultAgentId: updatedOrg.defaultAgentId,
          testModeDefault: updatedOrg.settings?.testModeDefault || false,
        },
      };
    }),

  // ============================================================================
  // ORGANIZATION MEMBER MANAGEMENT
  // ============================================================================

  /**
   * List all members of the organization with pagination and search
   * Requires: organization_members:read scope
   */
  listMembers: scopedProcedure(RESOURCES.ORGANIZATION_MEMBERS, ACTIONS.READ)
    .input(
      z
        .object({
          pagination: z
            .object({
              page: z.number().min(1).default(1),
              limit: z.number().min(1).max(100).default(20),
            })
            .optional(),
          search: z.string().optional(),
          role: z.enum(["owner", "admin", "contributor", "member", "viewer"]).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Organization ID required",
        });
      }

      const userOrgRepository = AppDataSource.getRepository(UserOrganization);

      // Build query
      const queryBuilder = userOrgRepository
        .createQueryBuilder("userOrg")
        .leftJoinAndSelect("userOrg.user", "user")
        .where("userOrg.organizationId = :organizationId", {
          organizationId: ctx.organizationId,
        });

      // Apply search filter
      if (input?.search) {
        queryBuilder.andWhere(
          "(LOWER(user.email) LIKE :search OR LOWER(user.firstName) LIKE :search OR LOWER(user.lastName) LIKE :search)",
          { search: `%${input.search.toLowerCase()}%` },
        );
      }

      // Apply role filter
      if (input?.role) {
        queryBuilder.andWhere("userOrg.role = :role", { role: input.role });
      }

      // Get total count
      const total = await queryBuilder.getCount();

      // Apply pagination
      const page = input?.pagination?.page || 1;
      const limit = input?.pagination?.limit || 20;
      const offset = (page - 1) * limit;

      queryBuilder.orderBy("userOrg.createdAt", "ASC").skip(offset).take(limit);

      const members = await queryBuilder.getMany();

      const items = members.map((userOrg) => ({
        id: userOrg.id,
        userId: userOrg.userId,
        email: userOrg.user.email,
        firstName: userOrg.user.firstName,
        lastName: userOrg.user.lastName,
        role: userOrg.role,
        permissions: userOrg.permissions,
        isActive: userOrg.isActive,
        joinedAt: userOrg.joinedAt,
        lastAccessedAt: userOrg.lastAccessedAt,
        invitedAt: userOrg.invitedAt,
        invitedBy: userOrg.invitedBy,
      }));

      // Return paginated response
      const totalPages = Math.ceil(total / limit);
      return {
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };
    }),

  /**
   * Get details of a specific member
   * Requires: organization_members:read scope
   */
  getMember: scopedProcedure(RESOURCES.ORGANIZATION_MEMBERS, ACTIONS.READ)
    .input(z.object({ userId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Organization ID required",
        });
      }

      const userOrgRepository = AppDataSource.getRepository(UserOrganization);
      const userOrg = await userOrgRepository.findOne({
        where: {
          userId: input.userId,
          organizationId: ctx.organizationId,
        },
        relations: ["user"],
      });

      if (!userOrg) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found in this organization",
        });
      }

      return {
        id: userOrg.id,
        userId: userOrg.userId,
        email: userOrg.user.email,
        firstName: userOrg.user.firstName,
        lastName: userOrg.user.lastName,
        role: userOrg.role,
        permissions: userOrg.permissions,
        isActive: userOrg.isActive,
        joinedAt: userOrg.joinedAt,
        lastAccessedAt: userOrg.lastAccessedAt,
        invitedAt: userOrg.invitedAt,
        invitedBy: userOrg.invitedBy,
      };
    }),

  /**
   * Update a member's role and permissions
   * Requires: organization_members:manage scope (typically owner/admin only)
   */
  updateMemberRole: scopedProcedure(RESOURCES.ORGANIZATION_MEMBERS, ACTIONS.MANAGE)
    .input(
      z.object({
        userId: z.string().uuid(),
        role: z.enum(["owner", "admin", "member", "viewer", "contributor"]),
        permissions: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Organization ID required",
        });
      }

      // Prevent changing own role
      if (ctx.user?.id === input.userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot change your own role",
        });
      }

      // Use transaction to prevent race conditions
      return await AppDataSource.transaction(async (manager) => {
        const userOrgRepository = manager.getRepository(UserOrganization);
        const userOrg = await userOrgRepository.findOne({
          where: {
            userId: input.userId,
            organizationId: ctx.organizationId!,
          },
        });

        if (!userOrg) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Member not found in this organization",
          });
        }

        // Store old role for audit log
        const oldRole = userOrg.role;

        // Prevent demoting last owner
        if (oldRole === "owner" && input.role !== "owner") {
          const ownerCount = await getOwnerCount(ctx.organizationId!);
          if (ownerCount <= 1) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Cannot demote the last owner of the organization",
            });
          }
        }

        // Update role and permissions
        userOrg.role = input.role;
        if (input.permissions !== undefined) {
          userOrg.permissions = input.permissions;
        }
        await userOrgRepository.save(userOrg);

        // Log audit event
        await auditLogService.logMemberRoleChange(
          ctx.user!.id,
          ctx.organizationId!,
          input.userId,
          oldRole,
          input.role,
          {
            permissions: input.permissions,
          },
        );

        return {
          success: true,
          message: "Member role updated successfully",
          data: {
            userId: userOrg.userId,
            role: userOrg.role,
            permissions: userOrg.permissions,
          },
        };
      });
    }),

  /**
   * Remove a member from the organization
   * Requires: organization_members:manage scope (typically admin/owner only)
   */
  removeMember: scopedProcedure(RESOURCES.ORGANIZATION_MEMBERS, ACTIONS.MANAGE)
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Organization ID required",
        });
      }

      // Prevent removing yourself
      if (ctx.user?.id === input.userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot remove yourself from the organization",
        });
      }

      const userOrgRepository = AppDataSource.getRepository(UserOrganization);
      const userOrg = await userOrgRepository.findOne({
        where: {
          userId: input.userId,
          organizationId: ctx.organizationId,
        },
        relations: ["user"],
      });

      if (!userOrg) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found in this organization",
        });
      }

      // Prevent non-owners from removing owners
      if (userOrg.role === "owner" && ctx.user?.getRole() !== "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only owners can remove other owners",
        });
      }

      // Prevent removing last owner
      if (userOrg.role === "owner") {
        const ownerCount = await getOwnerCount(ctx.organizationId!);
        if (ownerCount <= 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot remove the last owner of the organization",
          });
        }
      }

      // Store info for audit log before removal
      const removedUserEmail = userOrg.user.email;
      const removedUserRole = userOrg.role;

      await userOrgRepository.remove(userOrg);

      // Log audit event
      await auditLogService.logMemberRemove(
        ctx.user!.id,
        ctx.organizationId!,
        input.userId,
        removedUserEmail,
        {
          role: removedUserRole,
        },
      );

      return {
        success: true,
        message: "Member removed successfully",
      };
    }),

  // ============================================================================
  // ORGANIZATION LOGO UPLOAD
  // ============================================================================

  uploadLogo: scopedProcedure(RESOURCES.ORGANIZATION_SETTINGS, ACTIONS.UPDATE)
    .input(
      z.object({
        logo: z.string(), // base64 data URI
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const storageService = new StorageService();

      // 1. Upload new logo using helper
      const result = await handleUpload(
        input.logo,
        "organizations",
        ctx.organizationId!,
        ctx.user!.id,
        { maxSize: 2 * 1024 * 1024 }, // 2MB for logos
      );

      // 2. Get current organization
      const org = await organizationService.findOne(ctx.organizationId!);
      if (!org) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      // 3. Delete old logo if exists
      if (org.logoUploadId) {
        await storageService.delete(org.logoUploadId);
      }

      // 4. Update organization with new upload reference
      await organizationService.update(ctx.organizationId!, {
        logoUploadId: result.upload.id,
      });

      // 5. Return URL for immediate display
      return {
        success: true,
        id: result.upload.id,
        url: result.url,
      };
    }),

  deleteLogo: scopedProcedure(RESOURCES.ORGANIZATION_SETTINGS, ACTIONS.UPDATE).mutation(
    async ({ ctx }) => {
      const org = await organizationService.findOne(ctx.organizationId!);
      if (!org) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      if (org.logoUploadId) {
        const storageService = new StorageService();
        await storageService.delete(org.logoUploadId);

        await organizationService.update(ctx.organizationId!, {
          logoUploadId: undefined,
        });
      }

      return {
        success: true,
        message: "Logo removed successfully",
      };
    },
  ),

  // ============================================================================
  // ORGANIZATION SWITCHING
  // ============================================================================

  switchOrganization: authenticatedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Verify user is a member of the target organization
      const userOrgRepository = AppDataSource.getRepository(UserOrganization);
      const userOrg = await userOrgRepository.findOne({
        where: {
          userId: ctx.user!.id,
          organizationId: input.organizationId,
          isActive: true,
        },
        relations: ["organization"],
      });

      if (!userOrg) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found or you are not a member",
        });
      }

      // Update lastAccessedAt
      userOrg.updateLastAccessed();
      await userOrgRepository.save(userOrg);

      // Log the organization switch
      await auditLogService.logOrganizationSwitch(
        ctx.user!.id,
        ctx.organizationId || null,
        input.organizationId,
        {
          userAgent: ctx.userAgent,
          ipAddress: ctx.ipAddress,
        },
      );

      return {
        success: true,
        organization: {
          id: userOrg.organization.id,
          name: userOrg.organization.name,
          slug: userOrg.organization.slug,
          role: userOrg.role,
          permissions: userOrg.permissions,
        },
      };
    }),
});
