import crypto from "crypto";
import { TRPCError } from "@trpc/server";
import { redisService } from "./redis.service";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("rate-limit");

/**
 * Redis key for a per-identifier counter. Identifiers (IPs, emails) are
 * hashed so personal data never appears in key names.
 */
export function rateLimitKey(type: string, identifier: string): string {
  const digest = crypto.createHash("sha256").update(identifier.toLowerCase()).digest("hex");
  return `rate_limit:${type}:${digest}`;
}

/**
 * Each flow that counts per IP or per email has its own bucket, so one flow's
 * traffic can never use up another flow's allowance for the same address.
 */
export type RateLimitScope =
  | "login"
  | "password-reset"
  | "resend-verification"
  | "privacy-request"
  | "privacy-download"
  | "customer-privacy"
  | "refresh-token"
  | "exchange-auth-code"
  | "mfa-verify"
  | "internal-api";

export interface RateLimitOptions {
  scope: RateLimitScope;
  /** Reject with SERVICE_UNAVAILABLE when Redis cannot be reached. */
  failClosed?: boolean;
}

export interface RateLimitResult {
  limited: boolean;
  remaining: number;
  resetAt: Date;
}

/** Raised for fail-closed limits while Redis is unavailable. */
export class RateLimitUnavailableError extends TRPCError {
  constructor() {
    super({
      code: "SERVICE_UNAVAILABLE",
      message: "Rate limiting service unavailable. Please try again later.",
    });
    this.name = "RateLimitUnavailableError";
  }
}

/**
 * Increment and read in one step, so concurrent requests cannot all pass on
 * the same count and a key can never be left without an expiry. A refused
 * request does not increment.
 * Returns [limited (0|1), count, ttl seconds].
 */
const CHECK_AND_INCREMENT_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local limited = 0
local count = current
if current >= tonumber(ARGV[1]) then
  limited = 1
else
  count = redis.call('INCR', KEYS[1])
end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
  ttl = tonumber(ARGV[2])
