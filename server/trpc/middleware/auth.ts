import { TRPCError } from "@trpc/server";
import { t } from "@server/trpc/init";
import { AuthUser } from "@server/lib/auth/AuthUser";
import type { Context } from "@server/trpc/context";
import type { Request } from "express";

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
const isAdmin = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }

  // Check if user has full access (*:* scope)
  if (!ctx.user.hasScope("*", "*")) {
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
  return t.middleware(({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }

    if (!ctx.user.hasScope(resource, action)) {
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
 * Protected procedure - requires authentication
 */
export const protectedProcedure = t.procedure.use(isAuthed);

/**
 * Admin procedure - requires admin role
 */
export const adminProcedure = t.procedure.use(isAdmin);

/**
 * Create a scoped procedure with specific permissions
 */
export const scopedProcedure = (resource: string, action: string) => {
  return t.procedure.use(hasScope(resource, action));
};

/**
 * Public procedure - no authentication required
 */
export const publicProcedure = t.procedure;

/**
 * Legacy authRequired middleware for backward compatibility
 */
export const authRequired = isAuthed;
