import { TRPCError } from "@trpc/server";
import { AppDataSource } from "@server/database/data-source";
import { User } from "@server/entities/user.entity";
import { UserOrganization } from "@server/entities/user-organization.entity";
import { setRefreshCookies } from "@server/lib/auth/session-cookie";
import { verifyMfaChallengeToken } from "@server/lib/auth/utils/jwt";
import { auditLogService } from "@server/services/audit-log.service";
import { authSessionService } from "@server/services/auth-session.service";
import { mfaService } from "@server/services/mfa.service";
import { toAccessState } from "@server/services/organization-access.service";
import { StorageService } from "@server/services/storage.service";
import type { Context } from "@server/trpc/context";
import type { AuthTokens } from "@server/types/auth.types";

/**
 * Helper function to get all organizations for a user with their roles
 */
export async function getUserOrganizations(userId: string) {
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
      ? storageService.getUrl(userOrg.organization.logoUpload)
      : null,
    role: userOrg.role,
    permissions: userOrg.permissions,
    joinedAt: userOrg.joinedAt,
    lastAccessedAt: userOrg.lastAccessedAt,
    ...toAccessState(userOrg.organization),
  }));
}

/** Hand tokens to the client: the refresh token goes to the cookie in cookie mode. */
export function deliverTokens(
  ctx: Pick<Context, "res">,
  tokens: AuthTokens,
  useCookie: boolean | undefined,
): Omit<AuthTokens, "refreshToken"> & { refreshToken?: string } {
  if (!useCookie) return tokens;
  setRefreshCookies(ctx.res, tokens.refreshToken);
  const { refreshToken: _inCookie, ...rest } = tokens;
  return rest;
}

/** Managing sessions is for a signed-in person; API tokens have no session. */
export function requireSessionUser(ctx: Pick<Context, "user">) {
  if (ctx.user?.authMethod !== "jwt") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Sessions require a signed-in user" });
  }
  return ctx.user;
}

/** Re-authentication checks (password confirm, password/email change): 5 per 15 minutes. */
export const PASSWORD_CHECK_RATE_LIMIT = {
  max: 5,
  windowMs: 15 * 60 * 1000,
  keyPrefix: "password_check",
  useUserId: true,
  failClosed: true,
};

/** Everything after the user has proven who they are: the session and the login response. */
export async function completeLogin(
  user: User,
  ctx: Pick<Context, "res" | "ipAddress" | "userAgent">,
  useCookie: boolean | undefined,
) {
  user.lastLoginAt = new Date();
  user.updateLastSeen();
  await AppDataSource.getRepository(User).save(user);

  const tokens = await authSessionService.createSession(user, ctx);
  await auditLogService.record({
    userId: user.id,
    action: "user.login",
    resource: "auth",
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  // Load all user organizations (multi-org support)
  const organizations = await getUserOrganizations(user.id);

  // Prefer the most recently accessed organization; fall back to the legacy one.
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
    mfaRequired: false as const,
    mfaEnrolmentRequired: await mfaService.enrolmentRequired(user.id),
    user: {
      ...user.toJSON(),
      organizations,
      activeOrganizationId,
      onlineStatus: user.getOnlineStatus(),
    },
    ...deliverTokens(ctx, tokens, useCookie),
  };
}

/** The user a second-login-step challenge from `auth.login` belongs to, while it is still valid. */
export async function requireChallengeUser(challengeToken: string): Promise<User> {
  const challenge = verifyMfaChallengeToken(challengeToken);
  const user = challenge
    ? await AppDataSource.getRepository(User).findOne({
        where: { id: challenge.userId },
        relations: ["organization"],
      })
    : null;
  if (
    !challenge ||
    !user ||
    !user.isActive ||
    !user.emailVerified ||
    user.tokenVersion !== challenge.tokenVersion
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Your sign-in has expired. Please sign in again.",
      cause: { type: "MFA_CHALLENGE_EXPIRED" },
    });
  }
  return user;
}

export function requestInfo(ctx: Pick<Context, "ipAddress" | "userAgent">) {
  return { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent };
}
