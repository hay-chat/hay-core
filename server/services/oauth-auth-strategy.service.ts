import { pluginInstanceRepository } from "../repositories/plugin-instance.repository";
import { pluginRegistryRepository } from "../repositories/plugin-registry.repository";
import { decryptConfig, decryptValue } from "../lib/auth/utils/encryption";
import { oauthService } from "./oauth.service";
import type { OAuthTokenData, PluginConfigWithOAuth } from "../types/oauth.types";
import { debugLog } from "@server/lib/debug-logger";

/**
 * OAuth Authentication Strategy
 * Handles token refresh, expiry checks, and header generation for OAuth-authenticated plugins
 */
export class OAuthAuthStrategy {
  /**
   * Get authorization headers for OAuth-authenticated requests
   */
  async getHeaders(organizationId: string, pluginId: string): Promise<Record<string, string>> {
    console.log("\n--- Getting OAuth headers ---");
    console.log("Plugin ID:", pluginId);
    console.log("Organization ID:", organizationId);

    const tokens = await this.getValidTokens(organizationId, pluginId);
    if (!tokens) {
      console.log("❌ No valid tokens available");
      throw new Error("OAuth tokens not available");
    }

    console.log("✅ Valid tokens found:");
    console.log("  Token type:", tokens.token_type || "Bearer");
    console.log(
      "  Access token:",
      tokens.access_token ? tokens.access_token.substring(0, 20) + "..." : "NONE",
    );
    console.log("  Expires at:", tokens.expires_at);

    // Always use "Bearer" with capital B (RFC 6750 standard)
    // Some OAuth providers return lowercase "bearer" but MCP servers expect "Bearer"
    const headers = {
      Authorization: `Bearer ${tokens.access_token}`,
    };

    console.log(
      "Generated Authorization header:",
      `Bearer ${tokens.access_token.substring(0, 30)}...`,
    );
    console.log("--- OAuth headers ready ---\n");

    return headers;
  }

  /**
   * Get valid OAuth tokens, refreshing if necessary
   */
  async getValidTokens(organizationId: string, pluginId: string): Promise<OAuthTokenData | null> {
    const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (!plugin) {
      return null;
    }

    const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
    if (!instance || !instance.config?._oauth) {
      return null;
    }

    try {
      const decryptedConfig = decryptConfig(instance.config) as PluginConfigWithOAuth;

      if (!decryptedConfig._oauth?.tokens) {
        return null;
      }

      const oauthData = decryptedConfig._oauth;

      // Decrypt tokens (access_token and refresh_token are encrypted)
      const encryptedTokens = oauthData.tokens as OAuthTokenData;
      const tokens: OAuthTokenData = {
        ...encryptedTokens,
        access_token: decryptValue(encryptedTokens.access_token),
        refresh_token: encryptedTokens.refresh_token
          ? decryptValue(encryptedTokens.refresh_token)
          : undefined,
      };

      // Check if token is expired or expiring soon (5 minute buffer)
      const expiresAt = tokens.expires_at;
      if (expiresAt) {
        const now = Math.floor(Date.now() / 1000);
        const bufferSeconds = 5 * 60; // 5 minutes

        if (expiresAt - now < bufferSeconds) {
          // Token is expired or expiring soon, try to refresh
          debugLog("oauth-auth", `Token expiring soon, refreshing for plugin ${pluginId}`, {
            organizationId,
            expiresAt,
            now,
          });

          try {
            const newTokens = await oauthService.refreshToken(organizationId, pluginId);
            return newTokens || tokens; // Fall back to old tokens if refresh fails
          } catch (error) {
            debugLog("oauth-auth", `Token refresh failed, using existing token`, {
              level: "warn",
              data: error instanceof Error ? error.message : String(error),
            });
            // If refresh fails but token hasn't expired yet, use it anyway
            if (expiresAt - now > 0) {
              return tokens;
            }
            // Token is expired and refresh failed
            return null;
          }
        }
      }

      return tokens;
    } catch (error) {
      debugLog("oauth-auth", `Failed to get OAuth tokens`, {
        level: "error",
        data: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Check if OAuth is configured for this plugin instance
   */
  async isConfigured(organizationId: string, pluginId: string): Promise<boolean> {
    const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (!plugin) {
      return false;
    }

    const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);

    return !!(instance && instance.authMethod === "oauth" && instance.config?._oauth);
  }
}

export const oauthAuthStrategy = new OAuthAuthStrategy();
