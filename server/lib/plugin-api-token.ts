/**
 * The one token a plugin worker uses to call core.
 *
 * Both plugin API surfaces (the tRPC router and the REST relay,
 * /v1/plugin-api/send-email and friends) verify it with
 * {@link verifyPluginApiToken}, so issuer, audience, scope and payload checks
 * are identical on both. Minting in one place keeps a token valid for both.
 */
import { randomUUID } from "crypto";
import * as jwt from "jsonwebtoken";
import { deriveServiceKey } from "@server/lib/auth/utils/service-keys";
import { createLogger } from "@server/lib/logger";
import { metrics } from "@server/lib/metrics";
import { redisService } from "@server/services/redis.service";
import { declaredPluginCapabilities } from "@server/lib/plugin-capabilities";
import type { Organization } from "@server/entities/organization.entity";

export const PLUGIN_API_TOKEN_ISSUER = "hay-plugin-api";
export const PLUGIN_API_TOKEN_AUDIENCE = "plugin";
export const PLUGIN_API_TOKEN_SCOPE = "plugin-api";

const logger = createLogger("plugin-api-token");

/** A token is valid for this long; it is revoked early when its worker stops. */
export const TOKEN_LIFETIME_SECONDS = 24 * 60 * 60;

const REVOKED_KEY_PREFIX = "plugin-api-token:revoked:";

/**
 * Revocations made by this process, by token id, with the token's expiry (epoch
 * seconds). They apply even if the shared deny-list could not be written.
 */
const revokedHere = new Map<string, number>();

/**
 * Revocations not yet written to the shared deny-list (Redis was down or slow),
 * by token id, with the token's expiry. Written once Redis answers again, and
 * dropped when the token expires, which bounds the set.
 */
const pendingWrites = new Map<string, number>();
let flushInFlight: Promise<void> | null = null;

/** Longest a deny-list read or write may take before Redis counts as unavailable. */
export const REDIS_TIMEOUT_MS = 250;

const UNAVAILABLE_LOG_INTERVAL_MS = 60_000;
let lastUnavailableLogAt = 0;
let unavailableSinceLog = 0;

function pruneRevokedHere(nowSeconds: number): void {
  for (const [tokenId, expiresAt] of revokedHere) {
    if (expiresAt <= nowSeconds) revokedHere.delete(tokenId);
  }
  for (const [tokenId, expiresAt] of pendingWrites) {
    if (expiresAt <= nowSeconds) pendingWrites.delete(tokenId);
  }
}

/** Reject if `work` takes longer than the Redis time bound. */
function withinBound<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Redis timed out")), REDIS_TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** The client when it can serve commands now; ioredis would queue them otherwise. */
function readyClient() {
  const client = redisService.getClient();
  return client && redisService.isConnected() ? client : null;
}

/** Count an unavailable deny-list; log at most once a minute. */
function noteDenyListUnavailable(error?: unknown): void {
  metrics.redisUnavailable.inc({ surface: "plugin_api_token", action: "allowed" });
  unavailableSinceLog++;
  const now = Date.now();
  if (now - lastUnavailableLogAt < UNAVAILABLE_LOG_INTERVAL_MS) return;
  logger.warn(
    { err: error, checks: unavailableSinceLog },
    "Redis unavailable, plugin API tokens are accepted on signature and expiry",
  );
  lastUnavailableLogAt = now;
  unavailableSinceLog = 0;
}

/**
 * Write the pending revocations. Callers share one run, and it iterates the live
 * map, so a revocation added while it is under way is written by it too.
 */
