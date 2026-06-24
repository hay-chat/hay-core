import { pluginInstanceRepository } from "../repositories/plugin-instance.repository";
import { pluginRegistryRepository } from "../repositories/plugin-registry.repository";
import { pluginWebhookRouteRepository } from "../repositories/plugin-webhook-route.repository";
import { pluginManagerService } from "./plugin-manager.service";
import { oauthStateService } from "./oauth-state.service";
import { resolveConfigWithEnv } from "../lib/config-resolver";
import { getApiUrl } from "../config/env";
import type {
  OAuthTokenData,
  OAuthManifestConfig,
  OAuthConnectionStatus,
} from "../types/oauth.types";
import type { HayPluginManifest } from "../types/plugin.types";
import type { AuthMethodDescriptor, ConfigFieldDescriptor } from "../types/plugin-sdk.types";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("oauth");

/**
 * Coerce a resolved config/credential value (typed `unknown`) to a string,
 * or null if it is absent or not a string. OAuth client credentials are
 * always stored as strings, but the config resolver and authState typings
 * surface them as `unknown`.
 */
function asCredentialString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Substitute a per-tenant `{shop}` placeholder in an OAuth URL.
 *
 * Some providers (notably Shopify) host the authorize/token endpoints on a
 * per-merchant domain — `https://{shop}/admin/oauth/...`. SDK oauth2 methods
 * declare these URLs as static strings, so we resolve `{shop}` from the
 * instance's `shopDomain` config at flow time. Generic + safe: URLs without
 * `{shop}` are returned untouched.
 */
