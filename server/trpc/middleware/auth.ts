import { TRPCError } from "@trpc/server";
import { t } from "@server/trpc/init";
import { AuthUser } from "@server/lib/auth/AuthUser";
import type { Context } from "@server/trpc/context";
import type { Request } from "express";
import { auditLogService } from "@server/services/audit-log.service";

/**
 * Middleware to ensure user is authenticated
 */
interface RequestWithAuthError extends Request {
  authError?: string;
}

export const isAuthed = t.middleware<{ ctx: Context }>(({ ctx, next }) => {
  // Check if there was an authentication error stored in the request
  const reqWithAuth = ctx.req as RequestWithAuthError;
  if (reqWithAuth.authError) {
    const errorMessage = reqWithAuth.authError;

    // Provide specific error for token expiration
    if (errorMessage.includes("Token has expired") || errorMessage.includes("token expired")) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Token has expired",
        cause: {
          type: "TOKEN_EXPIRED",
        },
      });
    }
  }

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

  return next({
    ctx: {
      ...ctx,
      user: ctx.user as AuthUser,
    },
  });
});

/**
 * Middleware to ensure user has admin access (full permissions)
 * Checks for *:* scope (full access to all resources)
 */
const isAdmin = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }

  // Check if user has full access (*:* scope)
  if (!ctx.user.hasScope("*", "*")) {
    // Log permission denial
    try {
      await auditLogService.logPermissionDenied(
        ctx.user.id,
        ctx.organizationId || "",
        "*",
        "*",
        {
          userRole: ctx.user.getRole(),
          requestedResource: "*",
          requestedAction: "*",
        }
      );
    } catch (error) {
      console.error("Failed to log permission denial:", error);
    }

    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
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
          }
        );
      } catch (error) {
        console.error("Failed to log permission denial:", error);
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
  // Check if there was an authentication error stored in the request
  const reqWithAuth = ctx.req as RequestWithAuthError;
  if (reqWithAuth.authError) {
    const errorMessage = reqWithAuth.authError;

    // Provide specific error for token expiration
    if (errorMessage.includes("Token has expired") || errorMessage.includes("token expired")) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Token has expired",
        cause: {
          type: "TOKEN_EXPIRED",
        },
      });
    }
  }

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
 * Admin procedure - requires admin role
 */
export const adminProcedure = t.procedure.use(isAdmin);

/**
 * Create a scoped procedure with specific permissions
 * Also ensures user is authenticated first
 */
export const scopedProcedure = (resource: string, action: string) => {
  return t.procedure.use(isAuthed).use(hasScope(resource, action));
};

/**
 * Public procedure - no authentication required
 */
export const publicProcedure = t.procedure;

/**
 * Legacy authRequired middleware for backward compatibility
 */
export const authRequired = isAuthed;
