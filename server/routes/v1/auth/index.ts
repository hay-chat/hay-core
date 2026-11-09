import { t } from "@server/trpc";
import { z } from "zod";
import { isValidUuid } from "@server/lib/validation/uuid";
import { IsNull, type EntityManager } from "typeorm";
import { TRPCError } from "@trpc/server";
import { AppDataSource } from "@server/database/data-source";
import { User } from "@server/entities/user.entity";
import { UserOrganization } from "@server/entities/user-organization.entity";
import { AuthCode } from "@server/entities/auth-code.entity";
import { OrganizationInvitation } from "@server/entities/organization-invitation.entity";
import {
  hashPassword,
  verifyPassword,
  hashApiKey,
  generateSecureToken,
} from "@server/lib/auth/utils/hashing";
import { authSessionService, RefreshRejectedError } from "@server/services/auth-session.service";
import { pushNotificationService } from "@server/services/push-notification.service";
import {
  protectedProcedure,
  protectedProcedureWithoutOrg,
  publicProcedure,
} from "@server/trpc/middleware/auth";
import { auditLogService } from "@server/services/audit-log.service";
import { emailService, getOrganizationLocale } from "@server/services/email.service";
import { DEFAULT_LANGUAGE } from "@server/types/language.types";
import * as crypto from "crypto";
import { config, getDashboardUrl } from "@server/config/env";
import { StorageService } from "@server/services/storage.service";
import { handleUpload } from "@server/lib/upload-helper";
import { assertPasswordNotBreached, newPasswordSchema } from "@server/lib/auth/password-policy";
import { clearRefreshCookies, readRefreshCookie } from "@server/lib/auth/session-cookie";
import { rateLimitService, type RateLimitScope } from "@server/services/rate-limit.service";
import { rateLimitMiddleware } from "@server/trpc/middleware/rate-limit";
import {
  AGENT_PAUSE_REASONS,
  SUSPENSION_REASONS,
  accessNoticeSchema,
} from "@server/types/organization-access.types";
import { createLogger } from "@server/lib/logger";
import { MFA_CHALLENGE_TTL_SECONDS, generateMfaChallengeToken } from "@server/lib/auth/utils/jwt";
import { mfaService } from "@server/services/mfa.service";
import { mfaRouter } from "./mfa";
import {
  PASSWORD_CHECK_RATE_LIMIT,
  completeLogin,
  deliverTokens,
  getUserOrganizations,
  requireSessionUser,
} from "./shared";
import { enableDefaultPlugins } from "@server/services/default-plugins.service";
import {
  createAccount,
  issueSignupVerificationToken,
  sendSignupVerificationEmail,
} from "@server/services/account-registration.service";

const logger = createLogger("auth");

const passwordSchema = z.string().min(8).max(128);

const loginSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  useCookie: z.boolean().optional(),
});

const registerSchema = z
  .object({
    email: z.string().email(),
    password: newPasswordSchema,
    confirmPassword: z.string().max(128),
    firstName: z.string().max(255).optional(),
    lastName: z.string().max(255).optional(),
    organizationName: z.string().max(255).optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

/**
 * `useCookie`: the caller is the dashboard, which keeps the refresh token in
 * an HttpOnly cookie. Other clients (hay CLI, external apps) get it in the body.
 */
const useCookieField = z.boolean().optional();

const refreshTokenSchema = z.object({
  refreshToken: z.string().optional(),
  useCookie: useCookieField,
});

/** A password being changed must differ from the current one and not be known to be breached. */
async function assertNewPasswordAllowed(user: User, newPassword: string): Promise<void> {
  if (await verifyPassword(newPassword, user.password)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a password different from your current one.",
    });
  }
  await assertPasswordNotBreached(newPassword);
}

/**
 * Auth codes only go to origins in CONNECT_ALLOWED_REDIRECT_ORIGINS
 * (comma-separated). Deny-by-default: unset means no destination is allowed.
 */
function allowlistedRedirectUrl(redirectUri: string): URL {
  const allowed = (process.env.CONNECT_ALLOWED_REDIRECT_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  let redirectUrl: URL;
  try {
    redirectUrl = new URL(redirectUri);
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid redirect_uri" });
  }

  if (!allowed.includes(redirectUrl.origin)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "redirect_uri origin is not allowlisted",
    });
  }
  return redirectUrl;
}