function substituteShopPlaceholder(url: string, shopDomain: unknown): string {
  if (!url || !url.includes("{shop}")) return url;
  const shop = String(shopDomain ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  if (!shop) {
    throw new Error("This connection requires a store domain to be saved before connecting.");
  }
  return url.replace(/\{shop\}/g, shop);
}

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
    logger.info({ pluginId, organizationId, userId }, "OAuth initiate started");

    const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    // Get plugin instance
    const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
    if (!instance) {
      throw new Error(`Plugin ${pluginId} not configured for this organization`);
    }

    // Check metadata.authMethods for OAuth2 registration
    if (!plugin.metadata?.authMethods) {
      throw new Error(`Plugin ${pluginId} does not have metadata (metadata required)`);
    }

    logger.debug("Checking metadata.authMethods for OAuth2");
    const oauth2Method = plugin.metadata.authMethods.find(
      (method: AuthMethodDescriptor) => method.type === "oauth2",
    );

    if (!oauth2Method) {
      throw new Error(`Plugin ${pluginId} does not support OAuth`);
    }

    logger.debug({ methodId: oauth2Method.id }, "OAuth2 method found in metadata");

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
      pkce: true, // Always use PKCE for security
      authorizationParams: oauth2Method.authorizationParams,
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
      asCredentialString(resolved.metadata[clientIdFieldName]?.value) ||
      asCredentialString(instance.authState?.credentials?.[clientIdFieldName]);
    const clientSecret =
      asCredentialString(resolved.metadata[clientSecretFieldName]?.value) ||
      asCredentialString(instance.authState?.credentials?.[clientSecretFieldName]);

    logger.debug(
      { clientIdSet: !!clientId, clientSecretSet: !!clientSecret },
      "OAuth client credentials resolved",
    );

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
    logger.debug("Generated OAuth state nonce");

    // Generate PKCE if required
    let codeVerifier: string | undefined;
    let codeChallenge: string | undefined;
    if (oauthConfig.pkce) {
      const pkce = oauthStateService.generatePKCE();
      codeVerifier = pkce.codeVerifier;
      codeChallenge = pkce.codeChallenge;
      logger.debug("PKCE enabled, code challenge generated");
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
    logger.debug("OAuth state stored in Redis");

    // Resolve per-tenant {shop} placeholder (e.g. Shopify) in the authorize URL.
    oauthConfig.authorizationUrl = substituteShopPlaceholder(
      oauthConfig.authorizationUrl,
      resolved.values.shopDomain,
    );

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

    // Merge plugin-declared extra authorize params (e.g. config_id), skipping any
    // reserved security keys so a plugin cannot override them.
    if (oauthConfig.authorizationParams) {
      const reservedParams = new Set([
        "client_id",
        "redirect_uri",
        "response_type",
        "state",
        "scope",
        "optional_scope",
        "code_challenge",
        "code_challenge_method",
      ]);
      for (const [key, value] of Object.entries(oauthConfig.authorizationParams)) {
        if (reservedParams.has(key) || params.has(key)) {
          logger.warn(
            { pluginId, param: key },
            "Skipping reserved/duplicate authorizationParam from plugin",
          );
          continue;
        }
        params.append(key, value);
      }
    }

    // Convert to string and replace + with %20 for proper URL encoding (RFC 3986)
    const authorizationUrl = `${oauthConfig.authorizationUrl}?${params.toString().replace(/\+/g, "%20")}`;

    logger.info({ pluginId }, "OAuth authorization URL generated");

    logger.debug(
      {
        organizationId,
        userId,
        nonce: nonce.substring(0, 8) + "...",
      },
      `Initiated OAuth flow for plugin ${pluginId}`,
    );

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
    logger.info(
      { codeProvided: !!code, stateProvided: !!state, hasError: !!error },
      "OAuth callback received",
    );

    if (error) {
      logger.warn({ error }, "OAuth provider returned error");
      logger.error(`OAuth callback error: ${error}`);
      return { success: false, error };
    }

    // Retrieve state from Redis (one-time use)
    logger.debug("Retrieving OAuth state from Redis");
    const oauthState = await oauthStateService.retrieveState(state);

    if (!oauthState) {
      logger.warn("OAuth state not found in Redis or expired");
      logger.error(`Invalid or expired OAuth state: ${state}`);
      return { success: false, error: "Invalid or expired state" };
    }

    logger.debug(
      {
        pluginId: oauthState.pluginId,
        organizationId: oauthState.organizationId,
        userId: oauthState.userId,
        hasCodeVerifier: !!oauthState.codeVerifier,
      },
      "OAuth state retrieved from Redis",
    );

    const { pluginId, organizationId, codeVerifier } = oauthState;

    try {
      // Get plugin
      logger.debug({ pluginId }, "Loading plugin for OAuth callback");
      const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
      if (!plugin) {
        throw new Error(`Plugin ${pluginId} not found`);
      }

      // Get plugin instance
      const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
      if (!instance) {
        throw new Error(`Plugin ${pluginId} not configured for this organization`);
      }

      // Check metadata.authMethods for OAuth2 registration
      if (!plugin.metadata?.authMethods) {
        throw new Error(`Plugin ${pluginId} does not have metadata`);
      }

      logger.debug("Checking metadata.authMethods for OAuth2");
      const oauth2Method = plugin.metadata.authMethods.find(
        (method: AuthMethodDescriptor) => method.type === "oauth2",
      );

      if (!oauth2Method) {
        throw new Error(`Plugin ${pluginId} does not support OAuth`);
      }

      logger.debug({ methodId: oauth2Method.id }, "OAuth2 method found in metadata");

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

      logger.debug({ tokenUrl: oauthConfig.tokenUrl }, "OAuth token URL resolved");

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
        asCredentialString(resolved.metadata[clientIdFieldName]?.value) ||
        asCredentialString(instance.authState?.credentials?.[clientIdFieldName]);
      const clientSecret =
        asCredentialString(resolved.metadata[clientSecretFieldName]?.value) ||
        asCredentialString(instance.authState?.credentials?.[clientSecretFieldName]);

      if (!clientId) {
        throw new Error("OAuth client ID not configured");
      }

      const validCredentials = {
        clientId,
        clientSecret,
      };

      // Resolve per-tenant {shop} placeholder (e.g. Shopify) in the token URL.
      oauthConfig.tokenUrl = substituteShopPlaceholder(
        oauthConfig.tokenUrl,
        resolved.values.shopDomain,
      );

      logger.info("Exchanging authorization code for tokens");
      // Exchange code for tokens
      const tokens = await this.exchangeCodeForTokens(
        code,
        oauthConfig,
        validCredentials,
        codeVerifier,
      );
      logger.info(
        {
          hasAccessToken: !!tokens.access_token,
          hasRefreshToken: !!tokens.refresh_token,
          expiresIn: tokens.expires_in,
          tokenType: tokens.token_type,
          scope: tokens.scope,
        },
        "Tokens received from provider",
      );

      // Combine required and optional scopes for storage
      const allScopes: string[] = [];
      if (oauthConfig.scopes && oauthConfig.scopes.length > 0) {
        allScopes.push(...oauthConfig.scopes);
      }
      if (oauthConfig.optionalScopes && oauthConfig.optionalScopes.length > 0) {
        allScopes.push(...oauthConfig.optionalScopes);
      }

      // Store tokens in plugin instance config
      logger.debug({ scopes: allScopes }, "Storing tokens in database");
      await this.storeTokens(organizationId, pluginId, tokens, allScopes);
      logger.info("Tokens stored successfully");

      // Run the plugin's optional onConnected lifecycle hook. The plugin (not
      // core) performs any provider call it needs with the fresh credentials and
      // returns opaque routing keys for core to persist. Failures here must NOT
      // fail the OAuth callback — log and continue.
      await this.runOnConnected(organizationId, pluginId);

      logger.debug({ organizationId }, `OAuth callback successful for plugin ${pluginId}`);

      logger.info({ pluginId, organizationId }, "OAuth callback completed successfully");
      return { success: true, pluginId, organizationId };
    } catch (error) {
      logger.error(
        {
          err: error instanceof Error ? error : new Error(String(error)),
          pluginId,
          organizationId,
        },
        "OAuth callback failed",
      );
      logger.error(
        {
          err: error,
          pluginId,
          organizationId,
        },
        `OAuth callback failed`,
      );
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

    logger.debug(
      {
        tokenUrl: oauthConfig.tokenUrl,
        grantType: "authorization_code",
        redirectUri,
        hasClientSecret: !!credentials.clientSecret,
        hasCodeVerifier: !!codeVerifier,
      },
      "Token exchange request",
    );

    const response = await fetch(oauthConfig.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    logger.debug(
      { status: response.status, statusText: response.statusText },
      "Token exchange response received",
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, errorText }, "Token exchange failed");
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    logger.debug(
      {
        hasAccessToken: !!data.access_token,
        hasRefreshToken: !!data.refresh_token,
        expiresIn: data.expires_in,
        tokenType: data.token_type,
      },
      "Token exchange response parsed",
    );

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
    logger.debug({ pluginId, organizationId }, "Storing OAuth tokens");

    const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    logger.debug({ pluginRegistryId: plugin.id }, "Plugin registry entry found");

    // Get or create instance (pass string pluginId, not UUID)
    const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
    logger.debug(
      {
        instanceFound: !!instance,
        instanceId: instance?.id,
        enabled: instance?.enabled,
        authMethod: instance?.authMethod,
        hasConfig: !!instance?.config,
      },
      "Plugin instance lookup result",
    );

    // Build authState - the standard way to store OAuth tokens
    // The authState format is what the plugin SDK expects via ctx.auth.get()
    // NOTE: Do NOT manually encrypt here - use updateAuthState() which uses .save()
    // and triggers the TypeORM AuthStateEncryptedTransformer automatically.
    const authState = {
      methodId: `${pluginId}-oauth`, // Convention: {pluginId}-oauth
      credentials: {
        accessToken: tokens.access_token, // Plain text - transformer will encrypt
        refreshToken: tokens.refresh_token || undefined, // Plain text - transformer will encrypt
        expiresAt: tokens.expires_at,
        connectedAt: Math.floor(Date.now() / 1000),
        tokenType: tokens.token_type || "Bearer",
        scope: tokens.scope || scopes?.join(" "),
      },
    };

    if (instance) {
      logger.debug({ instanceId: instance.id }, "Updating existing instance auth state");

      // Update authState using updateAuthState which uses .save() to trigger transformer
      await pluginInstanceRepository.updateAuthState(
        instance.id,
        instance.organizationId,
        authState,
      );
      logger.debug({ enabled: instance.enabled }, "Auth state updated via updateAuthState");
    } else {
      logger.debug("Creating new instance with enabled=false");
      // Create new instance - upsertInstance uses .save() which triggers transformer
      await pluginInstanceRepository.upsertInstance(organizationId, pluginId, {
        authMethod: "oauth",
        authState,
        enabled: false, // Don't auto-enable
      });
      logger.debug("New plugin instance created");
    }
    logger.info({ pluginId, organizationId }, "OAuth tokens stored successfully");
  }

  /**
   * Run the plugin's optional `onConnected` lifecycle hook and persist any
   * routing keys it returns.
   *
   * Core stays plugin-agnostic: it starts the worker, POSTs the freshly-stored
   * auth state to the worker's `/on-connected` endpoint, and persists whatever
   * opaque strings the plugin returns. Any failure is swallowed (logged) so the
   * OAuth callback always succeeds.
   */
  private async runOnConnected(organizationId: string, pluginId: string): Promise<void> {
    try {
      // Reload the instance to get its id + freshly-stored (decrypted) auth state.
      const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
      if (!instance || !instance.authState) {
        logger.debug(
          { pluginId, organizationId },
          "No instance/authState for onConnected, skipping",
        );
        return;
      }

      const worker = await pluginManagerService.startPluginWorker(organizationId, pluginId);

      const response = await fetch(`http://localhost:${worker.port}/on-connected`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: instance.config ?? {},
          authState: instance.authState,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn(
          { pluginId, organizationId, status: response.status, errorText },
          "onConnected hook returned non-OK status, skipping route persistence",
        );
        return;
      }

      const result = (await response.json()) as { routingKeys?: unknown };
      const routingKeys = Array.isArray(result?.routingKeys)
        ? result.routingKeys.filter((k): k is string => typeof k === "string" && k.length > 0)
        : [];

      if (routingKeys.length === 0) {
        logger.debug({ pluginId, organizationId }, "onConnected returned no routing keys");
        return;
      }

      await pluginWebhookRouteRepository.upsertRoutes(
        pluginId,
        organizationId,
        instance.id,
        routingKeys,
      );

      logger.info(
        { pluginId, organizationId, routingKeyCount: routingKeys.length },
        "Persisted routing keys from onConnected hook",
      );
    } catch (error) {
      logger.warn(
        {
          err: error instanceof Error ? error : new Error(String(error)),
          pluginId,
          organizationId,
        },
        "onConnected hook failed; continuing OAuth callback without routing keys",
      );
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

    const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
    if (!instance) {
      throw new Error(`Plugin instance not found`);
    }

    // Clear authState + authMethod. Must use an explicit NULL clear: TypeORM's
    // .update() ignores `undefined`, so the previous code was a silent no-op and
    // the connection never actually disconnected.
    await pluginInstanceRepository.clearAuthState(instance.id, organizationId);

    logger.debug({ organizationId }, `OAuth revoked for plugin ${pluginId}`);
  }

  /**
   * Get OAuth connection status
   * Reads from authState (the standard storage location)
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
    if (!instance || !instance.authState?.credentials) {
      return { connected: false };
    }

    try {
      // authState is automatically decrypted by TypeORM transformer
      const credentials = instance.authState.credentials;

      if (!credentials.accessToken) {
        return { connected: false };
      }

      return {
        connected: true,
        expiresAt: credentials.expiresAt as number | undefined,
        connectedAt: credentials.connectedAt as number | undefined,
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
    if (!instance) {
      throw new Error("Plugin instance not found");
    }

    // Check for OAuth credentials in authState
    if (!instance.authState?.credentials?.refreshToken) {
      throw new Error("OAuth not configured for this plugin instance");
    }

    // Check metadata.authMethods for OAuth2 registration
    if (!plugin.metadata?.authMethods) {
      throw new Error(`Plugin ${pluginId} does not have metadata`);
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

    // Get refresh token from authState (already decrypted by TypeORM transformer)
    const refreshToken = instance.authState.credentials.refreshToken as string;
    const oldScope = instance.authState.credentials.scope;

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
      asCredentialString(resolved.metadata[clientIdFieldName]?.value) ||
      asCredentialString(instance.authState?.credentials?.[clientIdFieldName]);
    const clientSecret =
      asCredentialString(resolved.metadata[clientSecretFieldName]?.value) ||
      asCredentialString(instance.authState?.credentials?.[clientSecretFieldName]);

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
      refresh_token: data.refresh_token || refreshToken, // Keep old if not provided
      expires_in: data.expires_in,
      expires_at: expiresAt,
      token_type: data.token_type || "Bearer",
      scope: data.scope || oldScope,
    };

    // Update authState with refreshed tokens
    // NOTE: Do NOT manually encrypt - use updateAuthState() which uses .save()
    // and triggers the TypeORM AuthStateEncryptedTransformer automatically.
    const authState = {
      methodId: `${pluginId}-oauth`,
      credentials: {
        accessToken: newTokens.access_token, // Plain text - transformer will encrypt
        refreshToken: newTokens.refresh_token || undefined, // Plain text - transformer will encrypt
        expiresAt: newTokens.expires_at,
        tokenType: newTokens.token_type || "Bearer",
        scope: newTokens.scope,
      },
    };

    await pluginInstanceRepository.updateAuthState(instance.id, instance.organizationId, authState);

    logger.debug({ organizationId }, `Token refreshed for plugin ${pluginId}`);

    return newTokens;
  }
}

export const oauthService = new OAuthService();
