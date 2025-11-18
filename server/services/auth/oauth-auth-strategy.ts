import { decryptConfig } from "@server/lib/auth/utils/encryption";
import { oauthService } from "../oauth.service";
import { debugLog } from "@server/lib/debug-logger";
import type { PluginInstance } from "@server/entities/plugin-instance.entity";
import type { HayPluginManifest } from "@server/types/plugin.types";
import type { OAuthTokens } from "@server/types/oauth.types";
import type { AuthStrategy } from "./auth-strategy.interface";

/**
 * OAuth Auth Strategy
 * Handles OAuth 2.0/2.1 authentication with automatic token refresh
 */
export class OAuthAuthStrategy implements AuthStrategy {
  private instance: PluginInstance;
  private manifest: HayPluginManifest;
  private readonly REFRESH_BUFFER_SECONDS = 300; // Refresh 5 minutes before expiry

  constructor(instance: PluginInstance, manifest: HayPluginManifest) {
    this.instance = instance;
    this.manifest = manifest;
  }

  /**
   * Get OAuth tokens from config
   */
  private getTokens(): OAuthTokens | null {
    if (!this.instance.config) {
      return null;
    }

    const decryptedConfig = decryptConfig(this.instance.config);
    const tokens = decryptedConfig._oauth as OAuthTokens | undefined;

    if (!tokens || !tokens.access_token) {
      return null;
    }

    return tokens;
  }

  /**
   * Get authentication headers for remote MCP servers
   * Automatically refreshes token if expired
   */
  async getHeaders(): Promise<Record<string, string>> {
    // Ensure token is valid and refresh if needed
    const refreshed = await this.refresh();
    if (!refreshed) {
      throw new Error("Failed to refresh expired OAuth token");
    }

    const tokens = this.getTokens();
    if (!tokens) {
      throw new Error("OAuth tokens not found");
    }

    return {
      Authorization: `${tokens.token_type} ${tokens.access_token}`,
    };
  }

  /**
   * Get environment variables for local MCP servers
   * OAuth tokens can be passed as environment variables
   */
  async getEnvironmentVariables(): Promise<Record<string, string>> {
    // Ensure token is valid and refresh if needed
    const refreshed = await this.refresh();
    if (!refreshed) {
      throw new Error("Failed to refresh expired OAuth token");
    }

    const tokens = this.getTokens();
    if (!tokens) {
      return {};
    }

    // Standard OAuth environment variables
    const env: Record<string, string> = {
      OAUTH_ACCESS_TOKEN: tokens.access_token,
      OAUTH_TOKEN_TYPE: tokens.token_type,
    };

    if (tokens.refresh_token) {
      env.OAUTH_REFRESH_TOKEN = tokens.refresh_token;
    }

    if (tokens.scope) {
      env.OAUTH_SCOPES: tokens.scope;
    }

    return env;
  }

  /**
   * Check if OAuth token is valid and not expired
   */
  async isValid(): Promise<boolean> {
    const tokens = this.getTokens();
    if (!tokens) {
      return false;
    }

    // If no expiration time, assume valid
    if (!tokens.expires_at) {
      return true;
    }

    const now = Date.now();
    const bufferMs = this.REFRESH_BUFFER_SECONDS * 1000;

    // Check if token will expire within the buffer period
    return tokens.expires_at > now + bufferMs;
  }

  /**
   * Refresh OAuth token if expired or expiring soon
   * Returns true if token is valid or was successfully refreshed
   */
  async refresh(): Promise<boolean> {
    const tokens = this.getTokens();
    if (!tokens) {
      debugLog("oauth-auth", "No OAuth tokens found", { level: "warn" });
      return false;
    }

    // Check if token needs refresh
    const isCurrentlyValid = await this.isValid();
    if (isCurrentlyValid) {
      return true; // Token is still valid, no refresh needed
    }

    // Check if we have a refresh token
    if (!tokens.refresh_token) {
      debugLog("oauth-auth", "No refresh token available", { level: "warn" });
      return false;
    }

    debugLog("oauth-auth", `Refreshing OAuth token for plugin: ${this.instance.pluginId}`, {
      data: { organizationId: this.instance.organizationId },
    });

    // Attempt to refresh the token
    const result = await oauthService.refreshAccessToken(
      this.instance.organizationId,
      this.instance.plugin.pluginId,
    );

    if (!result.success) {
      debugLog("oauth-auth", `Token refresh failed`, {
        level: "error",
        data: { error: result.error },
      });
      return false;
    }

    debugLog("oauth-auth", `OAuth token refreshed successfully`);
    return true;
  }
}
