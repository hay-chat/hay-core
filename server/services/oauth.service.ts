import { config } from "@server/config/env";
import { oauthStateService } from "./oauth-state.service";
import { pluginRegistryRepository } from "@server/repositories/plugin-registry.repository";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { debugLog } from "@server/lib/debug-logger";
import type {
  OAuthConfig,
  OAuthAuthorizationUrl,
  OAuthTokenRequest,
  OAuthTokens,
  OAuthCallbackParams,
  OAuthRefreshResult,
} from "@server/types/oauth.types";
import type { HayPluginManifest } from "@server/types/plugin.types";

/**
 * OAuth Service
 * Handles OAuth 2.0/2.1 authorization flows for plugins
 */
export class OAuthService {
  /**
   * Get OAuth client credentials from environment
   */
  private getOAuthCredentials(pluginId: string): {
    clientId: string;
    clientSecret: string;
  } | null {
    const clientIdEnvVar = `${pluginId.toUpperCase().replace(/-/g, "_")}_OAUTH_CLIENT_ID`;
    const clientSecretEnvVar = `${pluginId.toUpperCase().replace(/-/g, "_")}_OAUTH_CLIENT_SECRET`;

    const clientId = process.env[clientIdEnvVar];
    const clientSecret = process.env[clientSecretEnvVar];

    if (!clientId || !clientSecret) {
      debugLog("oauth", `OAuth credentials not found for plugin: ${pluginId}`, {
        level: "warn",
        data: { clientIdEnvVar, clientSecretEnvVar },
      });
      return null;
    }

    return { clientId, clientSecret };
  }

  /**
   * Get OAuth redirect URI
   */
  private getRedirectUri(): string {
    // Use environment variable if set, otherwise construct from API URL
    if (process.env.OAUTH_REDIRECT_URI) {
      return process.env.OAUTH_REDIRECT_URI;
    }

    // Construct from config
    const apiUrl = config.server.apiUrl || `http://localhost:${config.server.port}`;
    return `${apiUrl}/oauth/callback`;
  }

  /**
   * Initiate OAuth authorization flow
   * Returns the authorization URL to redirect the user to
   */
  async initiateAuthorization(
    pluginId: string,
    organizationId: string,
    userId: string,
  ): Promise<OAuthAuthorizationUrl> {
    // Get plugin manifest
    const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    const manifest = plugin.manifest as HayPluginManifest;
    const oauthConfig = manifest.capabilities?.mcp?.auth?.oauth;

    if (!oauthConfig) {
      throw new Error(`Plugin ${pluginId} does not support OAuth`);
    }

    // Get OAuth credentials from environment
    const credentials = this.getOAuthCredentials(pluginId);
    if (!credentials) {
      throw new Error(
        `OAuth credentials not configured for ${pluginId}. Please set environment variables.`,
      );
    }

    // Generate PKCE code verifier and challenge if enabled
    let codeVerifier: string | undefined;
    let codeChallenge: string | undefined;

    if (oauthConfig.usePKCE !== false) {
      // PKCE enabled by default (OAuth 2.1 requirement)
      codeVerifier = oauthStateService.generateCodeVerifier();
      codeChallenge = await oauthStateService.generateCodeChallenge(codeVerifier);
    }

    // Store state in Redis
    const state = await oauthStateService.storeState(
      pluginId,
      organizationId,
      userId,
      codeVerifier,
    );

    // Build authorization URL
    const authUrl = new URL(oauthConfig.authorizationUrl);
    authUrl.searchParams.set("client_id", credentials.clientId);
    authUrl.searchParams.set("redirect_uri", this.getRedirectUri());
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("state", state);

    if (oauthConfig.scopes && oauthConfig.scopes.length > 0) {
      authUrl.searchParams.set("scope", oauthConfig.scopes.join(" "));
    }

    if (codeChallenge) {
      authUrl.searchParams.set("code_challenge", codeChallenge);
      authUrl.searchParams.set(
        "code_challenge_method",
        oauthConfig.pkceMethod || "S256",
      );
    }

    debugLog("oauth", `Initiated OAuth flow for plugin: ${pluginId}`, {
      data: { organizationId, userId, hasPKCE: !!codeVerifier },
    });

    return {
      url: authUrl.toString(),
      state,
    };
  }

