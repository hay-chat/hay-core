import crypto from "crypto";
import { TRPCError } from "@trpc/server";
import { t } from "@server/trpc/init";
import type { Context } from "@server/trpc/context";
import { config } from "@server/config/env";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("trpc-internal");

/**
 * Header carrying the shared secret for server-to-server `internal.*` calls.
 * Deliberately not `Authorization`: createContext() would try to parse that as
 * a JWT and log an auth error on every call.
 */
export const INTERNAL_SECRET_HEADER = "x-hay-internal-secret";

/**
 * Constant-time comparison of the provided secret against the configured one.
 * Both sides are hashed first so timingSafeEqual never throws on a length
 * mismatch (which would itself leak the secret length).
 */
export function isValidInternalSecret(
  provided: unknown,
  expected: string = config.internal.apiSecret,
): boolean {
  if (!expected || typeof provided !== "string" || provided.length === 0) {
    return false;
  }
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Middleware for procedures only an external operator may call.
 * Disabled (FORBIDDEN) when INTERNAL_API_SECRET is not configured.
 */
export const isInternal = t.middleware<{ ctx: Context }>(({ ctx, next }) => {
  if (!config.internal.apiSecret) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Internal API is disabled (INTERNAL_API_SECRET not set)",
    });
  }

  if (!isValidInternalSecret(ctx.req.headers[INTERNAL_SECRET_HEADER])) {
    logger.warn({ ip: ctx.ipAddress }, "Rejected internal API call: invalid secret");
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid internal secret",
    });
  }

  return next();
});

export const internalProcedure = t.procedure.use(isInternal);