function flushPendingWrites(): Promise<void> {
  if (pendingWrites.size === 0) return Promise.resolve();
  flushInFlight ??= writePendingRevocations().finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

async function writePendingRevocations(): Promise<void> {
  try {
    for (const [tokenId, expiresAt] of pendingWrites) {
      const client = readyClient();
      if (!client) return;
      const ttl = expiresAt - Math.floor(Date.now() / 1000);
      if (ttl >= 1) {
        await withinBound(client.set(`${REVOKED_KEY_PREFIX}${tokenId}`, "1", "EX", ttl));
      }
      pendingWrites.delete(tokenId);
    }
  } catch (error) {
    logger.warn({ err: error }, "Could not write pending plugin token revocations to Redis");
  }
}

export interface PluginApiTokenClaims {
  organizationId: string;
  pluginId: string;
  capabilities: string[];
  /** Token id; the key of the revocation deny-list. */
  jti: string;
  iat?: number;
  exp?: number;
}

function signingKey(): Buffer {
  return deriveServiceKey("hay:plugin-api-token:v1");
}

/** Thrown when a token verifies cryptographically but its claims are not a plugin-api token. */
export class PluginApiTokenClaimsError extends Error {}

/**
 * Mint the token for one worker. It carries the capabilities core recognises
 * among `capabilities`, is valid only for this organization and plugin, and
 * stays valid until it expires or {@link revokePluginApiToken} is called for it.
 * Validity is the signature and expiry alone, so any core process accepts it.
 */
export function mintPluginApiToken(
  organizationId: string,
  pluginId: string,
  capabilities: string[],
): string {
  const tokenId = randomUUID();
  const token = jwt.sign(
    {
      organizationId,
      pluginId,
      scope: PLUGIN_API_TOKEN_SCOPE,
      capabilities: declaredPluginCapabilities(capabilities),
    },
    signingKey(),
    {
      algorithm: "HS256",
      expiresIn: TOKEN_LIFETIME_SECONDS,
      issuer: PLUGIN_API_TOKEN_ISSUER,
      audience: PLUGIN_API_TOKEN_AUDIENCE,
      jwtid: tokenId,
    },
  );
  return token;
}

/**
 * Stop honouring a token, for example because its worker stopped: its id goes on
 * a Redis deny-list that expires with the token. Idempotent, and never rejects:
 * if Redis cannot be written, this process still refuses the token and the
 * write is retried on the next successful Redis call.
 */
export async function revokePluginApiToken(token: string): Promise<void> {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded !== "object" || typeof decoded.jti !== "string") return;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt =
    typeof decoded.exp === "number" ? decoded.exp : nowSeconds + TOKEN_LIFETIME_SECONDS;
  pruneRevokedHere(nowSeconds);
  revokedHere.set(decoded.jti, expiresAt);

  pendingWrites.set(decoded.jti, expiresAt);
  await flushPendingWrites();
  if (pendingWrites.has(decoded.jti)) {
    logger.warn("Redis unavailable, plugin token revoked on this process; will be written later");
  }
}

/**
 * Whether the token was revoked. When the shared deny-list cannot be read in
 * time, only this process's own revocations apply and the token is accepted.
 */
async function isRevoked(tokenId: string): Promise<boolean> {
  if (revokedHere.has(tokenId)) return true;
  const client = readyClient();
  if (!client) {
    noteDenyListUnavailable();
    return false;
  }
  try {
    const revoked = (await withinBound(client.exists(`${REVOKED_KEY_PREFIX}${tokenId}`))) === 1;
    void flushPendingWrites();
    return revoked;
  } catch (error) {
    noteDenyListUnavailable(error);
    return false;
  }
}

/**
 * Verify a plugin-api token: signature, expiry, issuer, audience, scope, the
 * required payload fields and that it has not been revoked. Throws a `jwt`
 * error for an invalid, expired or revoked token and
 * {@link PluginApiTokenClaimsError} for a token with the wrong claims. If the
 * shared deny-list is unreachable the token is still accepted.
 */
export async function verifyPluginApiToken(token: string): Promise<PluginApiTokenClaims> {
  const options: jwt.VerifyOptions = {
    algorithms: ["HS256"],
    issuer: PLUGIN_API_TOKEN_ISSUER,
    audience: PLUGIN_API_TOKEN_AUDIENCE,
  };
  const decoded = jwt.verify(token, signingKey(), options);
  if (typeof decoded !== "object" || decoded === null) {
    throw new PluginApiTokenClaimsError("Invalid token payload");
  }
  const claims = decoded as jwt.JwtPayload;
  if (claims.scope !== PLUGIN_API_TOKEN_SCOPE) {
    throw new PluginApiTokenClaimsError("Invalid token scope");
  }
  if (
    typeof claims.organizationId !== "string" ||
    typeof claims.pluginId !== "string" ||
    !Array.isArray(claims.capabilities) ||
    !claims.capabilities.every((capability: unknown) => typeof capability === "string")
  ) {
    throw new PluginApiTokenClaimsError("Invalid token payload");
  }
  if (typeof claims.jti !== "string") {
    throw new PluginApiTokenClaimsError("Invalid token payload");
  }
  if (await isRevoked(claims.jti)) {
    throw new jwt.JsonWebTokenError("Token is no longer active");
  }
  return {
    jti: claims.jti,
    organizationId: claims.organizationId,
    pluginId: claims.pluginId,
    capabilities: claims.capabilities,
    iat: claims.iat,
    exp: claims.exp,
  };
}

/**
 * Whether a plugin worker may act for this organization: it exists, is active
 * and is not suspended.
 */
export function isOrganizationOpenToPlugins(
  organization: Pick<Organization, "isActive" | "suspendedAt"> | null | undefined,
): boolean {
  return !!organization && organization.isActive && !organization.suspendedAt;
}