end
return {limited, count, ttl}
`;

/** Upper bound on the in-process fallback's memory while Redis is down. */
const MAX_FALLBACK_KEYS = 50_000;
const UNAVAILABLE_LOG_INTERVAL_MS = 60_000;

/**
 * Rate Limiting Service
 * Provides IP and email-based rate limiting using Redis. While Redis is down,
 * fail-closed limits refuse and the others count per process instead.
 */
export class RateLimitService {
  private fallbackCounters = new Map<string, { count: number; expiresAt: number }>();
  private redisStarted = false;
  private lastUnavailableLogAt = 0;
  private fallbackChecksSinceLog = 0;

  /**
   * Check if an IP address has exceeded the rate limit
   * @param ipAddress - Client IP address
   * @param maxRequests - Maximum requests allowed
   * @param windowSeconds - Time window in seconds
   */
  async checkIpRateLimit(
    ipAddress: string,
    maxRequests: number,
    windowSeconds: number,
    options: RateLimitOptions,
  ): Promise<RateLimitResult> {
    const key = rateLimitKey(`ip:${options.scope}`, ipAddress);
    return this.checkRateLimit(key, maxRequests, windowSeconds, options.failClosed);
  }

  /**
   * Check if an email has exceeded the rate limit
   * @param email - Email address
   * @param maxRequests - Maximum requests allowed
   * @param windowSeconds - Time window in seconds
   */
  async checkEmailRateLimit(
    email: string,
    maxRequests: number,
    windowSeconds: number,
    options: RateLimitOptions,
  ): Promise<RateLimitResult> {
    const key = rateLimitKey(`email:${options.scope}`, email);
    return this.checkRateLimit(key, maxRequests, windowSeconds, options.failClosed);
  }

  /**
   * Check if a combined IP+Email identifier has exceeded the rate limit
   * @param ipAddress - Client IP address
   * @param email - Email address
   * @param maxRequests - Maximum requests allowed
   * @param windowSeconds - Time window in seconds
   * @param failClosed - If true, reject requests when Redis is unavailable (for critical endpoints)
   */
  async checkCombinedRateLimit(
    ipAddress: string,
    email: string,
    maxRequests: number,
    windowSeconds: number,
    failClosed: boolean = false,
  ): Promise<RateLimitResult> {
    const key = rateLimitKey("combined", `${ipAddress}:${email}`);
    return this.checkRateLimit(key, maxRequests, windowSeconds, failClosed);
  }

  /**
   * Check if an organization has exceeded the rate limit for a specific operation
   * @param organizationId - Organization ID
   * @param operation - Operation identifier (e.g., "customer-privacy", "api-tokens")
   * @param maxRequests - Maximum requests allowed
   * @param windowSeconds - Time window in seconds
   */
  async checkOrganizationRateLimit(
    organizationId: string,
    operation: string,
    maxRequests: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    const key = `rate_limit:org:${organizationId}:${operation}`;
    return this.checkRateLimit(key, maxRequests, windowSeconds);
  }

  /**
   * Check a rate limit under a caller-chosen key, for limits that are not
   * plain per-IP or per-email (e.g. `public-widget:create:ip:<ip>`). Keys are
   * namespaced so they never share a counter with the other checks.
   */
  async checkKeyRateLimit(
    key: string,
    maxRequests: number,
    windowSeconds: number,
    failClosed: boolean = false,
  ): Promise<RateLimitResult> {
    return this.checkRateLimit(rateLimitKey("key", key), maxRequests, windowSeconds, failClosed);
  }

  /** The Redis client, or null when commands could not be served right now. */
  private async availableClient() {
    if (!this.redisStarted) {
      this.redisStarted = true;
      await redisService.initialize();
      await redisService.waitUntilReady(2000);
    }
    // ioredis queues commands while reconnecting, so using the client in that
    // state would hang the request until Redis comes back.
    return redisService.isConnected() ? redisService.getClient() : null;
  }

  private async checkRateLimit(
    key: string,
    maxRequests: number,
    windowSeconds: number,
    failClosed: boolean = false,
  ): Promise<RateLimitResult> {
    let client: Awaited<ReturnType<RateLimitService["availableClient"]>> = null;
    try {
      client = await this.availableClient();
    } catch (error) {
      logger.error({ err: error }, "Could not start Redis for rate limiting");
    }

    if (client) {
      try {
        const [limited, count, ttl] = (await client.eval(
          CHECK_AND_INCREMENT_SCRIPT,
          1,
          key,
          maxRequests,
          windowSeconds,
        )) as [number, number, number];

        return {
          limited: limited === 1,
          remaining: Math.max(0, maxRequests - count),
          resetAt: new Date(Date.now() + ttl * 1000),
        };
      } catch (error) {
        logger.error({ err: error }, "Error checking rate limit");
      }
    }

    if (failClosed) {
      logger.error("Redis unavailable, rejecting rate-limited request");
      throw new RateLimitUnavailableError();
    }
    return this.checkFallback(key, maxRequests, windowSeconds);
  }

  /** Fixed-window count held in this process, used while Redis is down. */
  private checkFallback(key: string, maxRequests: number, windowSeconds: number): RateLimitResult {
    this.fallbackChecksSinceLog++;
    const now = Date.now();
    if (now - this.lastUnavailableLogAt >= UNAVAILABLE_LOG_INTERVAL_MS) {
      logger.error(
        { checks: this.fallbackChecksSinceLog },
        "Redis unavailable, rate limits are counted per process",
      );
      this.lastUnavailableLogAt = now;
      this.fallbackChecksSinceLog = 0;
    }

    let entry = this.fallbackCounters.get(key);
    if (!entry || entry.expiresAt <= now) {
      this.pruneFallback(now);
      entry = { count: 0, expiresAt: now + windowSeconds * 1000 };
      this.fallbackCounters.set(key, entry);
    }

    const resetAt = new Date(entry.expiresAt);
    if (entry.count >= maxRequests) {
      return { limited: true, remaining: 0, resetAt };
    }
    entry.count++;
    return { limited: false, remaining: maxRequests - entry.count, resetAt };
  }

  private pruneFallback(now: number): void {
    if (this.fallbackCounters.size < MAX_FALLBACK_KEYS) return;
    for (const [key, entry] of this.fallbackCounters) {
      if (entry.expiresAt <= now) this.fallbackCounters.delete(key);
    }
    // Still full of live windows: drop the oldest entries.
    for (const key of this.fallbackCounters.keys()) {
      if (this.fallbackCounters.size < MAX_FALLBACK_KEYS) break;
      this.fallbackCounters.delete(key);
    }
  }

  /**
   * Clear a counter. Best effort: a failure here must not fail the caller.
   */
  async resetRateLimit(
    identifier: string,
    type: "ip" | "email" | "combined",
    scope?: RateLimitScope,
  ): Promise<void> {
    const key = rateLimitKey(scope ? `${type}:${scope}` : type, identifier);
    this.fallbackCounters.delete(key);

    try {
      const client = await this.availableClient();
      await client?.del(key);
      logger.debug({ key }, "Rate limit reset");
    } catch (error) {
      logger.warn({ err: error }, "Could not reset rate limit");
    }
  }
}

// Export singleton instance
export const rateLimitService = new RateLimitService();
