import { redisService } from "./redis.service";
import type { OAuthState } from "../types/oauth.types";
import crypto from "crypto";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("oauth-state");

const STATE_TTL_SECONDS = 600; // 10 minutes
const STATE_KEY_PREFIX = "oauth:state:";

export class OAuthStateService {
  /**
   * Generate a random nonce for OAuth state
   */
  generateNonce(): string {
    return crypto.randomBytes(32).toString("base64url");
  }

  /**
   * Generate PKCE code verifier and challenge
   */
  generatePKCE(): { codeVerifier: string; codeChallenge: string } {
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    return { codeVerifier, codeChallenge };
  }

  /**
   * Store OAuth state in Redis
   */
  async storeState(state: OAuthState): Promise<string> {
    const nonce = state.nonce;
    const key = `${STATE_KEY_PREFIX}${nonce}`;
    const value = JSON.stringify(state);

    try {
      const client = redisService.getClient();
      if (!client) {
        throw new Error("Redis client not available");
      }

      await client.setex(key, STATE_TTL_SECONDS, value);
      logger.debug(`Stored OAuth state for nonce: ${nonce.substring(0, 8)}...`);
      return nonce;
    } catch (error) {
      logger.error({ err: error }, `Failed to store OAuth state`);
      throw error;
    }
  }

  /**
   * Retrieve and delete OAuth state from Redis
   * State is one-time use - deleted after retrieval
   */
  async retrieveState(nonce: string): Promise<OAuthState | null> {
    const key = `${STATE_KEY_PREFIX}${nonce}`;

    try {
      const client = redisService.getClient();
      if (!client) {
        throw new Error("Redis client not available");
      }

      const value = await client.get(key);
      if (!value) {
        return null;
      }

      // Delete immediately after retrieval (one-time use)
      await client.del(key);

      const state = JSON.parse(value) as OAuthState;
      logger.debug(`Retrieved OAuth state for nonce: ${nonce.substring(0, 8)}...`);
      return state;
    } catch (error) {
      logger.error({ err: error }, `Failed to retrieve OAuth state`);
      return null;
    }
  }

  /**
   * Check if state exists (without consuming it)
   */
  async stateExists(nonce: string): Promise<boolean> {
    const key = `${STATE_KEY_PREFIX}${nonce}`;

    try {
      const client = redisService.getClient();
      if (!client) {
        return false;
      }

      const exists = await client.exists(key);
      return exists === 1;
    } catch (error) {
      logger.error({ err: error }, `Failed to check OAuth state`);
      return false;
    }
  }
}

export const oauthStateService = new OAuthStateService();
