import { pluginInstanceRepository } from "../repositories/plugin-instance.repository";
import { pluginRegistryRepository } from "../repositories/plugin-registry.repository";
import { oauthStateService } from "./oauth-state.service";
import { encryptValue, decryptValue, decryptConfig } from "../lib/auth/utils/encryption";
import { getApiUrl } from "../config/env";
import type {
  OAuthTokenData,
  OAuthConfig,
  OAuthManifestConfig,
  OAuthConnectionStatus,
} from "../types/oauth.types";
import type { HayPluginManifest } from "../types/plugin.types";
import { debugLog } from "@server/lib/debug-logger";

export class OAuthService {
  /**
   * Get OAuth redirect URI
   */
  getRedirectUri(): string {
    return process.env.OAUTH_REDIRECT_URI || `${getApiUrl()}/oauth/callback`;
  }

  /**
   * Check if OAuth is available for a plugin
   * OAuth is available if client_id env var is set
   */
  isOAuthAvailable(pluginId: string, manifest: HayPluginManifest): boolean {
    const oauthConfig = manifest.capabilities?.mcp?.auth?.oauth;
    if (!oauthConfig) {
      return false;
    }

    const credentials = this.getClientCredentials(pluginId, manifest);
    return credentials.clientId !== null;
  }

  /**
   * Get OAuth client credentials from environment
   * For CIMD: Only client_id is needed (set to redirect URI)
   * For traditional OAuth: Both client_id and client_secret are needed
   */
  getClientCredentials(
    pluginId: string,
    manifest: HayPluginManifest,
  ): {
    clientId: string | null;
    clientSecret: string | null;
  } {
    const oauthConfig = manifest.capabilities?.mcp?.auth?.oauth;
    if (!oauthConfig) {
      return { clientId: null, clientSecret: null };
    }

    const clientIdVar =
      oauthConfig.clientIdEnvVar || `${pluginId.toUpperCase().replace(/-/g, "_")}_OAUTH_CLIENT_ID`;
    const clientSecretVar =
      oauthConfig.clientSecretEnvVar ||
      `${pluginId.toUpperCase().replace(/-/g, "_")}_OAUTH_CLIENT_SECRET`;

    return {
      clientId: process.env[clientIdVar] || null,
      clientSecret: process.env[clientSecretVar] || null,
    };
  }

  /**
   * Generate authorization URL for OAuth flow
   */
  async initiateOAuth(
    pluginId: string,
    organizationId: string,
    userId: string,
  ): Promise<{ authorizationUrl: string; state: string }> {
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
    const credentials = this.getClientCredentials(pluginId, manifest);
    if (!credentials.clientId) {
      throw new Error(
        `OAuth not configured. Please set ${pluginId.toUpperCase().replace(/-/g, "_")}_OAUTH_CLIENT_ID environment variable.`,
      );
    }

    // Note: client_secret is optional (for CIMD, client_id is the redirect URI itself)
    const validCredentials = {
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
    };

    // Generate state nonce
    const nonce = oauthStateService.generateNonce();

    // Generate PKCE if required
    let codeVerifier: string | undefined;
    let codeChallenge: string | undefined;
    if (oauthConfig.pkce) {
      const pkce = oauthStateService.generatePKCE();
      codeVerifier = pkce.codeVerifier;
      codeChallenge = pkce.codeChallenge;
    }

    // Store state in Redis
    await oauthStateService.storeState({
      pluginId,
      organizationId,
      userId,
      nonce,
      codeVerifier,
      createdAt: Date.now(),
    });

    // Build authorization URL
    const redirectUri = this.getRedirectUri();
    const params = new URLSearchParams({
      client_id: validCredentials.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      state: nonce,
      scope: oauthConfig.scopes.join(" "),
    });

    if (codeChallenge) {
      params.append("code_challenge", codeChallenge);
      params.append("code_challenge_method", "S256");
    }

    const authorizationUrl = `${oauthConfig.authorizationUrl}?${params.toString()}`;

    debugLog("oauth", `Initiated OAuth flow for plugin ${pluginId}`, {
      organizationId,
      userId,
      nonce: nonce.substring(0, 8) + "...",
    });

    return { authorizationUrl, state: nonce };
  }

