import { t, publicProcedure, scopedProcedure } from "@server/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { AppDataSource } from "@server/database/data-source";
import { OrganizationInvitation } from "@server/entities/organization-invitation.entity";
import { UserOrganization } from "@server/entities/user-organization.entity";
import { User } from "@server/entities/user.entity";
import { Organization } from "@server/entities/organization.entity";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { emailService } from "@server/services/email.service";
import { getDashboardUrl } from "@server/config/env";
import { rateLimitMiddleware, RateLimits } from "@server/trpc/middleware/rate-limit";
import { auditLogService } from "@server/services/audit-log.service";
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
 * Send invitation email using the email service
 */
async function sendInvitationEmail(
  email: string,
  organizationName: string,
  inviterName: string,
  inviterEmail: string,
  role: string,
  token: string,
  expiresAt: Date,
  isNewUser: boolean,
  message?: string,
): Promise<void> {
  const dashboardUrl = getDashboardUrl();
  const acceptUrl = `${dashboardUrl}/accept-invitation?token=${token}`;
  const declineUrl = `${dashboardUrl}/decline-invitation?token=${token}`;

  // Format expiration date
  const expiresAtFormatted = new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(expiresAt));

  // Ensure email service is initialized
  await emailService.initialize();

  await emailService.sendTemplateEmail({
    template: "organization-invitation",
    to: email,
    subject: `You've been invited to join ${organizationName}`,
    variables: {
      organizationName,
      inviterName,
      inviterEmail,
      role,
      message,
      isOwner: role === "owner",
      isAdmin: role === "admin",
      isContributor: role === "contributor",
      isMember: role === "member",
      isViewer: role === "viewer",
      acceptInvitationUrl: acceptUrl,
      declineInvitationUrl: declineUrl,
      expiresAt: expiresAtFormatted,
      isNewUser,
      invitedUserEmail: email,
    },
  });
}

