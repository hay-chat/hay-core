import { randomBytes } from "crypto";
import { redisService } from "./redis.service";
import { OAuthState } from "@server/types/oauth.types";
import { debugLog } from "@server/lib/debug-logger";

/**
 * OAuth State Service
 * Manages temporary OAuth state in Redis during authorization flows
 */
export class OAuthStateService {
  private readonly STATE_TTL_SECONDS = 600; // 10 minutes
  private readonly STATE_PREFIX = "oauth:state:";

  /**
   * Generate a random nonce for OAuth state parameter
   */
  private generateNonce(): string {
    return randomBytes(32).toString("hex");
  }

  /**
   * Generate a random code verifier for PKCE
   * Must be 43-128 characters long, using A-Z, a-z, 0-9, -, ., _, ~
   */
  generateCodeVerifier(): string {
    return randomBytes(32)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }

  /**
   * Generate code challenge from code verifier using S256 method
   */
  async generateCodeChallenge(codeVerifier: string): Promise<string> {
    const { createHash } = await import("crypto");
    const hash = createHash("sha256").update(codeVerifier).digest("base64");
    return hash.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }

  /**
   * Store OAuth state in Redis
   * Returns the nonce to use as state parameter
   */
  async storeState(
    pluginId: string,
    organizationId: string,
    userId: string,
    codeVerifier?: string,
  ): Promise<string> {
    const nonce = this.generateNonce();

    const state: OAuthState = {
      nonce,
      pluginId,
      organizationId,
      userId,
      codeVerifier,
      createdAt: Date.now(),
    };

    const redisClient = redisService.getClient();
    if (!redisClient) {
      throw new Error("Redis client not available");
    }

    const key = this.getStateKey(nonce);
    await redisClient.setex(key, this.STATE_TTL_SECONDS, JSON.stringify(state));

    debugLog("oauth", `Stored OAuth state for plugin ${pluginId}, org ${organizationId}`, {
      data: { nonce, hasPKCE: !!codeVerifier },
    });

    return nonce;
  }

  /**
   * Retrieve and delete OAuth state from Redis
   * This is a one-time operation - state can only be retrieved once
   */
  async retrieveState(nonce: string): Promise<OAuthState | null> {
    const redisClient = redisService.getClient();
    if (!redisClient) {
      throw new Error("Redis client not available");
    }

    const key = this.getStateKey(nonce);

    // Get and delete in one atomic operation
    const stateJson = await redisClient.get(key);
    if (!stateJson) {
      debugLog("oauth", `OAuth state not found or expired: ${nonce}`, { level: "warn" });
      return null;
    }

    // Delete immediately to ensure one-time use
    await redisClient.del(key);

    try {
      const state = JSON.parse(stateJson) as OAuthState;
      debugLog("oauth", `Retrieved OAuth state for plugin ${state.pluginId}`, {
        data: { nonce: state.nonce },
      });
      return state;
    } catch (error) {
      debugLog("oauth", `Failed to parse OAuth state: ${nonce}`, { level: "error", data: error });
      return null;
    }
  }

  /**
   * Delete OAuth state from Redis (for cleanup/cancellation)
   */
  async deleteState(nonce: string): Promise<void> {
    const redisClient = redisService.getClient();
    if (!redisClient) {
      return;
    }

    const key = this.getStateKey(nonce);
    await redisClient.del(key);
    debugLog("oauth", `Deleted OAuth state: ${nonce}`);
  }

  /**
   * Check if OAuth state exists in Redis
   */
  async stateExists(nonce: string): Promise<boolean> {
    const redisClient = redisService.getClient();
    if (!redisClient) {
      return false;
    }

    const key = this.getStateKey(nonce);
    const exists = await redisClient.exists(key);
    return exists === 1;
  }

  /**
   * Get Redis key for OAuth state
   */
  private getStateKey(nonce: string): string {
    return `${this.STATE_PREFIX}${nonce}`;
  }

  /**
   * Clean up expired states (for maintenance)
   * Redis automatically expires keys, but this can be used for manual cleanup
   */
  async cleanupExpiredStates(): Promise<number> {
    const redisClient = redisService.getClient();
    if (!redisClient) {
      return 0;
    }

    const pattern = `${this.STATE_PREFIX}*`;
    const keys = await redisClient.keys(pattern);

    let deletedCount = 0;
    for (const key of keys) {
      const ttl = await redisClient.ttl(key);
      if (ttl === -1 || ttl === -2) {
        // -1: no expiry, -2: doesn't exist
        await redisClient.del(key);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      debugLog("oauth", `Cleaned up ${deletedCount} expired OAuth states`);
    }

    return deletedCount;
  }
}

export const oauthStateService = new OAuthStateService();