  /**
   * Handle OAuth callback
   * Exchanges authorization code for access token
   */
  async handleCallback(callbackParams: OAuthCallbackParams): Promise<{
    success: boolean;
    pluginId?: string;
    organizationId?: string;
    error?: string;
  }> {
    // Check for error in callback
    if (callbackParams.error) {
      debugLog("oauth", `OAuth authorization failed`, {
        level: "error",
        data: {
          error: callbackParams.error,
          description: callbackParams.error_description,
        },
      });

      return {
        success: false,
        error: callbackParams.error_description || callbackParams.error,
      };
    }

    if (!callbackParams.code || !callbackParams.state) {
      return {
        success: false,
        error: "Missing authorization code or state parameter",
      };
    }

    // Retrieve state from Redis
    const state = await oauthStateService.retrieveState(callbackParams.state);
    if (!state) {
      return {
        success: false,
        error: "Invalid or expired authorization request",
      };
    }

    try {
      // Get plugin manifest
      const plugin = await pluginRegistryRepository.findByPluginId(state.pluginId);
      if (!plugin) {
        throw new Error(`Plugin ${state.pluginId} not found`);
      }

      const manifest = plugin.manifest as HayPluginManifest;
      const oauthConfig = manifest.capabilities?.mcp?.auth?.oauth;

      if (!oauthConfig) {
        throw new Error(`Plugin ${state.pluginId} does not support OAuth`);
      }

      // Get OAuth credentials
      const credentials = this.getOAuthCredentials(state.pluginId);
      if (!credentials) {
        throw new Error(`OAuth credentials not configured for ${state.pluginId}`);
      }

      // Exchange authorization code for tokens
      const tokens = await this.exchangeCodeForTokens(
        oauthConfig,
        credentials,
        callbackParams.code,
        state.codeVerifier,
      );

      // Store tokens in plugin instance config
      await this.storeTokens(state.organizationId, state.pluginId, tokens);

      debugLog("oauth", `OAuth flow completed successfully for plugin: ${state.pluginId}`, {
        data: { organizationId: state.organizationId },
      });

      return {
        success: true,
        pluginId: state.pluginId,
        organizationId: state.organizationId,
      };
    } catch (error) {
      debugLog("oauth", `OAuth callback failed`, { level: "error", data: error });

      return {
        success: false,
        pluginId: state.pluginId,
        organizationId: state.organizationId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Exchange authorization code for access tokens
   */
  private async exchangeCodeForTokens(
    oauthConfig: OAuthConfig,
    credentials: { clientId: string; clientSecret: string },
    code: string,
    codeVerifier?: string,
  ): Promise<OAuthTokens> {
    const tokenRequest: OAuthTokenRequest = {
      grant_type: "authorization_code",
      code,
      redirect_uri: this.getRedirectUri(),
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code_verifier: codeVerifier,
    };

    debugLog("oauth", `Exchanging authorization code for tokens`, {
      data: { tokenUrl: oauthConfig.tokenUrl, hasPKCE: !!codeVerifier },
    });

    const response = await fetch(oauthConfig.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams(tokenRequest as any).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      debugLog("oauth", `Token exchange failed`, {
        level: "error",
        data: { status: response.status, error: errorText },
      });
      throw new Error(`Token exchange failed: ${response.statusText}`);
    }

    const data = await response.json();

    // Calculate expiration timestamp
    const expiresAt = data.expires_in
      ? Date.now() + data.expires_in * 1000
      : undefined;

    const tokens: OAuthTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type || "Bearer",
      expires_in: data.expires_in,
      expires_at: expiresAt,
      scope: data.scope,
    };

    return tokens;
  }

  /**
   * Store OAuth tokens in plugin instance config
   */
  private async storeTokens(
    organizationId: string,
    pluginId: string,
    tokens: OAuthTokens,
  ): Promise<void> {
    const instance = await pluginInstanceRepository.findByOrgAndPlugin(
      organizationId,
      pluginId,
    );

    if (!instance) {
      throw new Error(`Plugin instance not found for org ${organizationId}`);
    }

    // Update config with OAuth tokens in the _oauth reserved namespace
    const updatedConfig = {
      ...(instance.config || {}),
      _oauth: tokens,
    };

    await pluginInstanceRepository.update(instance.id, organizationId, {
      config: updatedConfig,
      authMethod: "oauth",
    });

    debugLog("oauth", `Stored OAuth tokens for plugin: ${pluginId}`, {
      data: { organizationId },
    });
  }

  /**
   * Refresh OAuth access token
   */
  async refreshAccessToken(
    organizationId: string,
    pluginId: string,
  ): Promise<OAuthRefreshResult> {
    try {
      // Get plugin instance
      const instance = await pluginInstanceRepository.findByOrgAndPlugin(
        organizationId,
        pluginId,
      );

      if (!instance || !instance.config) {
        return {
          success: false,
          error: "Plugin instance not found or not configured",
        };
      }

      // Get current tokens
      const currentTokens = instance.config._oauth as OAuthTokens | undefined;
      if (!currentTokens || !currentTokens.refresh_token) {
        return {
          success: false,
          error: "No refresh token available",
        };
      }

      // Get plugin manifest
      const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
      if (!plugin) {
        return {
          success: false,
          error: `Plugin ${pluginId} not found`,
        };
      }

      const manifest = plugin.manifest as HayPluginManifest;
      const oauthConfig = manifest.capabilities?.mcp?.auth?.oauth;

      if (!oauthConfig) {
        return {
          success: false,
          error: `Plugin ${pluginId} does not support OAuth`,
        };
      }

      // Get OAuth credentials
      const credentials = this.getOAuthCredentials(pluginId);
      if (!credentials) {
        return {
          success: false,
          error: `OAuth credentials not configured for ${pluginId}`,
        };
      }

      // Refresh the token
      const tokenRequest: OAuthTokenRequest = {
        grant_type: "refresh_token",
        refresh_token: currentTokens.refresh_token,
        redirect_uri: this.getRedirectUri(),
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      };

      debugLog("oauth", `Refreshing access token for plugin: ${pluginId}`, {
        data: { organizationId },
      });

      const response = await fetch(oauthConfig.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams(tokenRequest as any).toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        debugLog("oauth", `Token refresh failed`, {
          level: "error",
          data: { status: response.status, error: errorText },
        });
        return {
          success: false,
          error: `Token refresh failed: ${response.statusText}`,
        };
      }

      const data = await response.json();

      // Calculate expiration timestamp
      const expiresAt = data.expires_in
        ? Date.now() + data.expires_in * 1000
        : undefined;

      const newTokens: OAuthTokens = {
        access_token: data.access_token,
        refresh_token: data.refresh_token || currentTokens.refresh_token, // Keep old refresh token if not rotated
        token_type: data.token_type || "Bearer",
        expires_in: data.expires_in,
        expires_at: expiresAt,
        scope: data.scope || currentTokens.scope,
      };

      // Store new tokens
      await this.storeTokens(organizationId, pluginId, newTokens);

      debugLog("oauth", `Access token refreshed successfully for plugin: ${pluginId}`, {
        data: { organizationId },
      });

      return {
        success: true,
        tokens: newTokens,
      };
    } catch (error) {
      debugLog("oauth", `Token refresh failed`, { level: "error", data: error });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Revoke OAuth authorization
   */
  async revokeAuthorization(organizationId: string, pluginId: string): Promise<void> {
    const instance = await pluginInstanceRepository.findByOrgAndPlugin(
      organizationId,
      pluginId,
    );

    if (!instance) {
      throw new Error(`Plugin instance not found for org ${organizationId}`);
    }

    // Remove OAuth tokens from config
    const updatedConfig = { ...(instance.config || {}) };
    delete updatedConfig._oauth;

    await pluginInstanceRepository.update(instance.id, organizationId, {
      config: updatedConfig,
      authMethod: null,
    });

    debugLog("oauth", `Revoked OAuth authorization for plugin: ${pluginId}`, {
      data: { organizationId },
    });
  }
}

export const oauthService = new OAuthService();
