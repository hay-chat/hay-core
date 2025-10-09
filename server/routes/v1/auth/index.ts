import { t } from "@server/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { AppDataSource } from "@server/database/data-source";
import { User } from "@server/entities/user.entity";
import { ApiKey } from "@server/entities/apikey.entity";
import { Organization } from "@server/entities/organization.entity";
import { Not, IsNull } from "typeorm";
import {
  hashPassword,
  verifyPassword,
  generateApiKey,
  hashApiKey,
  generateSessionId,
} from "@server/lib/auth/utils/hashing";
import { generateTokens, verifyRefreshToken, refreshAccessToken } from "@server/lib/auth/utils/jwt";
import { protectedProcedure, publicProcedure, adminProcedure } from "@server/trpc/middleware/auth";
import type { ApiKeyResponse } from "@server/types/auth.types";
import { auditLogService } from "@server/services/audit-log.service";
import { emailService } from "@server/services/email.service";
import * as crypto from "crypto";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const registerSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    confirmPassword: z.string(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    organizationName: z.string().optional(),
    organizationSlug: z.string().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

const createApiKeySchema = z.object({
  name: z.string().min(1),
  expiresAt: z.date().optional(),
  scopes: z
    .array(
      z.object({
        resource: z.string(),
        actions: z.array(z.string()),
      }),
    )
    .optional(),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string(),
});

export const authRouter = t.router({
  // Public endpoints
  login: publicProcedure.input(loginSchema).mutation(async ({ input }) => {
    const { email, password } = input;

    // Find user by email with organization
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({
      where: { email: email.toLowerCase() },
      relations: ["organization"],
    });

    if (!user) {
      // Prevent timing attacks by using a valid dummy hash
      await verifyPassword(
        password,
        "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$SOWWcWsDNrEh+WTm3Hh5F3hH5KPLz9JRDYbAj2BJUn4",
      );
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid credentials",
      });
    }

    // Verify password
    const isValidPassword = await verifyPassword(password, user.password);
    if (!isValidPassword) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid credentials",
      });
    }

    // Check if user is active
    if (!user.isActive) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Account is deactivated",
      });
    }

    // Update last login time and last seen
    user.lastLoginAt = new Date();
    user.updateLastSeen();
    await userRepository.save(user);

    // Generate tokens
    const sessionId = generateSessionId();
    const tokens = generateTokens(user, sessionId);

    // Prepare organization data
    const organizations = user.organization
      ? [
          {
            id: user.organization.id,
            name: user.organization.name,
            slug: user.organization.slug,
            role: user.role,
          },
        ]
      : [];

    return {
      user: {
        ...user.toJSON(),
        organizations,
        activeOrganizationId: user.organizationId,
        onlineStatus: user.getOnlineStatus(),
      },
      ...tokens,
    };
  }),

  register: publicProcedure.input(registerSchema).mutation(async ({ input }) => {
    const { email, password, firstName, lastName, organizationName, organizationSlug } = input;

    // Use a transaction for atomicity
    return await AppDataSource.transaction(async (manager) => {
      const userRepository = manager.getRepository(User);
      const organizationRepository = manager.getRepository(Organization);

      // Check if user already exists
      const existingUser = await userRepository.findOne({
        where: { email: email.toLowerCase() },
      });

      if (existingUser) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "User already exists",
        });
      }

      let organization: Organization | null = null;

      // Create organization if name provided
      if (organizationName) {
        const orgSlug =
          organizationSlug ||
          organizationName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)+/g, "");

        // Check if slug already exists
        const existingOrg = await organizationRepository.findOne({
          where: { slug: orgSlug },
        });

        if (existingOrg) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Organization slug already exists",
          });
        }

        organization = organizationRepository.create({
          name: organizationName,
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
      }

      // Hash password
      const hashedPassword = await hashPassword(password, "argon2");

      // Create new user
      const user = userRepository.create({
        email: email.toLowerCase(),
        password: hashedPassword,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        isActive: true,
        organizationId: organization?.id,
        role: organization ? "owner" : "member", // Owner if creating org, otherwise member
      });

      // Update last seen on registration
      user.updateLastSeen();
      await userRepository.save(user);

      // Generate tokens
      const sessionId = generateSessionId();
      const tokens = generateTokens(user, sessionId);

      // Prepare organization data
      const organizations = organization
        ? [
            {
              id: organization.id,
              name: organization.name,
              slug: organization.slug,
              role: user.role,
            },
          ]
        : [];

      return {
        user: {
          ...user.toJSON(),
          organizations,
          activeOrganizationId: user.organizationId,
          onlineStatus: user.getOnlineStatus(),
        },
        ...tokens,
      };
    });
  }),

  refreshToken: publicProcedure.input(refreshTokenSchema).mutation(async ({ input }) => {
    try {
      const payload = verifyRefreshToken(input.refreshToken);

      // Find user
      const userRepository = AppDataSource.getRepository(User);
      const user = await userRepository.findOne({
        where: { id: payload.userId },
      });

      if (!user || !user.isActive) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid refresh token",
        });
      }

      // Generate new access token
      const accessToken = await refreshAccessToken(input.refreshToken);

      return {
        accessToken,
        expiresIn: 900, // 15 minutes
      };
    } catch (error) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid or expired refresh token",
      });
    }
  }),

  // Protected endpoints
  me: protectedProcedure.query(async ({ ctx }) => {
    const userEntity = ctx.user!.getUser(); // protectedProcedure guarantees user exists

    // Fetch user with organization data
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({
      where: { id: userEntity.id },
      relations: ["organization"],
    });

    if (!user) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }

    // Prepare organization data
    const organizations = user.organization
      ? [
          {
            id: user.organization.id,
            name: user.organization.name,
            slug: user.organization.slug,
            role: user.role,
          },
        ]
      : [];

    return {
      id: user.id,
      email: user.email,
      pendingEmail: user.pendingEmail,
      firstName: user.firstName,
      lastName: user.lastName,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      lastSeenAt: user.lastSeenAt,
      status: user.status,
      onlineStatus: user.getOnlineStatus(),
      authMethod: ctx.user!.authMethod,
      organizations,
      activeOrganizationId: user.organizationId,
      role: user.role,
    };
  }),

  logout: protectedProcedure.mutation(async () => {
    // In a stateless JWT system, logout is handled client-side
    // Here we could invalidate refresh tokens if we're tracking them
    return { success: true };
  }),

  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string(),
        newPassword: z.string().min(8),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userRepository = AppDataSource.getRepository(User);
      const user = await userRepository.findOne({
        where: { id: ctx.user!.id },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Verify current password
      const isValidPassword = await verifyPassword(input.currentPassword, user.password);
      if (!isValidPassword) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Current password is incorrect",
        });
      }

      // Hash new password
      user.password = await hashPassword(input.newPassword, "argon2");
      await userRepository.save(user);

      // Log password change
      try {
        await auditLogService.logPasswordChange(user.id, {
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });

        // Send email notification
        await emailService.initialize();
        await emailService.sendTemplateEmail({
          to: user.email,
          subject: "Your Password Has Been Changed",
          template: "password-changed",
          variables: {
            userName: user.getFullName(),
            userEmail: user.email,
            companyName: "Hay",
            changedAt: new Date().toLocaleString(),
            ipAddress: ctx.ipAddress || "Unknown",
            browser: ctx.userAgent || "Unknown",
            location: "Unknown", // TODO: Add geolocation lookup
            supportUrl: "https://hay.chat/support",
            currentYear: new Date().getFullYear().toString(),
            companyAddress: "Hay Platform",
            websiteUrl: "https://hay.chat",
            preferencesUrl: "https://hay.chat/settings",
            recipientEmail: user.email,
          },
        });
      } catch (error) {
        console.error("Failed to log password change or send email:", error);
        // Don't fail the password change if logging/email fails
      }

      return { success: true };
    }),

  verifyPassword: protectedProcedure
    .input(
      z.object({
        password: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userRepository = AppDataSource.getRepository(User);
      const user = await userRepository.findOne({
        where: { id: ctx.user!.id },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Verify password
      const isValidPassword = await verifyPassword(input.password, user.password);

      if (!isValidPassword) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Password is incorrect",
        });
      }

      return { success: true };
    }),

  updateProfile: protectedProcedure
    .input(
      z.object({
        firstName: z.string().optional(),
        lastName: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userRepository = AppDataSource.getRepository(User);
      const user = await userRepository.findOne({
        where: { id: ctx.user!.id },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      const changes: Record<string, any> = {};

      if (input.firstName !== undefined && input.firstName !== user.firstName) {
        changes.firstName = { old: user.firstName, new: input.firstName };
        user.firstName = input.firstName;
      }

      if (input.lastName !== undefined && input.lastName !== user.lastName) {
        changes.lastName = { old: user.lastName, new: input.lastName };
        user.lastName = input.lastName;
      }

      if (Object.keys(changes).length > 0) {
        await userRepository.save(user);

        // Log profile update
        try {
          await auditLogService.logProfileUpdate(user.id, changes, {
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          });
        } catch (error) {
          console.error("Failed to log profile update:", error);
        }
      }

      return {
        success: true,
        user: user.toJSON(),
      };
    }),

  updateEmail: protectedProcedure
    .input(
      z.object({
        newEmail: z.string().email(),
        currentPassword: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userRepository = AppDataSource.getRepository(User);
      const user = await userRepository.findOne({
        where: { id: ctx.user!.id },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Verify current password for re-authentication
      const isValidPassword = await verifyPassword(input.currentPassword, user.password);
      if (!isValidPassword) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Current password is incorrect",
        });
      }

      // Check if new email is already in use
      const existingUser = await userRepository.findOne({
        where: { email: input.newEmail.toLowerCase() },
      });

      if (existingUser && existingUser.id !== user.id) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Email address is already in use",
        });
      }

      // Generate verification token
      const verificationToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = await hashPassword(verificationToken, "argon2");

      // Store pending email and token
      const oldEmail = user.email;
      user.pendingEmail = input.newEmail.toLowerCase();
      user.emailVerificationTokenHash = tokenHash;
      user.emailVerificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      await userRepository.save(user);

      // Send verification emails
      try {
        console.log("📧 [updateEmail] Initializing email service...");
        await emailService.initialize();
        console.log("✅ [updateEmail] Email service initialized");

        const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
        const verificationUrl = `${baseUrl}/verify-email?token=${verificationToken}`;

        console.log("🔗 [updateEmail] Verification URL:", verificationUrl);
        console.log("📬 [updateEmail] Sending to NEW email:", input.newEmail.toLowerCase());
        console.log("📬 [updateEmail] Sending to OLD email:", oldEmail);

        const commonVariables = {
          userName: user.getFullName(),
          oldEmail,
          newEmail: input.newEmail.toLowerCase(),
          companyName: "Hay",
          requestTime: new Date().toLocaleString(),
          ipAddress: ctx.ipAddress || "Unknown",
          browser: ctx.userAgent || "Unknown",
          location: "Unknown", // TODO: Add geolocation lookup
          supportUrl: `${baseUrl}/support`,
          cancelUrl: `${baseUrl}/settings/profile`,
          currentYear: new Date().getFullYear().toString(),
          companyAddress: "Hay Platform",
          websiteUrl: "https://hay.chat",
          preferencesUrl: `${baseUrl}/settings`,
        };

        // Send verification email to NEW email
        console.log("📤 [updateEmail] Sending verification email to NEW address...");
        const result1 = await emailService.sendTemplateEmail({
          to: input.newEmail.toLowerCase(),
          subject: "Verify Your New Email Address",
          template: "verify-email-change",
          variables: {
            ...commonVariables,
            verificationUrl,
            recipientEmail: input.newEmail.toLowerCase(),
          },
        });
        console.log("📨 [updateEmail] Verification email result:", result1);

        // Send notification to OLD email
        console.log("📤 [updateEmail] Sending notification to OLD address...");
        const result2 = await emailService.sendTemplateEmail({
          to: oldEmail,
          subject: "Email Change Pending Verification",
          template: "email-change-pending",
          variables: {
            ...commonVariables,
            recipientEmail: oldEmail,
          },
        });
        console.log("📨 [updateEmail] Notification email result:", result2);

        console.log("✅ [updateEmail] All emails sent successfully");
      } catch (error) {
        console.error("❌ [updateEmail] Failed to send verification emails:", error);
        console.error("❌ [updateEmail] Error stack:", error instanceof Error ? error.stack : "No stack");
        // Rollback the pending email change
        await userRepository.update(user.id, {
          pendingEmail: null as any,
          emailVerificationTokenHash: null as any,
          emailVerificationExpiresAt: null as any,
        });
        console.log("🔄 [updateEmail] Rolled back pending email change");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to send verification email. Please try again.",
        });
      }

      return {
        success: true,
        message: "Verification email sent. Please check your new email address to complete the change.",
        pendingEmail: user.pendingEmail,
      };
    }),

  getRecentSecurityEvents: protectedProcedure
    .input(
      z.object({
        limit: z.number().optional().default(10),
      }),
    )
    .query(async ({ input, ctx }) => {
      const events = await auditLogService.getRecentSecurityEvents(ctx.user!.id, input.limit);
      return events;
    }),

  verifyEmailChange: publicProcedure
    .input(
      z.object({
        token: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const userRepository = AppDataSource.getRepository(User);

      // Find all users with pending email changes (shouldn't be many)
      const usersWithPending = await userRepository.find({
        where: {
          emailVerificationTokenHash: Not(IsNull()),
        },
      });

      // Find the user with the matching token
      let user: User | null = null;
      for (const u of usersWithPending) {
        if (u.emailVerificationTokenHash) {
          const isValid = await verifyPassword(input.token, u.emailVerificationTokenHash);
          if (isValid) {
            user = u;
            break;
          }
        }
      }

      if (!user) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid or expired verification token",
        });
      }

      // Check if token has expired
      if (!user.emailVerificationExpiresAt || user.emailVerificationExpiresAt < new Date()) {
        await userRepository.update(user.id, {
          pendingEmail: null as any,
          emailVerificationTokenHash: null as any,
          emailVerificationExpiresAt: null as any,
        });
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Verification token has expired. Please request a new email change.",
        });
      }

      if (!user.pendingEmail) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No pending email change found",
        });
      }

      // Update email and clear verification fields
      const oldEmail = user.email;
      const newEmail = user.pendingEmail;

      await userRepository.update(user.id, {
        email: newEmail,
        pendingEmail: null as any,
        emailVerificationTokenHash: null as any,
        emailVerificationExpiresAt: null as any,
      });

      // Reload user to get updated data
      user = (await userRepository.findOne({ where: { id: user.id } }))!;

      // Log email change
      try {
        await auditLogService.logEmailChange(user.id, oldEmail, newEmail, {
          metadata: { verificationMethod: "email_token" },
        });

        // Send confirmation emails
        await emailService.initialize();

        const emailVariables = {
          userName: user.getFullName(),
          userEmail: newEmail,
          oldEmail,
          newEmail,
          companyName: "Hay",
          changedAt: new Date().toLocaleString(),
          ipAddress: "Unknown",
          location: "Unknown",
          supportUrl: "https://hay.chat/support",
          currentYear: new Date().getFullYear().toString(),
          companyAddress: "Hay Platform",
          websiteUrl: "https://hay.chat",
          preferencesUrl: "https://hay.chat/settings",
          recipientEmail: newEmail,
        };

        // Notify both old and new email
        await emailService.sendTemplateEmail({
          to: oldEmail,
          subject: "Your Email Address Has Been Changed",
          template: "email-changed",
          variables: { ...emailVariables, recipientEmail: oldEmail },
        });

        await emailService.sendTemplateEmail({
          to: newEmail,
          subject: "Your Email Address Has Been Changed",
          template: "email-changed",
          variables: emailVariables,
        });
      } catch (error) {
        console.error("Failed to send confirmation emails:", error);
        // Don't fail the verification if email sending fails
      }

      return {
        success: true,
        message: "Email address successfully updated",
      };
    }),

  cancelEmailChange: protectedProcedure.mutation(async ({ ctx }) => {
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({
      where: { id: ctx.user!.id },
    });

    if (!user) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }

    if (!user.pendingEmail) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No pending email change found",
      });
    }

    // Clear pending email change
    await userRepository.update(user.id, {
      pendingEmail: null as any,
      emailVerificationTokenHash: null as any,
      emailVerificationExpiresAt: null as any,
    });

    return {
      success: true,
      message: "Email change cancelled successfully",
    };
  }),

  resendEmailVerification: protectedProcedure.mutation(async ({ ctx }) => {
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({
      where: { id: ctx.user!.id },
    });

    if (!user) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }

    if (!user.pendingEmail) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No pending email change found",
      });
    }

    // Generate new verification token
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = await hashPassword(verificationToken, "argon2");

    // Update token and expiry
    user.emailVerificationTokenHash = tokenHash;
    user.emailVerificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    await userRepository.save(user);

    // Send verification email
    try {
      await emailService.initialize();

      const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      const verificationUrl = `${baseUrl}/verify-email?token=${verificationToken}`;

      const commonVariables = {
        userName: user.getFullName(),
        oldEmail: user.email,
        newEmail: user.pendingEmail,
        companyName: "Hay",
        requestTime: new Date().toLocaleString(),
        ipAddress: ctx.ipAddress || "Unknown",
        browser: ctx.userAgent || "Unknown",
        location: "Unknown",
        supportUrl: `${baseUrl}/support`,
        cancelUrl: `${baseUrl}/settings/profile`,
        currentYear: new Date().getFullYear().toString(),
        companyAddress: "Hay Platform",
        websiteUrl: "https://hay.chat",
        preferencesUrl: `${baseUrl}/settings`,
      };

      // Send verification email to new email address
      await emailService.sendTemplateEmail({
        to: user.pendingEmail,
        subject: "Verify Your New Email Address",
        template: "verify-email-change",
        variables: {
          ...commonVariables,
          verificationUrl,
          recipientEmail: user.pendingEmail,
        },
      });
    } catch (error) {
      console.error("Failed to resend verification email:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to resend verification email. Please try again.",
      });
    }

    return {
      success: true,
      message: "Verification email resent successfully",
    };
  }),

  // API Key management
  createApiKey: protectedProcedure
    .input(createApiKeySchema)
    .mutation(async ({ input, ctx }): Promise<ApiKeyResponse> => {
      // Generate API key
      const apiKey = generateApiKey();
      const keyHash = await hashApiKey(apiKey);

      // Create API key entity
      const apiKeyRepository = AppDataSource.getRepository(ApiKey);
      const apiKeyEntity = apiKeyRepository.create({
        userId: ctx.user!.id,
        keyHash,
        name: input.name,
        expiresAt: input.expiresAt,
        scopes: input.scopes || [],
        isActive: true,
      });

      await apiKeyRepository.save(apiKeyEntity);

      return {
        id: apiKeyEntity.id,
        key: apiKey, // Return the plain key only once
        name: apiKeyEntity.name,
        createdAt: apiKeyEntity.createdAt,
        expiresAt: apiKeyEntity.expiresAt,
        scopes: apiKeyEntity.scopes,
      };
    }),

  listApiKeys: protectedProcedure.query(async ({ ctx }) => {
    const apiKeyRepository = AppDataSource.getRepository(ApiKey);
    const apiKeys = await apiKeyRepository.find({
      where: { userId: ctx.user!.id, isActive: true },
      select: ["id", "name", "createdAt", "lastUsedAt", "expiresAt", "scopes"],
      order: { createdAt: "DESC" },
    });

    return apiKeys;
  }),

  revokeApiKey: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const apiKeyRepository = AppDataSource.getRepository(ApiKey);
      const apiKey = await apiKeyRepository.findOne({
        where: { id: input.id, userId: ctx.user!.id },
      });

      if (!apiKey) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API key not found",
        });
      }

      apiKey.isActive = false;
      await apiKeyRepository.save(apiKey);

      return { success: true };
    }),

  // Admin endpoints
  listUsers: adminProcedure.query(async () => {
    const userRepository = AppDataSource.getRepository(User);
    const users = await userRepository.find({
      select: ["id", "email", "isActive", "createdAt", "lastLoginAt"],
      order: { createdAt: "DESC" },
    });

    return users;
  }),

  deactivateUser: adminProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const userRepository = AppDataSource.getRepository(User);
      const user = await userRepository.findOne({
        where: { id: input.userId },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      user.isActive = false;
      await userRepository.save(user);

      return { success: true };
    }),

  // Online status endpoints
  heartbeat: protectedProcedure.mutation(async ({ ctx }) => {
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({
      where: { id: ctx.user!.id },
    });

    if (!user) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }

    user.updateLastSeen();
    await userRepository.save(user);

    return { success: true, lastSeenAt: user.lastSeenAt };
  }),

  updateStatus: protectedProcedure
    .input(z.object({ status: z.enum(["available", "away"]) }))
    .mutation(async ({ input, ctx }) => {
      const userRepository = AppDataSource.getRepository(User);
      const user = await userRepository.findOne({
        where: { id: ctx.user!.id },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      user.status = input.status;
      await userRepository.save(user);

      return { success: true, status: user.status };
    }),
});