  /**
   * Handle OAuth callback and exchange code for tokens
   */
  async handleCallback(
    code: string,
    state: string,
    error?: string,
  ): Promise<{ success: boolean; pluginId?: string; organizationId?: string; error?: string }> {
    if (error) {
      debugLog("oauth", `OAuth callback error: ${error}`, { level: "error" });
      return { success: false, error };
    }

    // Retrieve state from Redis (one-time use)
    const oauthState = await oauthStateService.retrieveState(state);
    if (!oauthState) {
      debugLog("oauth", `Invalid or expired OAuth state: ${state}`, { level: "error" });
      return { success: false, error: "Invalid or expired state" };
    }

    const { pluginId, organizationId, codeVerifier } = oauthState;

    try {
      // Get plugin and manifest
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
      const credentials = this.getClientCredentials(pluginId, manifest);
      if (!credentials.clientId) {
        throw new Error("OAuth not configured");
      }

      const validCredentials = {
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
      };

      // Exchange code for tokens
      const tokens = await this.exchangeCodeForTokens(
        code,
        oauthConfig,
        validCredentials,
        codeVerifier,
      );

      // Store tokens in plugin instance config
      await this.storeTokens(organizationId, pluginId, tokens, oauthConfig.scopes);

      debugLog("oauth", `OAuth callback successful for plugin ${pluginId}`, {
        organizationId,
      });

      return { success: true, pluginId, organizationId };
    } catch (error) {
      debugLog("oauth", `OAuth callback failed`, {
        level: "error",
        data: error instanceof Error ? error.message : String(error),
        pluginId,
        organizationId,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Token exchange failed",
      };
    }
  }

  /**
   * Exchange authorization code for access token
   */
  private async exchangeCodeForTokens(
    code: string,
    oauthConfig: OAuthManifestConfig,
    credentials: { clientId: string; clientSecret: string | null },
    codeVerifier?: string,
  ): Promise<OAuthTokenData> {
    const redirectUri = this.getRedirectUri();

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: credentials.clientId,
    });

    // Only add client_secret for traditional OAuth (not CIMD)
    if (credentials.clientSecret) {
      body.append("client_secret", credentials.clientSecret);
    }

    if (codeVerifier) {
      body.append("code_verifier", codeVerifier);
    }