/** Generous: offices share an address, and each open dashboard refreshes several times an hour. */
const REFRESH_IP_LIMIT = { scope: "refresh-token", max: 300, windowSeconds: 15 * 60 } as const;
const EXCHANGE_IP_LIMIT = { scope: "exchange-auth-code", max: 60, windowSeconds: 15 * 60 } as const;

/** Allows the request when the limiter is unavailable, so an outage does not sign people out. */
async function assertWithinIpLimit(
  ipAddress: string | undefined,
  limit: { scope: RateLimitScope; max: number; windowSeconds: number },
): Promise<void> {
  const { limited } = await rateLimitService.checkIpRateLimit(
    ipAddress || "unknown",
    limit.max,
    limit.windowSeconds,
    { scope: limit.scope },
  );
  if (limited) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many requests. Please try again later.",
    });
  }
}

/** A single-use, 10-minute auth code for the user. */
async function createAuthCode(
  userId: string,
  redirectOrigin: string,
): Promise<{ code: string; expiresAt: Date }> {
  const code = generateSecureToken(32);
  const authCodeRepo = AppDataSource.getRepository(AuthCode);
  const authCode = authCodeRepo.create({
    userId,
    codeHash: await hashApiKey(code),
    redirectOrigin,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    used: false,
  });
  await authCodeRepo.save(authCode);
  return { code, expiresAt: authCode.expiresAt };
}

/**
 * With ALLOW_SIGNUP=false, a new account may only be created by the instance's
 * first user or by someone holding a pending invitation.
 */
async function assertSignupAllowed(manager: EntityManager, email: string): Promise<void> {
  const userCount = await manager.getRepository(User).count();
  if (userCount === 0) return;

  const invitations = await manager
    .getRepository(OrganizationInvitation)
    .createQueryBuilder("invitation")
    .where("LOWER(invitation.email) = :email", { email: email.toLowerCase() })
    .getMany();
  if (invitations.some((invitation) => invitation.canAccept())) return;

  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Sign-up is closed on this server. Ask an administrator for an invitation.",
    cause: { type: "SIGNUP_CLOSED" },
  });
}

