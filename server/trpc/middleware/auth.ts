import { TRPCError } from "@trpc/server";
import { t } from "@server/trpc/init";
import { AuthUser } from "@server/lib/auth/AuthUser";
import type { Context } from "@server/trpc/context";
import type { Request } from "express";
import { auditLogService } from "@server/services/audit-log.service";
import { createLogger } from "@server/lib/logger";
import { assertOrganizationNotSuspended } from "./suspension";
import { isMfaEnrolmentExempt } from "./mfa";
import { mfaService } from "@server/services/mfa.service";

const logger = createLogger("trpc-auth");

/**
 * Middleware to ensure user is authenticated
 */
interface RequestWithAuthError extends Request {
  authError?: string;
  authDenied?: TRPCError;
  userWithoutOrganization?: AuthUser | null;
}

/** Report what `createContext` caught, so the caller gets the real reason. */
function throwStoredAuthFailure(ctx: Context): void {
  // @ts-ignore - Express type definition mismatch between root and server node_modules
  const { authError, authDenied } = ctx.req as RequestWithAuthError;

  if (authDenied) throw authDenied;

  if (authError?.includes("Token has expired") || authError?.includes("token expired")) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Token has expired",
      cause: {
        type: "TOKEN_EXPIRED",
      },
    });
  }
}

export const isAuthed = t.middleware<{ ctx: Context }>(async ({ ctx, path, next }) => {
  throwStoredAuthFailure(ctx);

  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }

  if (!ctx.organizationId) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Organization ID is required",
    });
  }

  // The organization is already loaded with the membership (no extra query).
  assertOrganizationNotSuspended(ctx.user.userOrganization?.organization, path);

  if (!isMfaEnrolmentExempt(path)) {
    await mfaService.assertEnrolledIfRequired(ctx.user);
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user as AuthUser,
    },
  });
});

/**
 * Middleware factory to check for specific scopes
 */
const hasScope = (resource: string, action: string) => {
  return t.middleware(async ({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }

    if (!ctx.user.hasScope(resource, action)) {
      // Log permission denial
      try {
        await auditLogService.logPermissionDenied(
          ctx.user.id,
          ctx.organizationId || "",
          resource,
          action,
          {
            userRole: ctx.user.getRole(),
            requestedResource: resource,
            requestedAction: action,
          },
        );
      } catch (error) {
        logger.error({ err: error }, "Failed to log permission denial");
      }

      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Insufficient permissions for ${action} on ${resource}`,
      });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user as AuthUser,
      },
    });
  });
};

/**
 * Middleware to ensure user is authenticated without requiring organization ID
 * Used for endpoints that need to work before organization context is established
 */
export const isAuthedWithoutOrg = t.middleware<{ ctx: Context }>(({ ctx, next }) => {
  // A stale organization header must not lock someone out of what needs no
  // organization: auth.me is how the dashboard learns which ones they still have.
  // @ts-ignore - Express type definition mismatch between root and server node_modules
  const { userWithoutOrganization } = ctx.req as RequestWithAuthError;
  if (userWithoutOrganization) {
    return next({ ctx: { ...ctx, user: userWithoutOrganization, organizationId: null } });
  }

  throwStoredAuthFailure(ctx);

  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }

  // Note: We don't check organizationId here, allowing this middleware
  // to be used for endpoints that need to fetch organization data

  return next({
    ctx: {
      ...ctx,
      user: ctx.user as AuthUser,
    },
  });
});

/**
 * Protected procedure - requires authentication
 */
export const protectedProcedure = t.procedure.use(isAuthed);

/**
 * Protected procedure without organization requirement
 * Used for endpoints that need to work before organization context is established
 */
export const protectedProcedureWithoutOrg = t.procedure.use(isAuthedWithoutOrg);

/**
 * Create a scoped procedure with specific permissions
 * Also ensures user is authenticated first
 */
export const scopedProcedure = (resource: string, action: string) => {
  return t.procedure.use(isAuthed).use(hasScope(resource, action));
};

/**
 * For server-to-server endpoints: an API key holding the scope, or a dashboard
 * user with the organization-wide wildcard (owner/admin).
 */
export const serverToServerProcedure = (resource: string, action: string) => {
  return scopedProcedure(resource, action).use(({ ctx, next }) => {
    if (ctx.user.authMethod !== "apikey" && !ctx.user.hasScope("*", "*")) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This action requires an API key or an administrator",
      });
    }
    return next();
  });
};

/**
 * Public procedure - no authentication required
 */
export const publicProcedure = t.procedure;

/**
 * Legacy authRequired middleware for backward compatibility
 */
export const authRequired = isAuthed;
