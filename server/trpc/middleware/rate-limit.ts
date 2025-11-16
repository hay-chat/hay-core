import { t } from "../init";
import { TRPCError } from "@trpc/server";
import { redisService } from "@server/services/redis.service";

/**
 * Rate limit options
 */
export interface RateLimitOptions {
  /**
   * Maximum number of requests allowed in the window
   */
  max: number;

  /**
   * Time window in milliseconds
   */
  windowMs: number;

  /**
   * Key prefix for Redis storage
   */
  keyPrefix?: string;

  /**
   * Whether to use user ID (true) or IP address (false) as identifier
   * Defaults to true for authenticated endpoints, false for public endpoints
   */
  useUserId?: boolean;
}

/**
 * Get rate limit key for a request
 */
function getRateLimitKey(identifier: string, keyPrefix: string, endpoint: string): string {
  return `ratelimit:${keyPrefix}:${endpoint}:${identifier}`;
}

/**
 * Rate limiting middleware using Redis
 * Implements a sliding window rate limiter
 */
export const rateLimitMiddleware = (options: RateLimitOptions) => {
  return t.middleware(async ({ ctx, path, next }) => {
    const { max, windowMs, keyPrefix = "default", useUserId = true } = options;

    // Determine identifier (user ID or IP address)
    let identifier: string;
    if (useUserId && ctx.user) {
      identifier = ctx.user.id;
    } else if (ctx.ipAddress) {
      identifier = ctx.ipAddress;
    } else {
      // Fallback to a generic identifier (not recommended for production)
      identifier = "anonymous";
    }

    const endpoint = path;
    const key = getRateLimitKey(identifier, keyPrefix, endpoint);
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      // Get Redis client
      const redis = redisService.getClient();

      // Skip rate limiting if Redis is not available
      if (!redis) {
        console.warn("[RateLimit] Redis client not available, skipping rate limit");
        return next({
          ctx: {
            ...ctx,
            rateLimit: {
              limit: max,
              remaining: max,
              reset: new Date(now + windowMs),
            },
          },
        });
      }

      // Use Redis sorted set for sliding window
      // Score is the timestamp, value is a unique request ID
      const requestId = `${now}-${Math.random().toString(36).substring(7)}`;

      // Remove old entries outside the window
      await redis.zremrangebyscore(key, 0, windowStart);

      // Count requests in the current window
      const requestCount = await redis.zcard(key);

      // Check if limit is exceeded
      if (requestCount >= max) {
        // Get the oldest request in the window to calculate retry-after
        const oldestRequests = await redis.zrange(key, 0, 0, "WITHSCORES");
        const oldestTimestamp = oldestRequests[1] ? parseInt(oldestRequests[1]) : now;
        const retryAfter = Math.ceil((oldestTimestamp + windowMs - now) / 1000);

        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
          cause: {
            retryAfter,
            limit: max,
            windowMs,
            remaining: 0,
          },
        });
      }

      // Add current request to the window
      await redis.zadd(key, now, requestId);

      // Set expiry on the key (cleanup)
      await redis.expire(key, Math.ceil(windowMs / 1000));

      // Calculate remaining requests
      const remaining = max - requestCount - 1;

      // Calculate reset time (end of the current window)
      const reset = now + windowMs;

      // Add rate limit headers to the context for response
      return next({
        ctx: {
          ...ctx,
          rateLimit: {
            limit: max,
            remaining: Math.max(0, remaining),
            reset: new Date(reset),
            retryAfter: remaining < 0 ? Math.ceil(windowMs / 1000) : undefined,
          },
        },
      });
    } catch (error) {
      // If it's already a TRPCError (rate limit exceeded), rethrow it
      if (error instanceof TRPCError) {
        throw error;
      }

      // If Redis is unavailable, log the error and allow the request
      // This prevents rate limiting from blocking all requests if Redis is down
      console.error("[RateLimit] Redis error, allowing request:", error);
      return next({
        ctx: {
          ...ctx,
          rateLimit: {
            limit: max,
            remaining: max,
            reset: new Date(now + windowMs),
          },
        },
      });
    }
  });
};

/**
 * Create a rate-limited procedure
 */
export const rateLimitedProcedure = (options: RateLimitOptions) => {
  return t.procedure.use(rateLimitMiddleware(options));
};

/**
 * Predefined rate limit configurations
 */
export const RateLimits = {
  /**
   * Strict rate limit for sensitive operations (10 requests per hour)
   */
  STRICT: {
    max: 10,
    windowMs: 60 * 60 * 1000, // 1 hour
    keyPrefix: "strict",
  },

  /**
   * Moderate rate limit for normal operations (100 requests per hour)
   */
  MODERATE: {
    max: 100,
    windowMs: 60 * 60 * 1000, // 1 hour
    keyPrefix: "moderate",
  },

  /**
   * Lenient rate limit for high-frequency operations (1000 requests per hour)
   */
  LENIENT: {
    max: 1000,
    windowMs: 60 * 60 * 1000, // 1 hour
    keyPrefix: "lenient",
  },

  /**
   * Per-minute rate limit for real-time operations (60 requests per minute)
   */
  PER_MINUTE: {
    max: 60,
    windowMs: 60 * 1000, // 1 minute
    keyPrefix: "per_minute",
  },

  /**
   * Invitation-specific rate limit (10 invitations per hour per user)
   */
  INVITATIONS: {
    max: 10,
    windowMs: 60 * 60 * 1000, // 1 hour
    keyPrefix: "invitations",
    useUserId: true,
  },

  /**
   * Invitation resend rate limit (3 resends per invitation per day)
   */
  INVITATION_RESEND: {
    max: 3,
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    keyPrefix: "invitation_resend",
    useUserId: false, // Use invitation ID as identifier
  },
} as const;
