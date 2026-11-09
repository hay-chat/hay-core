import crypto from "crypto";
import { TRPCError } from "@trpc/server";
import { t } from "@server/trpc/init";
import type { Context } from "@server/trpc/context";
import { config } from "@server/config/env";
import { createLogger } from "@server/lib/logger";
import { auditLogService } from "@server/services/audit-log.service";
import { rateLimitService } from "@server/services/rate-limit.service";

const logger = createLogger("trpc-internal");

/**
 * Header carrying the shared secret for server-to-server `internal.*` calls.
 * Deliberately not `Authorization`: createContext() would try to parse that as
 * a JWT and log an auth error on every call.
 */
export const INTERNAL_SECRET_HEADER = "x-hay-internal-secret";
export const INTERNAL_TIMESTAMP_HEADER = "x-hay-internal-timestamp";
export const INTERNAL_SIGNATURE_HEADER = "x-hay-internal-signature";

const SIGNATURE_MAX_SKEW_SECONDS = 300;
/** Long enough that a signature stays spent for as long as its timestamp is accepted. */
const SIGNATURE_SPENT_SECONDS = SIGNATURE_MAX_SKEW_SECONDS * 2;
const CALLS_PER_MINUTE_PER_IP = 600;

type InternalRequest = Context["req"] & { rawBody?: string; originalUrl?: string };

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

/** The path and query are signed too: tRPC queries carry their input there. */
export function signInternalRequest(
  secret: string,
  timestamp: string,
  url: string,
  rawBody: string,
): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${url}.${rawBody}`).digest("hex");
}

function activeSecrets(): string[] {
  return [config.internal.apiSecret, config.internal.previousApiSecret].filter(Boolean);
}

/** A signature must be recent, match an active secret and not have been used before. */
async function hasValidSignature(req: InternalRequest): Promise<boolean> {
  const timestamp = req.headers[INTERNAL_TIMESTAMP_HEADER];
  const signature = req.headers[INTERNAL_SIGNATURE_HEADER];
  if (typeof timestamp !== "string" || !/^\d+$/.test(timestamp)) return false;
  if (typeof signature !== "string") return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > SIGNATURE_MAX_SKEW_SECONDS) return false;

  const url = req.originalUrl ?? "";
  const rawBody = req.rawBody ?? "";
  const matches = activeSecrets().some((secret) =>
    isValidInternalSecret(signature, signInternalRequest(secret, timestamp, url, rawBody)),
  );
  if (!matches) return false;

  const { limited: alreadyUsed } = await rateLimitService.checkKeyRateLimit(
    `internal-signature:${signature}`,
    1,
    SIGNATURE_SPENT_SECONDS,
  );
  return !alreadyUsed;
}

async function isAuthenticated(req: InternalRequest): Promise<boolean> {
  if (req.headers[INTERNAL_SIGNATURE_HEADER] !== undefined) return hasValidSignature(req);
  if (config.internal.requireSignature) return false;
  const provided = req.headers[INTERNAL_SECRET_HEADER];
  return activeSecrets().some((secret) => isValidInternalSecret(provided, secret));
}

/**
 * Middleware for procedures only an external operator may call.
 * Disabled (FORBIDDEN) when INTERNAL_API_SECRET is not configured.
 */
export const isInternal = t.middleware<{ ctx: Context }>(async ({ ctx, next, path, type }) => {
  if (!config.internal.apiSecret) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Internal API is disabled (INTERNAL_API_SECRET not set)",
    });
  }

  const ip = ctx.ipAddress || "unknown";
  const { allowedIps } = config.internal;
  if (allowedIps.length > 0 && !allowedIps.includes(ip)) {
    logger.warn({ ip }, "Rejected internal API call: address not allowed");
    throw new TRPCError({ code: "FORBIDDEN", message: "Address not allowed" });
  }

  const { limited } = await rateLimitService.checkIpRateLimit(ip, CALLS_PER_MINUTE_PER_IP, 60, {
    scope: "internal-api",
  });
  if (limited) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many requests" });
  }

  if (!(await isAuthenticated(ctx.req as InternalRequest))) {
    logger.warn({ ip: ctx.ipAddress }, "Rejected internal API call: invalid credentials");
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid internal secret",
    });
  }

  const result = await next();
  await auditLogService.record({
    action: "internal.call",
    actorType: "system",
    resource: "internal_api",
    changes: { procedure: path, type, ok: result.ok },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    status: result.ok ? "success" : "failure",
  });
  return result;
});

export const internalProcedure = t.procedure.use(isInternal);
