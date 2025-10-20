import { t, authenticatedProcedure, publicProcedure } from "@server/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { AppDataSource } from "@server/database/data-source";
import { OrganizationInvitation } from "@server/entities/organization-invitation.entity";
import { UserOrganization } from "@server/entities/user-organization.entity";
import { User } from "@server/entities/user.entity";
import { Organization } from "@server/entities/organization.entity";
import * as crypto from "crypto";

/**
 * Generate a secure random token for invitation
 */
function generateInvitationToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Hash the invitation token for storage
 */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Send invitation email (placeholder - implement actual email sending)
 */
async function sendInvitationEmail(
  email: string,
  organizationName: string,
  inviterName: string,
  token: string,
  message?: string,
): Promise<void> {
  // TODO: Implement actual email sending using your email service
  console.log(`[Invitation] Sending invitation to ${email}`);
  console.log(`Organization: ${organizationName}`);
  console.log(`Invited by: ${inviterName}`);
  console.log(`Token: ${token}`);
  console.log(`Message: ${message || "No message"}`);
  console.log(`Accept URL: ${process.env.APP_URL}/accept-invitation?token=${token}`);
}

export const invitationsRouter = t.router({
  // Send an invitation to join an organization
  sendInvitation: authenticatedProcedure
    .input(
      z.object({
        email: z.string().email(),
        role: z.enum(["owner", "admin", "member", "viewer", "contributor"]).default("member"),
        permissions: z.array(z.string()).optional(),
        message: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Organization ID required",
        });
      }

      // Only admins can send invitations
      if (!ctx.user?.isAdmin()) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins can send invitations",
        });
      }

      const invitationRepository = AppDataSource.getRepository(OrganizationInvitation);
      const userRepository = AppDataSource.getRepository(User);
      const orgRepository = AppDataSource.getRepository(Organization);
      const userOrgRepository = AppDataSource.getRepository(UserOrganization);

      // Get organization details
      const organization = await orgRepository.findOne({
        where: { id: ctx.organizationId },
      });

      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      // Check if user with this email exists
      const existingUser = await userRepository.findOne({
        where: { email: input.email },
      });

      // If user exists, check if they're already a member
      if (existingUser) {
        const existingMembership = await userOrgRepository.findOne({
          where: {
            userId: existingUser.id,
            organizationId: ctx.organizationId,
          },
        });

        if (existingMembership) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "User is already a member of this organization",
          });
        }
      }

      // Check if there's already a pending invitation for this email
      const existingInvitation = await invitationRepository.findOne({
        where: {
          email: input.email,
          organizationId: ctx.organizationId,
          status: "pending",
        },
      });

      if (existingInvitation && !existingInvitation.isExpired()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "An invitation has already been sent to this email",
        });
      }

      // Generate invitation token
      const token = generateInvitationToken();
      const tokenHash = hashToken(token);

      // Create invitation
      const invitation = invitationRepository.create({
        organizationId: ctx.organizationId,
        email: input.email,
        invitedUserId: existingUser?.id,
        invitedBy: ctx.user?.id,
        role: input.role,
        permissions: input.permissions,
        tokenHash,
        status: "pending",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        message: input.message,
      });

      await invitationRepository.save(invitation);

      // Send invitation email
      const inviterName = ctx.user?.getUser().getFullName() || "Someone";
      await sendInvitationEmail(
        input.email,
        organization.name,
        inviterName,
        token,
        input.message,
      );

      return {
        success: true,
        message: "Invitation sent successfully",
        data: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
        },
      };
    }),

  // List all invitations for the current organization
  listInvitations: authenticatedProcedure
    .input(
      z
        .object({
          status: z
            .enum(["pending", "accepted", "declined", "expired", "cancelled"])
            .optional(),
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

      // Only admins can list invitations
      if (!ctx.user?.isAdmin()) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins can view invitations",
        });
      }

      const invitationRepository = AppDataSource.getRepository(OrganizationInvitation);

      const where: any = {
        organizationId: ctx.organizationId,
      };

      if (input?.status) {
        where.status = input.status;
      }

      const invitations = await invitationRepository.find({
        where,
        relations: ["invitedByUser"],
        order: { createdAt: "DESC" },
      });

      // Mark expired invitations
      for (const invitation of invitations) {
        if (invitation.status === "pending" && invitation.isExpired()) {
          invitation.markExpired();
          await invitationRepository.save(invitation);
        }
      }

      return invitations.map((inv) => ({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        status: inv.status,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt,
        acceptedAt: inv.acceptedAt,
        message: inv.message,
        invitedBy: inv.invitedByUser
          ? {
              id: inv.invitedByUser.id,
              name: inv.invitedByUser.getFullName(),
              email: inv.invitedByUser.email,
            }
          : null,
      }));
    }),

  // Cancel a pending invitation
  cancelInvitation: authenticatedProcedure
    .input(z.object({ invitationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Organization ID required",
        });
      }

      // Only admins can cancel invitations
      if (!ctx.user?.isAdmin()) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins can cancel invitations",
        });
      }

      const invitationRepository = AppDataSource.getRepository(OrganizationInvitation);
      const invitation = await invitationRepository.findOne({
        where: {
          id: input.invitationId,
          organizationId: ctx.organizationId,
        },
      });

      if (!invitation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invitation not found",
        });
      }

      invitation.cancel();
      await invitationRepository.save(invitation);

      return {
        success: true,
        message: "Invitation cancelled successfully",
      };
    }),

  // Accept an invitation (can be called by authenticated or unauthenticated users)
  acceptInvitation: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const tokenHash = hashToken(input.token);
      const invitationRepository = AppDataSource.getRepository(OrganizationInvitation);
      const userRepository = AppDataSource.getRepository(User);
      const userOrgRepository = AppDataSource.getRepository(UserOrganization);

      // Find invitation by token
      const invitation = await invitationRepository.findOne({
        where: { tokenHash },
        relations: ["organization"],
      });

      if (!invitation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invalid invitation token",
        });
      }

      if (!invitation.canAccept()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invitation cannot be accepted (status: ${invitation.status})`,
        });
      }

      // If user is authenticated, use their ID
      // Otherwise, they need to be invited (existing user) or register first
      let userId: string;

      if (ctx.user) {
        // User is already authenticated
        userId = ctx.user.id;

        // Verify email matches
        const user = await userRepository.findOne({ where: { id: userId } });
        if (!user || user.email !== invitation.email) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invitation email does not match your account",
          });
        }
      } else if (invitation.invitedUserId) {
        // Invitation was for an existing user, but they're not authenticated
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Please log in to accept this invitation",
        });
      } else {
        // Invitation was for a new user, they need to register first
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Please create an account to accept this invitation",
        });
      }

      // Check if user is already a member
      const existingMembership = await userOrgRepository.findOne({
        where: {
          userId,
          organizationId: invitation.organizationId,
        },
      });

      if (existingMembership) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You are already a member of this organization",
        });
      }

      // Create UserOrganization membership
      const userOrg = userOrgRepository.create({
        userId,
        organizationId: invitation.organizationId,
        role: invitation.role,
        permissions: invitation.permissions,
        isActive: true,
        joinedAt: new Date(),
        invitedAt: invitation.createdAt,
        invitedBy: invitation.invitedBy,
      });

      await userOrgRepository.save(userOrg);

      // Mark invitation as accepted
      invitation.accept();
      await invitationRepository.save(invitation);

      return {
        success: true,
        message: "Invitation accepted successfully",
        data: {
          organizationId: invitation.organizationId,
          organizationName: invitation.organization.name,
          role: userOrg.role,
        },
      };
    }),

  // Decline an invitation
  declineInvitation: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const tokenHash = hashToken(input.token);
      const invitationRepository = AppDataSource.getRepository(OrganizationInvitation);

      const invitation = await invitationRepository.findOne({
        where: { tokenHash },
      });

      if (!invitation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invalid invitation token",
        });
      }

      invitation.decline();
      await invitationRepository.save(invitation);

      return {
        success: true,
        message: "Invitation declined",
      };
    }),

  // Get invitation details by token (for preview before accepting)
  getInvitationByToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const tokenHash = hashToken(input.token);
      const invitationRepository = AppDataSource.getRepository(OrganizationInvitation);

      const invitation = await invitationRepository.findOne({
        where: { tokenHash },
        relations: ["organization", "invitedByUser"],
      });

      if (!invitation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invalid invitation token",
        });
      }

      // Mark as expired if needed
      if (invitation.status === "pending" && invitation.isExpired()) {
        invitation.markExpired();
        await invitationRepository.save(invitation);
      }

      return {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        message: invitation.message,
        organization: {
          id: invitation.organization.id,
          name: invitation.organization.name,
          logo: invitation.organization.logo,
        },
        invitedBy: invitation.invitedByUser
          ? {
              name: invitation.invitedByUser.getFullName(),
              email: invitation.invitedByUser.email,
            }
          : null,
        canAccept: invitation.canAccept(),
      };
    }),
});