    const response = await fetch(oauthConfig.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    // Calculate expires_at if expires_in is provided
    let expiresAt: number | undefined;
    if (data.expires_in) {
      expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;
    }

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      expires_at: expiresAt,
      token_type: data.token_type || "Bearer",
      scope: data.scope,
    };
  }

  /**
   * Store OAuth tokens in plugin instance config
   */
  private async storeTokens(
    organizationId: string,
    pluginId: string,
    tokens: OAuthTokenData,
    scopes?: string[],
  ): Promise<void> {
    const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    // Get or create instance
    let instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, plugin.id);

    const oauthData: OAuthConfig["_oauth"] = {
      tokens,
      connected_at: Math.floor(Date.now() / 1000),
      provider: pluginId,
      scopes,
    };

    // Encrypt OAuth tokens (access_token and refresh_token are sensitive)
    const encryptedTokens: OAuthTokenData = {
      ...tokens,
      access_token: encryptValue(tokens.access_token),
      refresh_token: tokens.refresh_token ? encryptValue(tokens.refresh_token) : undefined,
    };

    const encryptedOAuthData: OAuthConfig["_oauth"] = {
      ...oauthData,
      tokens: encryptedTokens,
    };

    // Store encrypted OAuth data (no need for encryptConfig since we manually encrypted tokens)
    const configToStore = {
      _oauth: encryptedOAuthData,
    };

    if (instance) {
      // Update existing instance
      const currentConfig = instance.config || {};
      await pluginInstanceRepository.updateConfig(instance.id, {
        ...currentConfig,
        ...configToStore,
      });

      // Update auth_method
      await pluginInstanceRepository.update(instance.id, instance.organizationId, {
        authMethod: "oauth",
      });
    } else {
      // Create new instance
      await pluginInstanceRepository.upsertInstance(organizationId, pluginId, {
        config: configToStore,
        authMethod: "oauth",
        enabled: false, // Don't auto-enable
      });
    }
  }

  /**
   * Revoke OAuth connection
   */
  async revokeOAuth(organizationId: string, pluginId: string): Promise<void> {
    const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, plugin.id);
    if (!instance) {
      throw new Error(`Plugin instance not found`);
    }

    // Remove OAuth data from config
    const currentConfig = instance.config || {};
    const { _oauth, ...restConfig } = currentConfig;

    await pluginInstanceRepository.updateConfig(instance.id, restConfig);

    // Clear auth_method
    await pluginInstanceRepository.update(instance.id, organizationId, {
      authMethod: undefined,
    });

    debugLog("oauth", `OAuth revoked for plugin ${pluginId}`, { organizationId });
  }

  /**
   * Get OAuth connection status
   */
  async getConnectionStatus(
    organizationId: string,
    pluginId: string,
  ): Promise<OAuthConnectionStatus> {
    const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (!plugin) {
      return { connected: false, error: "Plugin not found" };
    }

    const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, plugin.id);
    if (!instance || !instance.config?._oauth) {
      return { connected: false };
    }

    try {
      const decryptedConfig = decryptConfig(instance.config);
      const oauthData = (decryptedConfig as any)._oauth;

      if (!oauthData?.tokens) {
        return { connected: false };
      }

      const expiresAt = oauthData.tokens.expires_at;
      const connectedAt = oauthData.connected_at;

      return {
        connected: true,
        expiresAt,
        connectedAt,
      };
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : "Failed to read OAuth data",
      };
    }
  }

  /**
   * Refresh OAuth access token
   */
  async refreshToken(organizationId: string, pluginId: string): Promise<OAuthTokenData | null> {
    const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, plugin.id);
    if (!instance || !instance.config?._oauth) {
      throw new Error("OAuth not configured for this plugin instance");
    }

    const manifest = plugin.manifest as HayPluginManifest;
    const oauthConfig = manifest.capabilities?.mcp?.auth?.oauth;
    if (!oauthConfig) {
      throw new Error(`Plugin ${pluginId} does not support OAuth`);
    }

    // Decrypt config
    const decryptedConfig = decryptConfig(instance.config);
    const oauthData = (decryptedConfig as any)._oauth;

    if (!oauthData?.tokens?.refresh_token) {
      throw new Error("No refresh token available");
    }

    // Decrypt refresh token
    const refreshToken = decryptValue(oauthData.tokens.refresh_token);

    // Get OAuth credentials from environment
    const credentials = this.getClientCredentials(pluginId, manifest);
    if (!credentials.clientId) {
      throw new Error("OAuth not configured");
    }

    const validCredentials = {
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
    };

    // Refresh token
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: validCredentials.clientId,
    });

    // Only add client_secret if available (optional for CIMD)
    if (validCredentials.clientSecret) {
      body.append("client_secret", validCredentials.clientSecret);
    }

    const response = await fetch(oauthConfig.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    // Calculate expires_at
    let expiresAt: number | undefined;
    if (data.expires_in) {
      expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;
    }

    const newTokens: OAuthTokenData = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || oauthData.tokens.refresh_token, // Keep old if not provided
      expires_in: data.expires_in,
      expires_at: expiresAt,
      token_type: data.token_type || "Bearer",
      scope: data.scope || oauthData.tokens.scope,
    };

    // Encrypt tokens before storing
    const encryptedTokens: OAuthTokenData = {
      ...newTokens,
      access_token: encryptValue(newTokens.access_token),
      refresh_token: newTokens.refresh_token ? encryptValue(newTokens.refresh_token) : undefined,
    };

    // Update stored tokens
    const updatedOAuthData = {
      ...oauthData,
      tokens: encryptedTokens,
    };

    const currentConfig = instance.config || {};
    await pluginInstanceRepository.updateConfig(instance.id, {
      ...currentConfig,
      _oauth: updatedOAuthData,
    });

    debugLog("oauth", `Token refreshed for plugin ${pluginId}`, { organizationId });

    return newTokens;
  }
}

export const oauthService = new OAuthService();
