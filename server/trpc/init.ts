import { initTRPC } from "@trpc/server";
import { currentRequestId } from "@server/lib/logger";
import { withSpan } from "@server/lib/tracing";
import { createContext } from "./context";

/**
 * Initialization of tRPC backend
 * Should be done only once per backend!
 */
const base = initTRPC.context<typeof createContext>().create({
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
        requestId: currentRequestId(),
      },
    };
  },
});

/**
 * Every procedure built from `t.procedure` runs inside a span named for its
 * path. Input and output are never attached.
 */
export const t = {
  ...base,
  procedure: base.procedure.use(async ({ path, type, next }) =>
    withSpan("trpc", { "rpc.procedure": path, "rpc.type": type }, async (span) => {
      const result = await next();
      if (!result.ok) span.setAttributes({ "rpc.code": result.error.code });
      return result;
    }),
  ),
};

/**
 * Export reusable router and procedure helpers
 * that can be used throughout the router
 */
export const router = t.router;
export const publicProcedure = t.procedure;
