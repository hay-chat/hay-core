import { initTRPC } from "@trpc/server";
import { createContext } from "./context";

/**
 * Initialization of tRPC backend
 * Should be done only once per backend!
 */
export const t = initTRPC.context<typeof createContext>().create({
  // `cause` is never serialized to the client, so lift the structured fields our
  // middlewares attach (e.g. TOKEN_EXPIRED, ORGANIZATION_SUSPENDED) into `data`.
  errorFormatter({ shape, error }) {
    const cause = error.cause as { type?: string; reason?: string | null } | undefined;
    return {
      ...shape,
      data: {
        ...shape.data,
        type: cause?.type,
        reason: cause?.reason,
      },
    };
  },
});

/**
 * Export reusable router and procedure helpers
 * that can be used throughout the router
 */
export const router = t.router;
export const publicProcedure = t.procedure;
