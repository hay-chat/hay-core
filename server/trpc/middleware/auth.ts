import { TRPCError } from "@trpc/server";
import { t } from "@server/trpc";
import { AuthUser } from "@server/lib/auth/AuthUser";
import type { Context } from "../context";

/**
 * Middleware to ensure user is authenticated
 */
const isAuthed = t.middleware<{ ctx: Context }>(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
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
 * Middleware to ensure user is an admin
 */
const isAdmin = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }

  if (!ctx.user.isAdmin()) {
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
