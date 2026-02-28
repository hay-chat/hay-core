import { t } from "@server/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { AppDataSource } from "@server/database/data-source";
import { User } from "@server/entities/user.entity";
import { Organization } from "@server/entities/organization.entity";
import { UserOrganization } from "@server/entities/user-organization.entity";
import { Not, IsNull } from "typeorm";
import { AuthCode } from "@server/entities/auth-code.entity";
import {
  hashPassword,
  verifyPassword,
  generateSessionId,
  hashApiKey,
  generateSecureToken,
} from "@server/lib/auth/utils/hashing";
import { generateTokens, verifyRefreshToken, refreshAccessToken } from "@server/lib/auth/utils/jwt";
import {
  protectedProcedure,
  protectedProcedureWithoutOrg,
  publicProcedure,
  adminProcedure,
} from "@server/trpc/middleware/auth";
import { auditLogService } from "@server/services/audit-log.service";
import { emailService } from "@server/services/email.service";
import * as crypto from "crypto";
import { getDashboardUrl } from "@server/config/env";
import { StorageService } from "@server/services/storage.service";
import { handleUpload } from "@server/lib/upload-helper";
import { rateLimitService } from "@server/services/rate-limit.service";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("auth");

/**
 * Helper function to get all organizations for a user with their roles
 */
async function getUserOrganizations(userId: string) {
  const userOrgRepository = AppDataSource.getRepository(UserOrganization);
  const userOrganizations = await userOrgRepository.find({
    where: { userId, isActive: true },
    relations: ["organization", "organization.logoUpload"],
    order: { createdAt: "ASC" },
  });

  const storageService = new StorageService();

  return userOrganizations.map((userOrg) => ({
    id: userOrg.organization.id,
    name: userOrg.organization.name,
    slug: userOrg.organization.slug,
    logo: userOrg.organization.logoUpload
      ? storageService.getPublicUrl(userOrg.organization.logoUpload)
      : null,
    role: userOrg.role,
    permissions: userOrg.permissions,
    joinedAt: userOrg.joinedAt,
    lastAccessedAt: userOrg.lastAccessedAt,
  }));
}

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
    emailVerified: z.boolean().optional().default(true),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

const refreshTokenSchema = z.object({
  refreshToken: z.string(),
});

