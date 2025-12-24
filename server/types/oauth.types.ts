/**
 * OAuth types and interfaces for plugin authentication
 */

export interface OAuthTokenData {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number; // Unix timestamp
  token_type?: string;
  scope?: string;
}

export interface OAuthConfig {
  _oauth: {
    tokens: OAuthTokenData;
    connected_at: number; // Unix timestamp
    provider: string; // Plugin ID
    scopes?: string[];
  };
}

export interface OAuthState {
  pluginId: string;
  organizationId: string;
  userId: string;
  nonce: string;
  codeVerifier?: string; // For PKCE
  createdAt: number; // Unix timestamp
}

export interface OAuthManifestConfig {
  authorizationUrl: string;
  tokenUrl: string;
  scopes?: string[]; // Required scopes
  optionalScopes?: string[]; // Optional scopes (sent as 'optional_scope' parameter)
  pkce?: boolean;
  clientIdEnvVar?: string; // Defaults to {PLUGIN_ID}_OAUTH_CLIENT_ID
  clientSecretEnvVar?: string; // Defaults to {PLUGIN_ID}_OAUTH_CLIENT_SECRET (optional for CIMD)
}

export interface OAuthConnectionStatus {
  connected: boolean;
  expiresAt?: number;
  connectedAt?: number;
  error?: string;
}

/**
 * Plugin config that may contain OAuth data
 * Use this when you need to check for _oauth in decrypted config
 */
export interface PluginConfigWithOAuth extends Record<string, unknown> {
  _oauth?: {
    tokens: OAuthTokenData;
    connected_at: number;
    provider: string;
    scopes?: string[];
  };
}

/**
 * Type guard to check if config contains OAuth data
 * @param config - Decrypted plugin configuration
 * @returns True if config contains valid OAuth data
 */
export function hasOAuthData(
  config: Record<string, unknown>,
): config is PluginConfigWithOAuth & { _oauth: NonNullable<PluginConfigWithOAuth["_oauth"]> } {
  return (
    typeof config === "object" &&
    config !== null &&
    "_oauth" in config &&
    typeof config._oauth === "object" &&
    config._oauth !== null &&
    "tokens" in config._oauth
  );
}
