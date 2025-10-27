import { t, authenticatedProcedure, scopedProcedure } from "@server/trpc";
import { z } from "zod";
import { organizationService } from "@server/services/organization.service";
import { TRPCError } from "@trpc/server";
import { SupportedLanguage } from "@server/types/language.types";
import { DateFormat, TimeFormat, Timezone } from "@server/types/organization-settings.types";
import { AppDataSource } from "@server/database/data-source";
import { UserOrganization } from "@server/entities/user-organization.entity";
import { User } from "@server/entities/user.entity";
import { RESOURCES, ACTIONS } from "@server/types/scopes";

const updateSettingsSchema = z.object({
  defaultLanguage: z.nativeEnum(SupportedLanguage).optional(),
  dateFormat: z.nativeEnum(DateFormat).optional(),
  timeFormat: z.nativeEnum(TimeFormat).optional(),
  timezone: z.nativeEnum(Timezone).optional(),
  defaultAgentId: z.string().uuid().nullable().optional(),
  testModeDefault: z.boolean().optional(),
});

export const organizationsRouter = t.router({
  // ============================================================================
  // ORGANIZATION SETTINGS
  // ============================================================================

  getSettings: scopedProcedure(RESOURCES.ORGANIZATION_SETTINGS, ACTIONS.READ).query(
    async ({ ctx }) => {
      const organization = await organizationService.findOne(ctx.organizationId!);

      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      return {
        defaultLanguage: organization.defaultLanguage,
        dateFormat: organization.dateFormat,
        timeFormat: organization.timeFormat,
        timezone: organization.timezone,
        defaultAgentId: organization.defaultAgentId,
        testModeDefault: organization.settings?.testModeDefault || false,
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
   * List all members of the organization
   * Requires: organization_members:read scope
   */
  listMembers: scopedProcedure(RESOURCES.ORGANIZATION_MEMBERS, ACTIONS.READ).query(
    async ({ ctx }) => {
      if (!ctx.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Organization ID required",
        });
      }

      const userOrgRepository = AppDataSource.getRepository(UserOrganization);
      const members = await userOrgRepository.find({
        where: { organizationId: ctx.organizationId },
        relations: ["user"],
        order: { createdAt: "ASC" },
      });

      return members.map((userOrg) => ({
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
    },
  ),

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

      const userOrgRepository = AppDataSource.getRepository(UserOrganization);
      const userOrg = await userOrgRepository.findOne({
        where: {
          userId: input.userId,
          organizationId: ctx.organizationId,
        },
      });

      if (!userOrg) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found in this organization",
        });
      }

      // Update role and permissions
      userOrg.role = input.role;
      if (input.permissions !== undefined) {
        userOrg.permissions = input.permissions;
      }
      await userOrgRepository.save(userOrg);

      return {
        success: true,
        message: "Member role updated successfully",
        data: {
          userId: userOrg.userId,
          role: userOrg.role,
          permissions: userOrg.permissions,
        },
      };
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

      await userOrgRepository.remove(userOrg);

      return {
        success: true,
        message: "Member removed successfully",
      };
    }),
});
