import { TRPCError } from "@trpc/server";
import { v1Router } from "../routes/v1";
import { isAuthed, scopedProcedure as scopedProcedureFactory } from "@server/trpc/middleware/auth";
import { withPagination } from "@server/trpc/middleware/pagination";
import {
  rateLimitMiddleware,
  rateLimitedProcedure,
  RateLimits,
} from "@server/trpc/middleware/rate-limit";
import { t, router, publicProcedure } from "./init";
import { createContext } from "./context";

// Re-export from init
export { t, router, publicProcedure, createContext };

// Re-export middleware
export { withPagination, rateLimitMiddleware, rateLimitedProcedure, RateLimits };

// Export the app router type for client-side type generation
export type AppRouter = typeof v1Router;

export const authenticatedProcedure = t.procedure.use(isAuthed);

/**
 * Base procedure for plugin routers. Core calls these in-process through
 * `createCaller`, passing the owning organization and no HTTP request; any other
 * caller is refused. Handlers must resolve records with `ctx.organizationId`.
 */
export const pluginRouterProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.req || !ctx.organizationId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "In-process callers only" });
  }
  return next({ ctx: { ...ctx, organizationId: ctx.organizationId } });
});

// Export scoped procedure factory
export const scopedProcedure = scopedProcedureFactory;
