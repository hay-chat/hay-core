import { pluginInstanceRepository } from "../repositories/plugin-instance.repository";
import { pluginRegistryRepository } from "../repositories/plugin-registry.repository";
import { oauthStateService } from "./oauth-state.service";
import { encryptValue, decryptValue, decryptConfig } from "../lib/auth/utils/encryption";
import { resolveConfigWithEnv } from "../lib/config-resolver";
import { getApiUrl } from "../config/env";
import type {
  OAuthTokenData,
  OAuthConfig,
  OAuthManifestConfig,
  OAuthConnectionStatus,
  PluginConfigWithOAuth,
} from "../types/oauth.types";
import type { HayPluginManifest } from "../types/plugin.types";
import type { AuthMethodDescriptor, ConfigFieldDescriptor } from "../types/plugin-sdk-v2.types";
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
   * OAuth is available if:
   * 1. Plugin manifest has auth.type === "oauth2"
   * 2. Client ID environment variable is set
   */
  isOAuthAvailable(pluginId: string, manifest: HayPluginManifest): boolean {
    // Check if plugin supports OAuth via auth.type field (TypeScript-first plugins)
    if (manifest.auth?.type === "oauth2") {
      const credentials = this.getClientCredentials(pluginId, manifest);
      return credentials.clientId !== null;
    }

    return false;
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
    // For TypeScript-first plugins: Look for CLIENT_ID and CLIENT_SECRET in permissions.env or auth config
    if (manifest.auth?.type === "oauth2") {
      // First check auth config for env var names
      if (manifest.auth.clientIdEnvVar && manifest.auth.clientSecretEnvVar) {
        return {
          clientId: process.env[manifest.auth.clientIdEnvVar] || null,
          clientSecret: process.env[manifest.auth.clientSecretEnvVar] || null,
        };
      }

      // Fallback: check permissions.env
      if (manifest.permissions?.env) {
        const envVars = manifest.permissions.env;
        const clientIdVar = envVars.find((v: string) => v.includes("CLIENT_ID"));
        const clientSecretVar = envVars.find((v: string) => v.includes("CLIENT_SECRET"));

        return {
          clientId: clientIdVar ? process.env[clientIdVar] || null : null,
          clientSecret: clientSecretVar ? process.env[clientSecretVar] || null : null,
        };
      }
    }

    // Legacy: Check old object-based capabilities format
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
    console.log("\n========== OAUTH INITIATE START ==========");
    console.log("Plugin ID:", pluginId);
    console.log("Organization ID:", organizationId);
    console.log("User ID:", userId);

    const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    // Get plugin instance
    const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
    if (!instance) {
      throw new Error(`Plugin ${pluginId} not configured for this organization`);
    }

    // SDK v2: Check metadata.authMethods for OAuth2 registration
    if (!plugin.metadata?.authMethods) {
      throw new Error(`Plugin ${pluginId} does not have metadata (SDK v2 required)`);
    }

    console.log("Checking metadata.authMethods for OAuth2...");
    const oauth2Method = plugin.metadata.authMethods.find(
      (method: AuthMethodDescriptor) => method.type === "oauth2",
    );

    if (!oauth2Method) {
      throw new Error(`Plugin ${pluginId} does not support OAuth`);
    }

    console.log("OAuth2 method found in metadata:", oauth2Method.id);

    // Validate required OAuth fields
    if (!oauth2Method.authorizationUrl || !oauth2Method.tokenUrl) {
      throw new Error(`OAuth2 method missing required fields (authorizationUrl or tokenUrl)`);
    }

    // Extract OAuth configuration from metadata
    const oauthConfig: OAuthManifestConfig = {
      authorizationUrl: oauth2Method.authorizationUrl,
      tokenUrl: oauth2Method.tokenUrl,
      scopes: oauth2Method.scopes || [],
      optionalScopes: oauth2Method.optionalScopes,
      pkce: true, // SDK v2 always uses PKCE for security
    };

    // Get client credentials from plugin instance using config resolver with env fallback
    const clientIdFieldName = oauth2Method.clientId;
    const clientSecretFieldName = oauth2Method.clientSecret;

    if (!clientIdFieldName || !clientSecretFieldName) {
      throw new Error(`OAuth2 method missing clientId or clientSecret field references`);
    }

    // Use config resolver to get values with .env fallback
    const configSchema = plugin.metadata?.configSchema || {};
    const resolved = resolveConfigWithEnv(
      instance.config,
      configSchema as Record<string, ConfigFieldDescriptor>,
      {
        decrypt: true,
        maskSecrets: false, // We need actual values for OAuth flow
      },
    );

    // Check resolved metadata for values (includes env fallback)
    const clientId =
      resolved.metadata[clientIdFieldName]?.value ||
      instance.authState?.credentials?.[clientIdFieldName] ||
      null;
    const clientSecret =
      resolved.metadata[clientSecretFieldName]?.value ||
      instance.authState?.credentials?.[clientSecretFieldName] ||
      null;

    console.log("Client ID:", clientId ? clientId.substring(0, 20) + "..." : "NOT SET");
    console.log("Client Secret:", clientSecret ? "SET (hidden)" : "NOT SET");

    if (!clientId) {
      throw new Error(`OAuth client ID not configured for plugin ${pluginId}`);
    }

    const credentials = { clientId, clientSecret };

    // Note: client_secret is optional (for CIMD, client_id is the redirect URI itself)
    const validCredentials = {
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
    };

    // Generate state nonce
    const nonce = oauthStateService.generateNonce();
    console.log("Generated nonce:", nonce.substring(0, 20) + "...");

    // Generate PKCE if required
    let codeVerifier: string | undefined;
    let codeChallenge: string | undefined;
    if (oauthConfig.pkce) {
      const pkce = oauthStateService.generatePKCE();
      codeVerifier = pkce.codeVerifier;
      codeChallenge = pkce.codeChallenge;
      console.log("PKCE enabled - Code Challenge:", codeChallenge.substring(0, 20) + "...");
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
    console.log("State stored in Redis");

    // Build authorization URL
    const redirectUri = this.getRedirectUri();
    const params = new URLSearchParams({
      client_id: validCredentials.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      state: nonce,
    });

    // Add required scopes
    if (oauthConfig.scopes && oauthConfig.scopes.length > 0) {
      params.append("scope", oauthConfig.scopes.join(" "));
    }

    // Add optional scopes as a separate parameter
    if (oauthConfig.optionalScopes && oauthConfig.optionalScopes.length > 0) {
      params.append("optional_scope", oauthConfig.optionalScopes.join(" "));
    }

    if (codeChallenge) {
      params.append("code_challenge", codeChallenge);
      params.append("code_challenge_method", "S256");
    }

    // Convert to string and replace + with %20 for proper URL encoding (RFC 3986)
    const authorizationUrl = `${oauthConfig.authorizationUrl}?${params.toString().replace(/\+/g, "%20")}`;

    // Log the authorization URL to console
    console.log(`\n🔐 OAuth Authorization URL for ${pluginId}:\n${authorizationUrl}\n`);
    console.log("========== OAUTH INITIATE END ==========\n");

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
    console.log("\n========== OAUTH CALLBACK START ==========");
    console.log("Code received:", code ? code.substring(0, 20) + "..." : "NOT PROVIDED");
    console.log("State received:", state ? state.substring(0, 20) + "..." : "NOT PROVIDED");
    console.log("Error received:", error || "NONE");

    if (error) {
      console.log("OAuth provider returned error:", error);
      debugLog("oauth", `OAuth callback error: ${error}`, { level: "error" });
      return { success: false, error };
    }

    // Retrieve state from Redis (one-time use)
    console.log("Retrieving state from Redis...");
    const oauthState = await oauthStateService.retrieveState(state);

    if (!oauthState) {
      console.log("❌ State not found in Redis or expired");
      debugLog("oauth", `Invalid or expired OAuth state: ${state}`, { level: "error" });
      return { success: false, error: "Invalid or expired state" };
    }

    console.log("✅ State retrieved from Redis:");
    console.log("  Plugin ID:", oauthState.pluginId);
    console.log("  Organization ID:", oauthState.organizationId);
    console.log("  User ID:", oauthState.userId);
    console.log("  Has code verifier:", !!oauthState.codeVerifier);

    const { pluginId, organizationId, codeVerifier } = oauthState;

    try {
      // Get plugin
      console.log("Loading plugin...");
      const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
      if (!plugin) {
        throw new Error(`Plugin ${pluginId} not found`);
      }

      // Get plugin instance
      const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
      if (!instance) {
        throw new Error(`Plugin ${pluginId} not configured for this organization`);
      }

      // SDK v2: Check metadata.authMethods for OAuth2 registration
      if (!plugin.metadata?.authMethods) {
        throw new Error(`Plugin ${pluginId} does not have metadata (SDK v2 required)`);
      }

      console.log("Checking metadata.authMethods for OAuth2...");
      const oauth2Method = plugin.metadata.authMethods.find(
        (method: AuthMethodDescriptor) => method.type === "oauth2",
      );

      if (!oauth2Method) {
        throw new Error(`Plugin ${pluginId} does not support OAuth`);
      }

      console.log("OAuth2 method found in metadata:", oauth2Method.id);

      // Validate required OAuth fields
      if (!oauth2Method.tokenUrl) {
        throw new Error(`OAuth2 method missing tokenUrl`);
      }

      // Extract OAuth configuration from metadata
      const oauthConfig: OAuthManifestConfig = {
        authorizationUrl: oauth2Method.authorizationUrl || "",
        tokenUrl: oauth2Method.tokenUrl,
        scopes: oauth2Method.scopes || [],
        optionalScopes: oauth2Method.optionalScopes,
        pkce: true,
      };

      console.log("Token URL:", oauthConfig.tokenUrl);

      // Get client credentials from plugin instance using config resolver with env fallback
      const clientIdFieldName = oauth2Method.clientId;
      const clientSecretFieldName = oauth2Method.clientSecret;

      if (!clientIdFieldName || !clientSecretFieldName) {
        throw new Error(`OAuth2 method missing clientId or clientSecret field references`);
      }

      // Use config resolver to get values with .env fallback
      const configSchema = plugin.metadata?.configSchema || {};
      const resolved = resolveConfigWithEnv(
        instance.config,
        configSchema as Record<string, ConfigFieldDescriptor>,
        {
          decrypt: true,
          maskSecrets: false, // We need actual values for OAuth flow
        },
      );

      const clientId =
        resolved.metadata[clientIdFieldName]?.value ||
        instance.authState?.credentials?.[clientIdFieldName] ||
        null;
      const clientSecret =
        resolved.metadata[clientSecretFieldName]?.value ||
        instance.authState?.credentials?.[clientSecretFieldName] ||
        null;

      if (!clientId) {
        throw new Error("OAuth client ID not configured");
      }

      const validCredentials = {
        clientId,
        clientSecret,
      };

      console.log("Exchanging authorization code for tokens...");
      // Exchange code for tokens
      const tokens = await this.exchangeCodeForTokens(
        code,
        oauthConfig,
        validCredentials,
        codeVerifier,
      );
      console.log("✅ Tokens received from provider:");
      console.log(
        "  Access token:",
        tokens.access_token ? tokens.access_token.substring(0, 20) + "..." : "NOT PROVIDED",
      );
      console.log("  Refresh token:", tokens.refresh_token ? "PROVIDED" : "NOT PROVIDED");
      console.log("  Expires in:", tokens.expires_in);
      console.log("  Token type:", tokens.token_type);
      console.log("  Scope:", tokens.scope);

      // Combine required and optional scopes for storage
      const allScopes: string[] = [];
      if (oauthConfig.scopes && oauthConfig.scopes.length > 0) {
        allScopes.push(...oauthConfig.scopes);
      }
      if (oauthConfig.optionalScopes && oauthConfig.optionalScopes.length > 0) {
        allScopes.push(...oauthConfig.optionalScopes);
      }

      // Store tokens in plugin instance config
      console.log("Storing tokens in database...");
      console.log("  Combined scopes:", allScopes);
      await this.storeTokens(organizationId, pluginId, tokens, allScopes);
      console.log("✅ Tokens stored successfully");

      debugLog("oauth", `OAuth callback successful for plugin ${pluginId}`, {
        organizationId,
      });

      console.log("========== OAUTH CALLBACK SUCCESS ==========\n");
      return { success: true, pluginId, organizationId };
    } catch (error) {
      console.log("❌ OAuth callback failed:");
      console.error(error);
      debugLog("oauth", `OAuth callback failed`, {
        level: "error",
        data: error instanceof Error ? error.message : String(error),
        pluginId,
        organizationId,
      });
      console.log("========== OAUTH CALLBACK FAILED ==========\n");
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

    console.log("Token exchange request:");
    console.log("  URL:", oauthConfig.tokenUrl);
    console.log("  Grant type:", "authorization_code");
    console.log("  Redirect URI:", redirectUri);
    console.log("  Has client secret:", !!credentials.clientSecret);
    console.log("  Has code verifier:", !!codeVerifier);

    const response = await fetch(oauthConfig.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    console.log("Token exchange response status:", response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.log("❌ Token exchange error response:", errorText);
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    console.log("Token exchange response data:", JSON.stringify(data, null, 2));

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
    console.log("\n--- Storing OAuth tokens ---");
    console.log("Plugin ID:", pluginId);
    console.log("Organization ID:", organizationId);

    const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    console.log("Plugin registry ID:", plugin.id);

    // Get or create instance (pass string pluginId, not UUID)
    const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
    console.log("Existing instance found:", !!instance);
    if (instance) {
      console.log("  Instance ID:", instance.id);
      console.log("  Instance enabled:", instance.enabled);
      console.log("  Instance authMethod:", instance.authMethod);
      console.log("  Instance has config:", !!instance.config);
    }

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
      console.log("Updating existing instance...");
      // Update existing instance
      const currentConfig = instance.config || {};
      console.log("  Current config keys:", Object.keys(currentConfig));
      console.log("  New config keys:", Object.keys(configToStore));

      await pluginInstanceRepository.updateConfig(instance.id, {
        ...currentConfig,
        ...configToStore,
      });
      console.log("  Config updated");

      // Update auth_method
      await pluginInstanceRepository.update(instance.id, instance.organizationId, {
        authMethod: "oauth",
      });
      console.log("  Auth method updated to oauth");
      console.log("  Instance enabled state should remain:", instance.enabled);
    } else {
      console.log("Creating new instance with enabled=false...");
      // Create new instance
      await pluginInstanceRepository.upsertInstance(organizationId, pluginId, {
        config: configToStore,
        authMethod: "oauth",
        enabled: false, // Don't auto-enable
      });
      console.log("  New instance created");
    }
    console.log("--- OAuth tokens stored ---\n");
  }

  /**
   * Revoke OAuth connection
   */
  async revokeOAuth(organizationId: string, pluginId: string): Promise<void> {
    const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
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

    const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
    if (!instance || !instance.config?._oauth) {
      return { connected: false };
    }

    try {
      const decryptedConfig = decryptConfig(instance.config) as PluginConfigWithOAuth;

      if (!decryptedConfig._oauth?.tokens) {
        return { connected: false };
      }

      const oauthData = decryptedConfig._oauth;

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

    const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
    if (!instance || !instance.config?._oauth) {
      throw new Error("OAuth not configured for this plugin instance");
    }

    // SDK v2: Check metadata.authMethods for OAuth2 registration
    if (!plugin.metadata?.authMethods) {
      throw new Error(`Plugin ${pluginId} does not have metadata (SDK v2 required)`);
    }

    const oauth2Method = plugin.metadata.authMethods.find(
      (method: AuthMethodDescriptor) => method.type === "oauth2",
    );

    if (!oauth2Method) {
      throw new Error(`Plugin ${pluginId} does not support OAuth`);
    }

    if (!oauth2Method.tokenUrl) {
      throw new Error(`OAuth2 method missing tokenUrl`);
    }

    const oauthConfig = {
      tokenUrl: oauth2Method.tokenUrl,
    };

    // Decrypt config
    const decryptedConfig = decryptConfig(instance.config) as PluginConfigWithOAuth;

    if (!decryptedConfig._oauth?.tokens?.refresh_token) {
      throw new Error("No refresh token available");
    }

    const oauthData = decryptedConfig._oauth;

    // Decrypt refresh token (already validated above that it exists)
    const refreshToken = decryptValue(oauthData.tokens.refresh_token!);

    // Get client credentials from plugin instance using config resolver with env fallback
    const clientIdFieldName = oauth2Method.clientId;
    const clientSecretFieldName = oauth2Method.clientSecret;

    if (!clientIdFieldName || !clientSecretFieldName) {
      throw new Error(`OAuth2 method missing clientId or clientSecret field references`);
    }

    // Use config resolver to get values with .env fallback
    const configSchema = plugin.metadata?.configSchema || {};
    const resolved = resolveConfigWithEnv(
      instance.config,
      configSchema as Record<string, ConfigFieldDescriptor>,
      {
        decrypt: true,
        maskSecrets: false, // We need actual values for OAuth flow
      },
    );

    const clientId =
      resolved.metadata[clientIdFieldName]?.value ||
      instance.authState?.credentials?.[clientIdFieldName] ||
      null;
    const clientSecret =
      resolved.metadata[clientSecretFieldName]?.value ||
      instance.authState?.credentials?.[clientSecretFieldName] ||
      null;

    if (!clientId) {
      throw new Error("OAuth client ID not configured");
    }

    const credentials = { clientId, clientSecret };

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
