import { redisService } from "./redis.service";
import { debugLog } from "@server/lib/debug-logger";

/**
 * Rate Limiting Service
 * Provides IP and email-based rate limiting using Redis
 */
export class RateLimitService {
  /**
   * Check if an IP address has exceeded the rate limit
   * @param ipAddress - Client IP address
   * @param maxRequests - Maximum requests allowed
   * @param windowSeconds - Time window in seconds
   * @returns true if rate limit exceeded, false otherwise
   */
  async checkIpRateLimit(
    ipAddress: string,
    maxRequests: number,
    windowSeconds: number,
  ): Promise<{ limited: boolean; remaining: number; resetAt: Date }> {
    const key = `rate_limit:ip:${ipAddress}`;
    return this.checkRateLimit(key, maxRequests, windowSeconds);
  }

  /**
   * Check if an email has exceeded the rate limit
   * @param email - Email address
   * @param maxRequests - Maximum requests allowed
   * @param windowSeconds - Time window in seconds
   * @returns true if rate limit exceeded, false otherwise
   */
  async checkEmailRateLimit(
    email: string,
    maxRequests: number,
    windowSeconds: number,
  ): Promise<{ limited: boolean; remaining: number; resetAt: Date }> {
    const key = `rate_limit:email:${email.toLowerCase()}`;
    return this.checkRateLimit(key, maxRequests, windowSeconds);
  }

  /**
   * Check if a combined IP+Email identifier has exceeded the rate limit
   * @param ipAddress - Client IP address
   * @param email - Email address
   * @param maxRequests - Maximum requests allowed
   * @param windowSeconds - Time window in seconds
   */
  async checkCombinedRateLimit(
    ipAddress: string,
    email: string,
    maxRequests: number,
    windowSeconds: number,
  ): Promise<{ limited: boolean; remaining: number; resetAt: Date }> {
    const key = `rate_limit:combined:${ipAddress}:${email.toLowerCase()}`;
    return this.checkRateLimit(key, maxRequests, windowSeconds);
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
  ): Promise<{ limited: boolean; remaining: number; resetAt: Date }> {
    const key = `rate_limit:org:${organizationId}:${operation}`;
    return this.checkRateLimit(key, maxRequests, windowSeconds);
  }

  /**
   * Generic rate limit check using Redis
   * Uses sliding window counter algorithm
   */
  private async checkRateLimit(
    key: string,
    maxRequests: number,
    windowSeconds: number,
  ): Promise<{ limited: boolean; remaining: number; resetAt: Date }> {
    // Ensure Redis is connected
    if (!redisService.isConnected()) {
      await redisService.initialize();
    }

    const client = redisService.getClient();
    if (!client) {
      // If Redis is unavailable, allow the request (fail open)
      debugLog("rate-limit", "Redis unavailable, allowing request");
      return {
        limited: false,
        remaining: maxRequests,
        resetAt: new Date(Date.now() + windowSeconds * 1000),
      };
    }

    try {
      // Get current count
      const currentCount = await client.get(key);
      const count = currentCount ? parseInt(currentCount, 10) : 0;

      // Check if limit exceeded
      if (count >= maxRequests) {
        const ttl = await client.ttl(key);
        const resetAt = new Date(Date.now() + ttl * 1000);

        debugLog("rate-limit", `Rate limit exceeded for key: ${key}`, {
          count,
          maxRequests,
          resetAt,
        });

        return {
          limited: true,
          remaining: 0,
          resetAt,
        };
      }

      // Increment counter
      const newCount = await client.incr(key);

      // Set expiry on first request
      if (newCount === 1) {
        await client.expire(key, windowSeconds);
      }

      const remaining = Math.max(0, maxRequests - newCount);
      const resetAt = new Date(Date.now() + windowSeconds * 1000);

      debugLog("rate-limit", `Rate limit check passed for key: ${key}`, {
        newCount,
        remaining,
        maxRequests,
      });

      return {
        limited: false,
        remaining,
        resetAt,
      };
    } catch (error) {
      console.error("[RateLimit] Error checking rate limit:", error);
      // Fail open if Redis errors
      return {
        limited: false,
        remaining: maxRequests,
        resetAt: new Date(Date.now() + windowSeconds * 1000),
      };
    }
  }

  /**
   * Reset rate limit for a specific key (admin/testing purposes)
   */
  async resetRateLimit(identifier: string, type: "ip" | "email" | "combined"): Promise<void> {
    const client = redisService.getClient();
    if (!client) {
      return;
    }

    const key = `rate_limit:${type}:${identifier}`;
    await client.del(key);
    debugLog("rate-limit", `Rate limit reset for key: ${key}`);
  }

  /**
   * Get current rate limit status without incrementing
   */
  async getRateLimitStatus(
    identifier: string,
    type: "ip" | "email" | "combined",
    maxRequests: number,
  ): Promise<{ count: number; remaining: number; resetAt: Date | null }> {
    const client = redisService.getClient();
    if (!client) {
      return {
        count: 0,
        remaining: maxRequests,
        resetAt: null,
      };
    }

    const key = `rate_limit:${type}:${identifier}`;
    const currentCount = await client.get(key);
    const count = currentCount ? parseInt(currentCount, 10) : 0;
    const remaining = Math.max(0, maxRequests - count);

    let resetAt: Date | null = null;
    if (count > 0) {
      const ttl = await client.ttl(key);
      if (ttl > 0) {
        resetAt = new Date(Date.now() + ttl * 1000);
      }
    }

    return { count, remaining, resetAt };
  }
}

// Export singleton instance
export const rateLimitService = new RateLimitService();