export const invitationsRouter = t.router({
  /**
   * Send an invitation to join an organization
   * Requires: organization_invitations:invite scope (typically admin/owner only)
   * Rate limited to 10 invitations per hour per user
   */
  sendInvitation: scopedProcedure(RESOURCES.ORGANIZATION_INVITATIONS, ACTIONS.INVITE)
    .use(rateLimitMiddleware(RateLimits.INVITATIONS))
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
      const inviter = ctx.user?.getUser();
      const inviterName = inviter?.getFullName() || "Someone";
      const inviterEmail = inviter?.email || "";

      await sendInvitationEmail(
        input.email,
        organization.name,
        inviterName,
        inviterEmail,
        input.role,
        token,
        invitation.expiresAt,
        !existingUser, // isNewUser: true if user doesn't exist yet
        input.message,
      );

      // Log audit event
      await auditLogService.logInvitationSend(
        ctx.user!.id,
        ctx.organizationId!,
        input.email,
        input.role,
        {
          invitationId: invitation.id,
          message: input.message,
          isNewUser: !existingUser,
        },
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

  /**
   * List all invitations for the current organization
   * Requires: organization_invitations:read scope
   */
  listInvitations: scopedProcedure(RESOURCES.ORGANIZATION_INVITATIONS, ACTIONS.READ)
    .input(
      z
        .object({
          status: z.enum(["pending", "accepted", "declined", "expired", "cancelled"]).optional(),
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

  /**
   * Cancel a pending invitation
   * Requires: organization_invitations:delete scope
   */
  cancelInvitation: scopedProcedure(RESOURCES.ORGANIZATION_INVITATIONS, ACTIONS.DELETE)
    .input(z.object({ invitationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Organization ID required",
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

      // Log audit event
      await auditLogService.logInvitationCancel(
        ctx.user!.id,
        ctx.organizationId!,
        invitation.email,
        {
          invitationId: invitation.id,
          role: invitation.role,
        },
      );

      return {
        success: true,
        message: "Invitation cancelled successfully",
      };
    }),

  /**
   * Accept an invitation (public endpoint - no authentication required initially)
   * User must be authenticated to actually accept
   */
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

        // Verify email matches (case-insensitive)
        const user = await userRepository.findOne({ where: { id: userId } });
        if (!user || user.email.toLowerCase() !== invitation.email.toLowerCase()) {
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

      // Log audit event
      await auditLogService.logInvitationAccept(
        userId,
        invitation.organizationId,
        invitation.role,
        {
          invitationId: invitation.id,
          organizationName: invitation.organization.name,
        },
      );

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

  /**
   * Decline an invitation (public endpoint)
   */
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

      // Log audit event (if user is authenticated)
      if (ctx.user) {
        await auditLogService.logInvitationDecline(ctx.user.id, invitation.organizationId, {
          invitationId: invitation.id,
          email: invitation.email,
        });
      }

      return {
        success: true,
        message: "Invitation declined",
      };
    }),

  /**
   * Get invitation details by token (for preview before accepting)
   * Public endpoint - no authentication required
   */
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
        isExistingUser: invitation.invitedUserId !== null,
      };
    }),

  /**
   * Resend an invitation email
   * Requires: organization_invitations:invite scope
   * Rate limited to 3 resends per invitation per day
   */
  resendInvitation: scopedProcedure(RESOURCES.ORGANIZATION_INVITATIONS, ACTIONS.INVITE)
    .input(z.object({ invitationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Organization ID required",
        });
      }

      const invitationRepository = AppDataSource.getRepository(OrganizationInvitation);
      const orgRepository = AppDataSource.getRepository(Organization);

      // Find the invitation
      const invitation = await invitationRepository.findOne({
        where: {
          id: input.invitationId,
          organizationId: ctx.organizationId,
        },
        relations: ["organization"],
      });

      if (!invitation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invitation not found",
        });
      }

      // Check if invitation is pending
      if (invitation.status !== "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot resend ${invitation.status} invitation`,
        });
      }

      // Check if invitation has expired
      if (invitation.isExpired()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot resend expired invitation",
        });
      }

      // Check rate limit manually using Redis
      const redisService = require("@server/services/redis.service").redisService;
      const redis = redisService.getClient();

      if (redis) {
        const rateLimitKey = `ratelimit:invitation_resend:invitations.resendInvitation:${input.invitationId}`;
        const now = Date.now();
        const windowMs = 24 * 60 * 60 * 1000; // 24 hours
        const windowStart = now - windowMs;
        const maxResends = 3;

        // Remove old entries
        await redis.zremrangebyscore(rateLimitKey, 0, windowStart);

        // Count resends in the current window
        const resendCount = await redis.zcard(rateLimitKey);

        if (resendCount >= maxResends) {
          const oldestRequests = await redis.zrange(rateLimitKey, 0, 0, "WITHSCORES");
          const oldestTimestamp = oldestRequests[1] ? parseInt(oldestRequests[1]) : now;
          const retryAfter = Math.ceil((oldestTimestamp + windowMs - now) / 1000);

          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: `Maximum ${maxResends} resends per invitation per day. Try again in ${Math.ceil(retryAfter / 3600)} hours.`,
          });
        }

        // Record this resend
        const requestId = `${now}-${Math.random().toString(36).substring(7)}`;
        await redis.zadd(rateLimitKey, now, requestId);
        await redis.expire(rateLimitKey, Math.ceil(windowMs / 1000));
      }

      // Generate new token and update invitation
      const token = generateInvitationToken();
      const tokenHash = hashToken(token);

      invitation.tokenHash = tokenHash;
      invitation.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      await invitationRepository.save(invitation);

      // Get organization details
      const organization =
        invitation.organization ||
        (await orgRepository.findOne({
          where: { id: ctx.organizationId },
        }));

      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      // Send invitation email
      const inviter = ctx.user?.getUser();
      const inviterName = inviter?.getFullName() || "Someone";
      const inviterEmail = inviter?.email || "";

      await sendInvitationEmail(
        invitation.email,
        organization.name,
        inviterName,
        inviterEmail,
        invitation.role,
        token,
        invitation.expiresAt,
        !invitation.invitedUserId, // isNewUser: true if invitedUserId is null
        invitation.message,
      );

      // Log audit event
      await auditLogService.logInvitationResend(
        ctx.user!.id,
        ctx.organizationId!,
        invitation.email,
        {
          invitationId: invitation.id,
          role: invitation.role,
          newExpiresAt: invitation.expiresAt,
        },
      );

      return {
        success: true,
        message: "Invitation resent successfully",
        data: {
          id: invitation.id,
          email: invitation.email,
          expiresAt: invitation.expiresAt,
        },
      };
    }),
});