export const authRouter = t.router({
  // Public endpoints
  login: publicProcedure.input(loginSchema).mutation(async ({ input, ctx }) => {
    const { email, password } = input;

    // Rate limit by IP: 10 attempts per 15 minutes
    const ipAddress = ctx.ipAddress || "unknown";
    const ipRateLimit = await rateLimitService.checkIpRateLimit(ipAddress, 10, 15 * 60, true);
    if (ipRateLimit.limited) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Too many login attempts. Please try again later.",
      });
    }

    // Rate limit by email: 5 attempts per 15 minutes
    const emailRateLimit = await rateLimitService.checkEmailRateLimit(email, 5, 15 * 60, true);
    if (emailRateLimit.limited) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Too many login attempts. Please try again later.",
      });
    }

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

    // Check if email is verified
    if (!user.emailVerified) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Email not verified. Please check your inbox for the verification link.",
        cause: { type: "EMAIL_NOT_VERIFIED", email: user.email },
      });
    }

    // Update last login time and last seen
    user.lastLoginAt = new Date();
    user.updateLastSeen();
    await userRepository.save(user);

    // Generate tokens
    const sessionId = generateSessionId();
    const tokens = generateTokens(user, sessionId);

    // Load all user organizations (multi-org support)
    const organizations = await getUserOrganizations(user.id);

    // Determine active organization
    // If user has UserOrganizations, use the most recently accessed one
    // Otherwise fall back to legacy organizationId
    let activeOrganizationId = user.organizationId;
    if (organizations.length > 0) {
      // Find most recently accessed, or first one if none have been accessed
      const mostRecent = organizations.reduce((prev, current) => {
        if (!prev.lastAccessedAt) return current;
        if (!current.lastAccessedAt) return prev;
        return new Date(current.lastAccessedAt) > new Date(prev.lastAccessedAt) ? current : prev;
      });
      activeOrganizationId = mostRecent.id;
    }

    return {
      user: {
        ...user.toJSON(),
        organizations,
        activeOrganizationId,
        onlineStatus: user.getOnlineStatus(),
      },
      ...tokens,
    };
  }),

  register: publicProcedure.input(registerSchema).mutation(async ({ input }) => {
    const {
      email,
      password,
      firstName,
      lastName,
      organizationName,
      organizationSlug,
      emailVerified,
    } = input;

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
        // Use organizationService to generate a unique slug
        const { organizationService } = await import("@server/services/organization.service");

        let orgSlug: string;
        if (organizationSlug) {
          // User provided a custom slug, check if it's available
          const existingOrg = await organizationService.findBySlug(organizationSlug);
          if (existingOrg) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Organization slug already exists",
            });
          }
          orgSlug = organizationSlug;
        } else {
          // Generate a unique slug automatically
          orgSlug = await organizationService.generateUniqueSlug(organizationName);
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
        emailVerified,
        organizationId: organization?.id,
        role: organization ? "owner" : "member", // Owner if creating org, otherwise member
      });

      // Update last seen on registration
      user.updateLastSeen();
      await userRepository.save(user);

      // Create UserOrganization entry if organization exists (multi-org support)
      if (organization) {
        const userOrgRepository = manager.getRepository(UserOrganization);
        const userOrg = userOrgRepository.create({
          userId: user.id,
          organizationId: organization.id,
          role: "owner",
          isActive: true,
          joinedAt: new Date(),
        });
        await userOrgRepository.save(userOrg);
      }

      // Generate tokens
      const sessionId = generateSessionId();
      const tokens = generateTokens(user, sessionId);

      // Load all user organizations (multi-org support)
      const organizations = await getUserOrganizations(user.id);

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

  requestPasswordReset: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input, ctx }) => {
      const { email } = input;

      // Rate limiting: 5 requests per day per email
      const rateLimitResult = await rateLimitService.checkEmailRateLimit(
        email,
        5, // max 5 requests
        24 * 60 * 60, // per 24 hours
      );

      if (rateLimitResult.limited) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many password reset requests. Please try again later.",
        });
      }

      // Find user by email
      const userRepository = AppDataSource.getRepository(User);
      const user = await userRepository.findOne({
        where: { email: email.toLowerCase() },
      });

      // Always return success to prevent user enumeration
      // Even if the user doesn't exist, we return success
      if (!user) {
        // Simulate some processing time to prevent timing attacks
        await new Promise((resolve) => setTimeout(resolve, 100));
        return {
          success: true,
          message: "If an account exists with this email, you will receive a password reset link.",
        };
      }

      // Check if user is active
      if (!user.isActive) {
        return {
          success: true,
          message: "If an account exists with this email, you will receive a password reset link.",
        };
      }

      try {
        // Generate reset token (high-entropy: 256 bits)
        // SHA-256 is sufficient for high-entropy tokens — no brute-force risk.
        // This enables direct DB lookup instead of O(n) argon2 scans.
        const resetToken = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");

        // Store token hash and expiration (24 hours)
        user.passwordResetTokenHash = tokenHash;
        user.passwordResetExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await userRepository.save(user);

        // Send password reset email
        await emailService.initialize();
        const baseUrl = getDashboardUrl();
        const resetLink = `${baseUrl}/reset-password?token=${resetToken}`;

        await emailService.sendTemplateEmail({
          to: user.email,
          subject: "Reset Your Password",
          template: "reset-password",
          variables: {
            userName: user.getFullName(),
            userEmail: user.email,
            companyName: "Hay",
            resetLink,
            expirationHours: "24",
            requestTime: new Date().toLocaleString(),
            requestIP: ctx.ipAddress || "Unknown",
            requestBrowser: ctx.userAgent || "Unknown",
            requestLocation: "Unknown", // TODO: Add geolocation lookup
            supportEmail: "support@hay.chat",
            currentYear: new Date().getFullYear().toString(),
            companyAddress: "Hay Platform",
            websiteUrl: baseUrl,
            preferencesUrl: `${baseUrl}/settings`,
            recipientEmail: user.email,
          },
        });

        // Log password reset request
        try {
          await auditLogService.logPasswordResetRequest(user.id, ctx.ipAddress, ctx.userAgent);
        } catch (error) {
          logger.error({ err: error }, "Failed to log password reset request");
        }

        return {
          success: true,
          message: "If an account exists with this email, you will receive a password reset link.",
        };
      } catch (error) {
        logger.error({ err: error }, "Failed to process password reset request");
        // Don't expose internal errors
        return {
          success: true,
          message: "If an account exists with this email, you will receive a password reset link.",
        };
      }
    }),

  verifyResetToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const userRepository = AppDataSource.getRepository(User);

      // Direct lookup by SHA-256 hash (O(1) instead of O(n) argon2 scans)
      const tokenHash = crypto.createHash("sha256").update(input.token).digest("hex");
      const user = await userRepository.findOne({
        where: { passwordResetTokenHash: tokenHash },
      });

      if (!user) {
        return {
          valid: false,
          message: "Invalid or expired reset token",
        };
      }

      // Check if token has expired
      if (!user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
        // Clear expired token
        user.clearPasswordReset();
        await userRepository.save(user);

        return {
          valid: false,
          message: "Reset token has expired. Please request a new password reset.",
        };
      }

      return {
        valid: true,
        email: user.email,
      };
    }),

  resetPassword: publicProcedure
    .input(
      z.object({
        token: z.string(),
        newPassword: z.string().min(8),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userRepository = AppDataSource.getRepository(User);

      // Direct lookup by SHA-256 hash (O(1) instead of O(n) argon2 scans)
      const tokenHash = crypto.createHash("sha256").update(input.token).digest("hex");
      const user = await userRepository.findOne({
        where: { passwordResetTokenHash: tokenHash },
      });

      if (!user) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid or expired reset token",
        });
      }

      // Check if token has expired
      if (!user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
        // Clear expired token
        user.clearPasswordReset();
        await userRepository.save(user);

        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Reset token has expired. Please request a new password reset.",
        });
      }

      // Hash new password
      user.password = await hashPassword(input.newPassword, "argon2");

      // Clear password reset fields
      user.clearPasswordReset();

      await userRepository.save(user);

      // Log password reset
      try {
        await auditLogService.logPasswordReset(user.id, ctx.ipAddress, ctx.userAgent);

        // Send confirmation email
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
            location: "Unknown",
            supportUrl: `${getDashboardUrl()}/support`,
            currentYear: new Date().getFullYear().toString(),
            companyAddress: "Hay Platform",
            websiteUrl: getDashboardUrl(),
            preferencesUrl: `${getDashboardUrl()}/settings`,
            recipientEmail: user.email,
          },
        });
      } catch (error) {
        logger.error({ err: error }, "Failed to log password reset or send email");
        // Don't fail the password reset if logging/email fails
      }

      return {
        success: true,
        message: "Your password has been successfully reset",
      };
    }),

  // Protected endpoints
  me: protectedProcedureWithoutOrg
    .output(
      z.object({
        id: z.string(),
        email: z.string(),
        pendingEmail: z.string().nullable().optional(),
        firstName: z.string().nullable().optional(),
        lastName: z.string().nullable().optional(),
        avatarUrl: z.string().nullable().optional(),
        isActive: z.boolean(),
        lastLoginAt: z.union([z.date(), z.string()]).nullable().optional(),
        lastSeenAt: z.union([z.date(), z.string()]).nullable().optional(),
        status: z.enum(["available", "away"]).optional(),
        onlineStatus: z.enum(["online", "away", "offline"]),
        authMethod: z.string(),
        organizations: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            slug: z.string(),
            logo: z.string().nullable().optional(),
            role: z.enum(["owner", "admin", "member", "viewer", "contributor", "agent"]),
            permissions: z.array(z.string()).nullable().optional(),
            joinedAt: z.union([z.date(), z.string()]).optional(),
            lastAccessedAt: z.union([z.date(), z.string()]).nullable().optional(),
          }),
        ),
        activeOrganizationId: z.string().optional(),
        role: z.enum(["owner", "admin", "member", "viewer", "contributor", "agent"]),
      }),
    )
    .query(async ({ ctx }) => {
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

      // Load all user organizations (multi-org support)
      const organizations = await getUserOrganizations(user.id);

      // Determine active organization
      // Use the one from context if available, otherwise use most recently accessed or legacy
      let activeOrganizationId = ctx.user!.organizationId || user.organizationId;
      if (!activeOrganizationId && organizations.length > 0) {
        const mostRecent = organizations.reduce((prev, current) => {
          if (!prev.lastAccessedAt) return current;
          if (!current.lastAccessedAt) return prev;
          return new Date(current.lastAccessedAt) > new Date(prev.lastAccessedAt) ? current : prev;
        });
        activeOrganizationId = mostRecent.id;
      }

      // Get role for active organization or fall back to user role
      let role = user.role;
      if (activeOrganizationId && organizations.length > 0) {
        const activeOrg = organizations.find((org) => org.id === activeOrganizationId);
        if (activeOrg) {
          role = activeOrg.role;
        }
      }

      return {
        id: user.id,
        email: user.email,
        pendingEmail: user.pendingEmail,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt,
        lastSeenAt: user.lastSeenAt,
        status: user.status,
        onlineStatus: user.getOnlineStatus(),
        authMethod: ctx.user!.authMethod,
        organizations,
        activeOrganizationId,
        role,
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
            supportUrl: `${getDashboardUrl()}/support`,
            currentYear: new Date().getFullYear().toString(),
            companyAddress: "Hay Platform",
            websiteUrl: getDashboardUrl(),
            preferencesUrl: `${getDashboardUrl()}/settings`,
            recipientEmail: user.email,
          },
        });
      } catch (error) {
        logger.error({ err: error }, "Failed to log password change or send email");
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
          logger.error({ err: error }, "Failed to log profile update");
        }
      }

      return {
        success: true,
        user: user.toJSON(),
      };
    }),

  uploadAvatar: protectedProcedure
    .input(
      z.object({
        avatar: z.string(), // base64 data URI
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

      try {
        const storageService = new StorageService();

        // Upload new avatar
        const result = await handleUpload(
          input.avatar,
          "avatars",
          ctx.user!.organizationId || "",
          ctx.user!.id,
          { maxSize: 2 * 1024 * 1024 }, // 2MB for avatars
        );

        // Delete old avatar upload if exists (extract ID from old URL)
        if (user.avatarUrl) {
          try {
            // The avatarUrl might contain the upload ID
            // We'll try to extract and delete the old upload
            const uploadIdMatch = user.avatarUrl.match(/\/uploads\/([a-f0-9-]+)/);
            if (uploadIdMatch) {
              await storageService.delete(uploadIdMatch[1]);
            }
          } catch (error) {
            logger.error({ err: error }, "Failed to delete old avatar");
            // Continue even if deletion fails
          }
        }

        // Update user with new avatar URL
        user.avatarUrl = result.url;
        await userRepository.save(user);

        return {
          success: true,
          avatarUrl: result.url,
        };
      } catch (error) {
        logger.error({ err: error }, "Failed to upload avatar");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to upload avatar. Please try again.",
        });
      }
    }),

  deleteAvatar: protectedProcedure.mutation(async ({ ctx }) => {
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

    if (!user.avatarUrl) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No avatar to delete",
      });
    }

    try {
      const storageService = new StorageService();

      // Extract upload ID from URL
      const uploadIdMatch = user.avatarUrl.match(/\/uploads\/([a-f0-9-]+)/);
      if (uploadIdMatch) {
        await storageService.delete(uploadIdMatch[1]);
      }

      // Clear avatar URL from user
      user.avatarUrl = null as any;
      await userRepository.save(user);

      return {
        success: true,
      };
    } catch (error) {
      logger.error({ err: error }, "Failed to delete avatar");
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to delete avatar. Please try again.",
      });
    }
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

      // Generate verification token (high-entropy: 256 bits, SHA-256 for direct lookup)
      const verificationToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(verificationToken).digest("hex");

      // Store pending email and token
      const oldEmail = user.email;
      user.pendingEmail = input.newEmail.toLowerCase();
      user.emailVerificationTokenHash = tokenHash;
      user.emailVerificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      await userRepository.save(user);

      // Send verification emails
      try {
        logger.debug("Initializing email service for email update");
        await emailService.initialize();
        logger.debug("Email service initialized");

        const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
        const verificationUrl = `${baseUrl}/verify-email?token=${verificationToken}`;

        logger.debug(
          { verificationUrl, newEmail: input.newEmail.toLowerCase(), oldEmail },
          "Sending email change verification emails",
        );

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
          websiteUrl: getDashboardUrl(),
          preferencesUrl: `${baseUrl}/settings`,
        };

        // Send verification email to NEW email
        logger.debug("Sending verification email to new address");
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
        logger.debug({ result: result1 }, "Verification email sent to new address");

        // Send notification to OLD email
        logger.debug("Sending notification email to old address");
        const result2 = await emailService.sendTemplateEmail({
          to: oldEmail,
          subject: "Email Change Pending Verification",
          template: "email-change-pending",
          variables: {
            ...commonVariables,
            recipientEmail: oldEmail,
          },
        });
        logger.debug({ result: result2 }, "Notification email sent to old address");

        logger.info("All email change verification emails sent successfully");
      } catch (error) {
        logger.error({ err: error }, "Failed to send verification emails");
        // Rollback the pending email change
        await userRepository.update(user.id, {
          pendingEmail: null as any,
          emailVerificationTokenHash: null as any,
          emailVerificationExpiresAt: null as any,
        });
        logger.warn("Rolled back pending email change due to email send failure");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to send verification email. Please try again.",
        });
      }

      return {
        success: true,
        message:
          "Verification email sent. Please check your new email address to complete the change.",
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

      // SHA-256 hash the token for direct DB lookup (O(1) instead of O(n) argon2 scan)
      const tokenHash = crypto.createHash("sha256").update(input.token).digest("hex");

      let user = await userRepository.findOne({
        where: {
          emailVerificationTokenHash: tokenHash,
        },
      });

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
          supportUrl: `${getDashboardUrl()}/support`,
          currentYear: new Date().getFullYear().toString(),
          companyAddress: "Hay Platform",
          websiteUrl: getDashboardUrl(),
          preferencesUrl: `${getDashboardUrl()}/settings`,
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
        logger.error({ err: error }, "Failed to send confirmation emails");
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

  // ─── Signup Email Verification ──────────────────────────────

  /**
   * Request a signup verification token for the authenticated user.
   * Called right after registration when emailVerified is false.
   * Returns the plain token so the caller (backoffice) can include it in the verification email.
   */
  requestEmailVerification: protectedProcedureWithoutOrg.mutation(async ({ ctx }) => {
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({
      where: { id: ctx.user!.id },
    });

    if (!user) {
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    }

    if (user.emailVerified) {
      return { success: true, token: null, expiresAt: null, message: "Email already verified" };
    }

    // Generate verification token (SHA-256 for O(1) DB lookup)
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(verificationToken).digest("hex");

    user.emailVerificationTokenHash = tokenHash;
    user.emailVerificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    await userRepository.save(user);

    return {
      success: true,
      token: verificationToken,
      expiresAt: user.emailVerificationExpiresAt.toISOString(),
      message: "Verification token generated",
    };
  }),

  /**
   * Verify a user's email using a signup verification token.
   * Public endpoint — no auth required.
   */
  verifyEmail: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const tokenHash = crypto.createHash("sha256").update(input.token).digest("hex");

      const userRepository = AppDataSource.getRepository(User);
      const user = await userRepository.findOne({
        where: { emailVerificationTokenHash: tokenHash },
      });

      if (!user) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid or expired verification token",
        });
      }

      // Check expiry
      if (!user.emailVerificationExpiresAt || user.emailVerificationExpiresAt < new Date()) {
        user.clearEmailVerification();
        await userRepository.save(user);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Verification link has expired. Please request a new one.",
        });
      }

      // Mark as verified, clear token fields
      user.emailVerified = true;
      user.clearEmailVerification();
      await userRepository.save(user);

      return { success: true, message: "Email verified successfully", email: user.email };
    }),

  /**
   * Resend signup verification email for an unverified user.
   * Public endpoint (accepts email) — sends verification email directly.
   * Always returns success to prevent user enumeration.
   */
  resendSignupVerification: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input }) => {
      const { email } = input;

      // Rate limit: 3 requests per hour per email
      const rateLimitResult = await rateLimitService.checkEmailRateLimit(email, 3, 60 * 60);
      if (rateLimitResult.limited) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many requests. Please try again later.",
        });
      }

      const userRepository = AppDataSource.getRepository(User);
      const user = await userRepository.findOne({
        where: { email: email.toLowerCase() },
      });

      // Always return success to prevent user enumeration
      if (!user || !user.isActive || user.emailVerified) {
        await new Promise((resolve) => setTimeout(resolve, 100)); // Timing attack prevention
        return {
          success: true,
          message: "If an unverified account exists, a new verification link will be sent.",
        };
      }

      // Generate new verification token
      const verificationToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(verificationToken).digest("hex");

      user.emailVerificationTokenHash = tokenHash;
      user.emailVerificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await userRepository.save(user);

      // Send verification email
      try {
        await emailService.initialize();

        const baseUrl = getDashboardUrl();
        const verificationUrl = `${baseUrl}/verify-email?token=${verificationToken}&type=signup`;

        await emailService.sendTemplateEmail({
          to: user.email,
          subject: "Verify Your Email Address",
          template: "verify-signup-email",
          variables: {
            userName: user.getFullName(),
            verificationUrl,
            companyName: "Hay",
            currentYear: new Date().getFullYear().toString(),
            companyAddress: "Hay Platform",
            websiteUrl: "https://hay.chat",
          },
        });
      } catch (error) {
        logger.error({ err: error }, "Failed to send signup verification email");
        // Don't throw - token was saved, user can retry
      }

      return {
        success: true,
        message: "If an unverified account exists, a new verification link will be sent.",
      };
    }),

  // ─── Email Change Verification (resend) ─────────────────────

  resendEmailChangeVerification: protectedProcedure.mutation(async ({ ctx }) => {
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

    // Generate new verification token (SHA-256 for high-entropy tokens — enables O(1) DB lookup)
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(verificationToken).digest("hex");

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
      logger.error({ err: error }, "Failed to resend verification email");
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

  // Auth code exchange (for cross-domain authentication, e.g. backoffice → dashboard)
  generateAuthCode: protectedProcedureWithoutOrg.mutation(async ({ ctx }) => {
    const rawCode = generateSecureToken(32);
    const codeHash = await hashApiKey(rawCode);

    const authCodeRepo = AppDataSource.getRepository(AuthCode);
    const authCode = authCodeRepo.create({
      userId: ctx.user!.id,
      codeHash,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      used: false,
    });
    await authCodeRepo.save(authCode);

    return {
      code: rawCode,
      expiresAt: authCode.expiresAt,
    };
  }),

  exchangeAuthCode: publicProcedure
    .input(z.object({ code: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const codeHash = await hashApiKey(input.code);

      const authCodeRepo = AppDataSource.getRepository(AuthCode);
      const authCode = await authCodeRepo.findOne({
        where: { codeHash, used: false },
        relations: ["user"],
      });

      if (!authCode || !authCode.isValid()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid or expired auth code",
        });
      }

      // Mark as used immediately (single-use)
      authCode.used = true;
      await authCodeRepo.save(authCode);

      const user = authCode.user!;

      if (!user.isActive) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Account is deactivated",
        });
      }

      // Check if email is verified
      if (!user.emailVerified) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Email not verified. Please check your inbox for the verification link.",
          cause: { type: "EMAIL_NOT_VERIFIED", email: user.email },
        });
      }

      // Update last login
      const userRepository = AppDataSource.getRepository(User);
      user.lastLoginAt = new Date();
      user.updateLastSeen();
      await userRepository.save(user);

      // Generate tokens
      const sessionId = generateSessionId();
      const tokens = generateTokens(user, sessionId);

      // Load all user organizations
      const organizations = await getUserOrganizations(user.id);

      // Determine active organization
      let activeOrganizationId = user.organizationId;
      if (organizations.length > 0) {
        const mostRecent = organizations.reduce((prev, current) => {
          if (!prev.lastAccessedAt) return current;
          if (!current.lastAccessedAt) return prev;
          return new Date(current.lastAccessedAt) > new Date(prev.lastAccessedAt) ? current : prev;
        });
        activeOrganizationId = mostRecent.id;
      }

      return {
        user: {
          ...user.toJSON(),
          organizations,
          activeOrganizationId,
          onlineStatus: user.getOnlineStatus(),
        },
        ...tokens,
      };
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
