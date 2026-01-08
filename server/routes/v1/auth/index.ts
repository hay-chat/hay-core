import { t } from "@server/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { AppDataSource } from "@server/database/data-source";
import { User } from "@server/entities/user.entity";
import { Organization } from "@server/entities/organization.entity";
import { UserOrganization } from "@server/entities/user-organization.entity";
import { Not, IsNull } from "typeorm";
import {
  hashPassword,
  verifyPassword,
  generateSessionId,
} from "@server/lib/auth/utils/hashing";
import { generateTokens, verifyRefreshToken, refreshAccessToken } from "@server/lib/auth/utils/jwt";
import { protectedProcedure, protectedProcedureWithoutOrg, publicProcedure, adminProcedure } from "@server/trpc/middleware/auth";
import { auditLogService } from "@server/services/audit-log.service";
import { emailService } from "@server/services/email.service";
import * as crypto from "crypto";
import { getDashboardUrl } from "@server/config/env";
import { StorageService } from "@server/services/storage.service";
import { handleUpload } from "@server/lib/upload-helper";
import { rateLimitService } from "@server/services/rate-limit.service";

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
        // Generate reset token
        const resetToken = crypto.randomBytes(32).toString("hex");
        const tokenHash = await hashPassword(resetToken, "argon2");

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
          console.error("Failed to log password reset request:", error);
        }

        return {
          success: true,
          message: "If an account exists with this email, you will receive a password reset link.",
        };
      } catch (error) {
        console.error("Failed to process password reset request:", error);
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

      // Find all users with pending password resets
      const usersWithResets = await userRepository.find({
        where: {
          passwordResetTokenHash: Not(IsNull()),
        },
      });

      // Find the user with the matching token
      let user: User | null = null;
      for (const u of usersWithResets) {
        if (u.passwordResetTokenHash) {
          const isValid = await verifyPassword(input.token, u.passwordResetTokenHash);
          if (isValid) {
            user = u;
            break;
          }
        }
      }

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
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userRepository = AppDataSource.getRepository(User);

      // Find all users with pending password resets
      const usersWithResets = await userRepository.find({
        where: {
          passwordResetTokenHash: Not(IsNull()),
        },
      });

      // Find the user with the matching token
      let user: User | null = null;
      for (const u of usersWithResets) {
        if (u.passwordResetTokenHash) {
          const isValid = await verifyPassword(input.token, u.passwordResetTokenHash);
          if (isValid) {
            user = u;
            break;
          }
        }
      }

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
        console.error("Failed to log password reset or send email:", error);
        // Don't fail the password reset if logging/email fails
      }

      return {
        success: true,
        message: "Your password has been successfully reset",
      };
    }),

  // Protected endpoints
  me: protectedProcedureWithoutOrg
    .output(z.object({
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
      organizations: z.array(z.object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
        logo: z.string().nullable().optional(),
        role: z.enum(["owner", "admin", "member", "viewer", "contributor", "agent"]),
        permissions: z.array(z.string()).nullable().optional(),
        joinedAt: z.union([z.date(), z.string()]).optional(),
        lastAccessedAt: z.union([z.date(), z.string()]).nullable().optional(),
      })),
      activeOrganizationId: z.string().optional(),
      role: z.enum(["owner", "admin", "member", "viewer", "contributor", "agent"]),
    }))
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
      const activeOrg = organizations.find(org => org.id === activeOrganizationId);
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
            console.error("Failed to delete old avatar:", error);
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
        console.error("Failed to upload avatar:", error);
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
      console.error("Failed to delete avatar:", error);
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
          websiteUrl: getDashboardUrl(),
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

  // API Key management has been moved to /api-tokens router
  // See server/routes/v1/api-tokens/index.ts for organization-scoped API tokens

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