export const authRouter = t.router({
  mfa: mfaRouter,

  // Public endpoints

  /**
   * Whether the signup form is open to anyone, so the dashboard can say so
   * before the form is filled in. Invitations still work when it is closed.
   */
  signupStatus: publicProcedure.query(async () => {
    const open = config.auth.allowSignup || (await AppDataSource.getRepository(User).count()) === 0;
    return { open, signupUrl: open ? null : config.auth.signupUrl };
  }),

  login: publicProcedure.input(loginSchema).mutation(async ({ input, ctx }) => {
    const { email, password } = input;

    // Rate limit by IP: 10 attempts per 15 minutes
    const ipAddress = ctx.ipAddress || "unknown";
    const ipRateLimit = await rateLimitService.checkIpRateLimit(ipAddress, 10, 15 * 60, {
      scope: "login",
      failClosed: true,
    });
    if (ipRateLimit.limited) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Too many login attempts. Please try again later.",
      });
    }

    // Rate limit by email: 5 failed attempts per 15 minutes. Counted before the
    // password check so concurrent guesses all count; a correct password clears it.
    const emailRateLimit = await rateLimitService.checkEmailRateLimit(email, 5, 15 * 60, {
      scope: "login",
      failClosed: true,
    });
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
      await auditLogService.logFailedLogin(email, ctx.ipAddress, ctx.userAgent);
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid credentials",
      });
    }

    // Verify password
    const isValidPassword = await verifyPassword(password, user.password);
    if (!isValidPassword) {
      await auditLogService.logFailedLogin(email, ctx.ipAddress, ctx.userAgent);
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid credentials",
      });
    }
    await rateLimitService.resetRateLimit(email, "email", "login");

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

    // Older accounts hold bcrypt hashes; move them to argon2 while the password is at hand.
    if (user.password.startsWith("$2")) {
      user.password = await hashPassword(password, "argon2");
      await userRepository.save(user);
    }

    if (await mfaService.findConfirmed(user.id)) {
      return {
        mfaRequired: true as const,
        challengeToken: generateMfaChallengeToken(user),
        expiresIn: MFA_CHALLENGE_TTL_SECONDS,
      };
    }

    return completeLogin(user, ctx, input.useCookie);
  }),

  /**
   * Create an account and email a verification link. No session is issued:
   * the user signs in once the email is verified. The response is the same
   * whether or not the email is already registered.
   */
  register: publicProcedure.input(registerSchema).mutation(async ({ input, ctx }) => {
    // Per IP: 10 signups per hour. Per email: 5 attempts per 15 minutes.
    const ipLimit = await rateLimitService.checkKeyRateLimit(
      `signup:ip:${ctx.ipAddress || "unknown"}`,
      10,
      60 * 60,
      true,
    );
    const emailLimit = await rateLimitService.checkKeyRateLimit(
      `signup:email:${input.email.toLowerCase()}`,
      5,
      15 * 60,
      true,
    );
    if (ipLimit.limited || emailLimit.limited) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Too many signup attempts. Please try again later.",
      });
    }

    await assertPasswordNotBreached(input.password);

    if (!config.auth.allowSignup) {
      await assertSignupAllowed(AppDataSource.manager, input.email);
    }

    const response = {
      success: true,
      emailVerificationRequired: config.auth.requireEmailVerification,
      message: config.auth.requireEmailVerification
        ? "Check your inbox to verify your email address, then sign in."
        : "Your account is ready. Sign in to continue.",
    };

    const existingUser = await AppDataSource.getRepository(User).findOne({
      where: { email: input.email.toLowerCase() },
    });
    if (existingUser) {
      // Same work as a real signup so response time doesn't reveal the account.
      await hashPassword(input.password, "argon2");
      return response;
    }

    const { user, organization } = await AppDataSource.transaction((manager) =>
      createAccount(manager, {
        ...input,
        emailVerified: !config.auth.requireEmailVerification,
      }),
    );

    // After commit: give the new organization its default plugins (fire-and-forget).
    if (organization) void enableDefaultPlugins(organization.id);
    await auditLogService.record({
      userId: user.id,
      organizationId: organization?.id,
      action: "user.register",
      resource: "auth",
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    if (!config.auth.requireEmailVerification) return response;

    // Off the response path, so timing doesn't tell new and existing emails apart.
    // On failure the user can request a new link from the login page.
    void issueSignupVerificationToken(user)
      .then((token) => sendSignupVerificationEmail(user, token))
      .catch((error) => logger.error({ err: error }, "Failed to send signup verification email"));

    return response;
  }),

  /**
   * Rotate: returns a new access token AND a new refresh token (set as the
   * cookie when the caller uses one). UNAUTHORIZED means "log out"; any other
   * error (database down, ...) is transient and the client keeps its session.
   */
  refreshToken: publicProcedure.input(refreshTokenSchema).mutation(async ({ input, ctx }) => {
    await assertWithinIpLimit(ctx.ipAddress, REFRESH_IP_LIMIT);
    const fromCookie = input.refreshToken ? undefined : readRefreshCookie(ctx.req);
    const refreshToken = input.refreshToken ?? fromCookie;
    if (!refreshToken) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid or expired refresh token" });
    }
    try {
      const tokens = await authSessionService.refresh(refreshToken, ctx);
      return deliverTokens(ctx, tokens, input.useCookie || Boolean(fromCookie));
    } catch (error) {
      if (error instanceof RefreshRejectedError) {
        if (fromCookie) clearRefreshCookies(ctx.res);
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid or expired refresh token",
          cause: { type: "REFRESH_REJECTED", reason: error.reason },
        });
      }
      logger.error({ err: error }, "Refresh failed for a non-auth reason");
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Could not refresh the session, please retry",
      });
    }
  }),

  requestPasswordReset: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input, ctx }) => {
      const { email } = input;

      // Per IP first, so one address cannot spend a victim's per-email allowance.
      const ipLimit = await rateLimitService.checkIpRateLimit(
        ctx.ipAddress || "unknown",
        20,
        60 * 60,
        { scope: "password-reset", failClosed: true },
      );
      // Rate limiting: 5 requests per day per email
      const rateLimitResult = ipLimit.limited
        ? ipLimit
        : await rateLimitService.checkEmailRateLimit(
            email,
            5, // max 5 requests
            24 * 60 * 60, // per 24 hours
            { scope: "password-reset", failClosed: true },
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

        // Store token hash and expiration (1 hour)
        user.passwordResetTokenHash = tokenHash;
        user.passwordResetExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
        await userRepository.save(user);

        // Send password reset email
        await emailService.initialize();
        const baseUrl = getDashboardUrl();
        const resetLink = `${baseUrl}/reset-password?token=${resetToken}`;

        const userOrg = await AppDataSource.getRepository(UserOrganization).findOne({
          where: { userId: user.id },
          relations: ["organization"],
        });
        const locale = userOrg?.organization?.defaultLanguage || DEFAULT_LANGUAGE;

        await emailService.sendTemplateEmail({
          to: user.email,
          locale,
          template: "reset-password",
          variables: {
            userName: user.getFullName(),
            userEmail: user.email,
            companyName: "Hay.chat",
            resetLink,
            requestTime: new Date().toLocaleString(),
            requestIP: ctx.ipAddress || "Unknown",
            requestBrowser: ctx.userAgent || "Unknown",
            requestLocation: "Unknown", // TODO: Add geolocation lookup
            supportEmail: "support@hay.chat",
            currentYear: new Date().getFullYear().toString(),
            companyAddress: "Hay.chat",
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
    .mutation(async ({ input }) => {
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
        newPassword: newPasswordSchema,
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

      await assertNewPasswordAllowed(user, input.newPassword);

      // Hash new password
      user.password = await hashPassword(input.newPassword, "argon2");

      // Invalidate all existing tokens by incrementing tokenVersion
      user.tokenVersion = (user.tokenVersion ?? 0) + 1;

      // Clear password reset fields
      user.clearPasswordReset();

      await userRepository.save(user);

      // Log password reset
      try {
        await auditLogService.logPasswordReset(user.id, ctx.ipAddress, ctx.userAgent);

        // Send confirmation email
        await emailService.initialize();
        const userOrg = await AppDataSource.getRepository(UserOrganization).findOne({
          where: { userId: user.id },
          relations: ["organization"],
        });
        const locale = userOrg?.organization?.defaultLanguage || DEFAULT_LANGUAGE;

        await emailService.sendTemplateEmail({
          to: user.email,
          locale,
          template: "password-changed",
          variables: {
            userName: user.getFullName(),
            userEmail: user.email,
            companyName: "Hay.chat",
            changedAt: new Date().toLocaleString(),
            ipAddress: ctx.ipAddress || "Unknown",
            browser: ctx.userAgent || "Unknown",
            location: "Unknown",
            supportUrl: `${getDashboardUrl()}/support`,
            currentYear: new Date().getFullYear().toString(),
            companyAddress: "Hay.chat",
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
            suspendedAt: z.union([z.date(), z.string()]).nullable(),
            suspensionReason: z.enum(SUSPENSION_REASONS).nullable(),
            suspensionRedirectUrl: z.string().nullable(),
            agentPausedAt: z.union([z.date(), z.string()]).nullable(),
            agentPauseReason: z.enum(AGENT_PAUSE_REASONS).nullable(),
            accessNotice: accessNoticeSchema.nullable(),
            aiPausedAt: z.union([z.date(), z.string()]).nullable(),
            aiPausedByUserId: z.string().nullable(),
          }),
        ),
        activeOrganizationId: z.string().optional(),
        role: z.enum(["owner", "admin", "member", "viewer", "contributor", "agent"]),
        mfaEnrolmentRequired: z.boolean(),
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
        mfaEnrolmentRequired: await mfaService.enrolmentRequired(user.id),
      };
    }),

  /**
   * End this device's session. Public on purpose: holding the refresh token is
   * the proof, and logout must work after the access token has expired.
   * `pushEndpoint` is this device's Web Push subscription: a logged-out phone
   * must stop showing customer names on its lock screen.
   */
  logout: publicProcedure
    .input(refreshTokenSchema.extend({ pushEndpoint: z.string().url().max(2048).optional() }))
    .mutation(async ({ input, ctx }) => {
      const refreshToken = input.refreshToken ?? readRefreshCookie(ctx.req);
      if (input.useCookie) clearRefreshCookies(ctx.res);
      const userId = refreshToken ? await authSessionService.revoke(refreshToken) : null;
      if (userId)
        await auditLogService.record({
          userId,
          action: "user.logout",
          resource: "auth",
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });
      if (userId && input.pushEndpoint) {
        await pushNotificationService.unsubscribe(userId, input.pushEndpoint);
      }
      return { success: true };
    }),

  /** Where this account is signed in, for the profile page. */
  listSessions: protectedProcedureWithoutOrg.query(async ({ ctx }) => {
    const user = requireSessionUser(ctx);
    const sessions = await authSessionService.listActive(user.id);
    return sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      expiresAt: session.expiresAt,
      ipAddress: session.ipAddress ?? null,
      userAgent: session.userAgent ?? null,
      current: session.id === user.sessionId,
    }));
  }),

  /** Sign out one device. Its access token keeps working until it expires (15 minutes). */
  revokeSession: protectedProcedureWithoutOrg
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const user = requireSessionUser(ctx);
      const revoked = await authSessionService.revokeForUser(user.id, input.sessionId);
      if (!revoked) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      await auditLogService.record({
        userId: user.id,
        action: "user.session_revoke",
        resource: "auth",
        changes: { sessionId: input.sessionId },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      return { success: true };
    }),

  /** Sign out everywhere else, keeping the session this request belongs to. */
  revokeAllOtherSessions: protectedProcedureWithoutOrg.mutation(async ({ ctx }) => {
    const user = requireSessionUser(ctx);
    if (!user.sessionId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Refresh your session and try again" });
    }
    const revoked = await authSessionService.revokeOthers(user.id, user.sessionId);
    await auditLogService.record({
      userId: user.id,
      action: "user.session_revoke_others",
      resource: "auth",
      changes: { revoked },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return { revoked };
  }),

  changePassword: protectedProcedure
    .use(rateLimitMiddleware(PASSWORD_CHECK_RATE_LIMIT))
    .input(
      z.object({
        currentPassword: z.string().max(128),
        newPassword: newPasswordSchema,
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

      await assertNewPasswordAllowed(user, input.newPassword);

      // Hash new password and invalidate all existing tokens
      user.password = await hashPassword(input.newPassword, "argon2");
      user.tokenVersion = (user.tokenVersion ?? 0) + 1;
      await userRepository.save(user);

      // Log password change
      try {
        await auditLogService.logPasswordChange(user.id, {
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });

        // Send email notification
        await emailService.initialize();
        const locale = await getOrganizationLocale(ctx.organizationId);
        await emailService.sendTemplateEmail({
          to: user.email,
          locale,
          template: "password-changed",
          variables: {
            userName: user.getFullName(),
            userEmail: user.email,
            companyName: "Hay.chat",
            changedAt: new Date().toLocaleString(),
            ipAddress: ctx.ipAddress || "Unknown",
            browser: ctx.userAgent || "Unknown",
            location: "Unknown", // TODO: Add geolocation lookup
            supportUrl: `${getDashboardUrl()}/support`,
            currentYear: new Date().getFullYear().toString(),
            companyAddress: "Hay.chat",
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
    .use(rateLimitMiddleware(PASSWORD_CHECK_RATE_LIMIT))
    .input(
      z.object({
        password: z.string().max(128),
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

      const changes: Record<string, { old?: string; new?: string }> = {};

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

      const organizationId = ctx.user!.organizationId;
      if (!organizationId || !isValidUuid(organizationId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Select an organization before uploading an avatar",
        });
      }

      try {
        const storageService = new StorageService();

        // Upload new avatar
        const result = await handleUpload(
          input.avatar,
          "avatars",
          organizationId,
          ctx.user!.id,
          { maxSize: 2 * 1024 * 1024 }, // 2MB for avatars
        );

        // Delete old avatar upload if exists
        if (user.avatarUrl) {
          try {
            await storageService.deleteByPublicUrl(user.avatarUrl, "avatars", user.id);
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

      await storageService.deleteByPublicUrl(user.avatarUrl, "avatars", user.id);

      // Clear avatar URL from user
      await userRepository.update(user.id, { avatarUrl: () => "NULL" });

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
    .use(rateLimitMiddleware(PASSWORD_CHECK_RATE_LIMIT))
    .input(
      z.object({
        newEmail: z.string().email(),
        currentPassword: z.string().max(128),
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

      // A taken address gets the same answer as a free one, so this can't be
      // used to find out who has an account.
      if (existingUser && existingUser.id !== user.id) {
        logger.info({ userId: user.id }, "Email change requested to an address already in use");
        return {
          success: true,
          message:
            "Verification email sent. Please check your new email address to complete the change.",
          pendingEmail: input.newEmail.toLowerCase(),
        };
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

        const baseUrl = process.env.FRONTEND_URL || getDashboardUrl();
        const verificationUrl = `${baseUrl}/verify-email?token=${verificationToken}`;

        logger.debug("Sending email change verification emails");

        const commonVariables = {
          userName: user.getFullName(),
          oldEmail,
          newEmail: input.newEmail.toLowerCase(),
          companyName: "Hay.chat",
          requestTime: new Date().toLocaleString(),
          ipAddress: ctx.ipAddress || "Unknown",
          browser: ctx.userAgent || "Unknown",
          location: "Unknown", // TODO: Add geolocation lookup
          supportUrl: `${baseUrl}/support`,
          cancelUrl: `${baseUrl}/settings/profile`,
          currentYear: new Date().getFullYear().toString(),
          companyAddress: "Hay.chat",
          websiteUrl: getDashboardUrl(),
          preferencesUrl: `${baseUrl}/settings`,
        };

        // Send verification email to NEW email
        const locale = await getOrganizationLocale(ctx.organizationId);
        logger.debug("Sending verification email to new address");
        const result1 = await emailService.sendTemplateEmail({
          to: input.newEmail.toLowerCase(),
          locale,
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
          locale,
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
          pendingEmail: () => "NULL",
          emailVerificationTokenHash: () => "NULL",
          emailVerificationExpiresAt: () => "NULL",
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
        limit: z.number().int().min(1).max(100).optional().default(10),
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
          pendingEmail: () => "NULL",
          emailVerificationTokenHash: () => "NULL",
          emailVerificationExpiresAt: () => "NULL",
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

      // The address may have been registered since the change was requested.
      const addressTaken = await userRepository.findOne({ where: { email: newEmail } });
      if (addressTaken && addressTaken.id !== user.id) {
        await userRepository.update(user.id, {
          pendingEmail: () => "NULL",
          emailVerificationTokenHash: () => "NULL",
          emailVerificationExpiresAt: () => "NULL",
        });
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid or expired verification token",
        });
      }

      await userRepository.update(user.id, {
        email: newEmail,
        pendingEmail: () => "NULL",
        emailVerificationTokenHash: () => "NULL",
        emailVerificationExpiresAt: () => "NULL",
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

        const userOrg = await AppDataSource.getRepository(UserOrganization).findOne({
          where: { userId: user.id },
          relations: ["organization"],
        });
        const locale = userOrg?.organization?.defaultLanguage || DEFAULT_LANGUAGE;

        const emailVariables = {
          userName: user.getFullName(),
          userEmail: newEmail,
          oldEmail,
          newEmail,
          companyName: "Hay.chat",
          changedAt: new Date().toLocaleString(),
          ipAddress: "Unknown",
          location: "Unknown",
          supportUrl: `${getDashboardUrl()}/support`,
          currentYear: new Date().getFullYear().toString(),
          companyAddress: "Hay.chat",
          websiteUrl: getDashboardUrl(),
          preferencesUrl: `${getDashboardUrl()}/settings`,
          recipientEmail: newEmail,
        };

        // Notify both old and new email
        await emailService.sendTemplateEmail({
          to: oldEmail,
          locale,
          template: "email-changed",
          variables: { ...emailVariables, recipientEmail: oldEmail },
        });

        await emailService.sendTemplateEmail({
          to: newEmail,
          locale,
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
      pendingEmail: () => "NULL",
      emailVerificationTokenHash: () => "NULL",
      emailVerificationExpiresAt: () => "NULL",
    });

    return {
      success: true,
      message: "Email change cancelled successfully",
    };
  }),

  // ─── Signup Email Verification ──────────────────────────────

  /**
   * Verify a user's email using a signup verification token.
   * Public endpoint — no auth required.
   */
  verifyEmail: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const tokenHash = crypto.createHash("sha256").update(input.token).digest("hex");

      const userRepository = AppDataSource.getRepository(User);
      // Email-change tokens (pendingEmail set) are only accepted by verifyEmailChange.
      const user = await userRepository.findOne({
        where: { emailVerificationTokenHash: tokenHash, pendingEmail: IsNull() },
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
    .mutation(async ({ input, ctx }) => {
      const { email } = input;

      const ipLimit = await rateLimitService.checkIpRateLimit(
        ctx.ipAddress || "unknown",
        20,
        60 * 60,
        { scope: "resend-verification", failClosed: true },
      );
      // Rate limit: 3 requests per hour per email
      const rateLimitResult = ipLimit.limited
        ? ipLimit
        : await rateLimitService.checkEmailRateLimit(email, 3, 60 * 60, {
            scope: "resend-verification",
            failClosed: true,
          });
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

      try {
        const token = await issueSignupVerificationToken(user);
        await sendSignupVerificationEmail(user, token);
      } catch (error) {
        logger.error({ err: error }, "Failed to send signup verification email");
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

      const baseUrl = process.env.FRONTEND_URL || getDashboardUrl();
      const verificationUrl = `${baseUrl}/verify-email?token=${verificationToken}`;

      const commonVariables = {
        userName: user.getFullName(),
        oldEmail: user.email,
        newEmail: user.pendingEmail,
        companyName: "Hay.chat",
        requestTime: new Date().toLocaleString(),
        ipAddress: ctx.ipAddress || "Unknown",
        browser: ctx.userAgent || "Unknown",
        location: "Unknown",
        supportUrl: `${baseUrl}/support`,
        cancelUrl: `${baseUrl}/settings/profile`,
        currentYear: new Date().getFullYear().toString(),
        companyAddress: "Hay.chat",
        websiteUrl: "https://hay.chat",
        preferencesUrl: `${baseUrl}/settings`,
      };

      // Send verification email to new email address
      const locale = await getOrganizationLocale(ctx.organizationId);
      await emailService.sendTemplateEmail({
        to: user.pendingEmail,
        locale,
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

  // Single-use auth code for an allowlisted external destination (billing
  // portal, suspension redirect, custom menu links on an allowlisted origin):
  // the destination exchanges it with exchangeAuthCode for its own session.
  generateAuthCode: protectedProcedureWithoutOrg
    .input(z.object({ redirectUri: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      return createAuthCode(ctx.user!.id, allowlistedRedirectUrl(input.redirectUri).origin);
    }),

  // Issue a single-use auth code bound to an allowlisted external redirect URI.
  // Powers the "Connect to Hay" handshake for external apps (e.g. the Shopify
  // embedded app): the app sends the merchant to the dashboard /connect/authorize
  // page, which (once the merchant is logged in) calls this and redirects back to
  // `redirectUri?code=...&state=...`. The external app then calls exchangeAuthCode.
  generateConnectAuthCode: protectedProcedureWithoutOrg
    .input(
      z.object({
        redirectUri: z.string().url(),
        state: z.string().max(512).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const redirectUrl = allowlistedRedirectUrl(input.redirectUri);
      const { code } = await createAuthCode(ctx.user!.id, redirectUrl.origin);

      redirectUrl.searchParams.set("code", code);
      if (input.state) redirectUrl.searchParams.set("state", input.state);

      return { redirectUrl: redirectUrl.toString() };
    }),

  exchangeAuthCode: publicProcedure
    .input(
      z.object({
        code: z.string().min(1),
        redirectUri: z.string().url().optional(),
        useCookie: useCookieField,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertWithinIpLimit(ctx.ipAddress, EXCHANGE_IP_LIMIT);

      if (!input.redirectUri && config.authCodes.requireRedirectUri) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "redirectUri is required" });
      }
      const redirectOrigin = input.redirectUri ? new URL(input.redirectUri).origin : null;
      const codeHash = await hashApiKey(input.code);

      // Claim the code in one statement so concurrent exchanges can't both succeed.
      const claimed = await AppDataSource.createQueryBuilder()
        .update(AuthCode)
        .set({ used: true })
        .where(
          `code_hash = :codeHash AND used = false AND expires_at > now()${
            redirectOrigin
              ? " AND (redirect_origin IS NULL OR redirect_origin = :redirectOrigin)"
              : ""
          }`,
          { codeHash, redirectOrigin },
        )
        .returning("user_id")
        .execute();
      const userId = (claimed.raw as Array<{ user_id: string }>)[0]?.user_id;
      const user = userId
        ? await AppDataSource.getRepository(User).findOne({ where: { id: userId } })
        : null;

      if (!user) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid or expired auth code",
        });
      }

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

      const tokens = await authSessionService.createSession(user, ctx);

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
        ...deliverTokens(ctx, tokens, input.useCookie),
      };
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
