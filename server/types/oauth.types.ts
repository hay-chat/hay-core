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


