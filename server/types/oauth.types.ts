/**
 * OAuth 2.0/2.1 Types for Plugin Authentication
 */

/**
 * OAuth tokens stored in plugin_instances.config._oauth
 */
export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  token_type: string; // Usually "Bearer"
  expires_in?: number; // Seconds until expiration
  expires_at?: number; // Unix timestamp when token expires
  scope?: string; // Space-separated scopes
}

/**
 * OAuth configuration from plugin manifest
 */
export interface OAuthConfig {
  authorizationUrl: string; // Provider's authorization endpoint
  tokenUrl: string; // Provider's token endpoint
  scopes: string[]; // Required OAuth scopes
  usePKCE?: boolean; // Whether to use PKCE (default: true for OAuth 2.1)
  pkceMethod?: "S256" | "plain"; // PKCE code challenge method (default: S256)
}

/**
 * OAuth state stored in Redis during authorization flow
 * TTL: 10 minutes
 */
export interface OAuthState {
  nonce: string; // Random state parameter for CSRF protection
  pluginId: string; // Which plugin is being authorized
  organizationId: string; // Which organization is authorizing
  userId: string; // Which user initiated the flow
  codeVerifier?: string; // PKCE code verifier (if usePKCE is true)
  createdAt: number; // Unix timestamp
}

/**
 * OAuth callback query parameters
 */
export interface OAuthCallbackParams {
  code?: string; // Authorization code (success)
  state: string; // State parameter (CSRF token)
  error?: string; // Error code (if authorization failed)
  error_description?: string; // Human-readable error description
}

/**
 * OAuth authorization initiation response
 */
export interface OAuthAuthorizationUrl {
  url: string; // Full authorization URL to redirect user to
  state: string; // State parameter (for verification)
}

/**
 * OAuth token exchange request
 */
export interface OAuthTokenRequest {
  grant_type: "authorization_code" | "refresh_token";
  code?: string; // Authorization code (for authorization_code grant)
  refresh_token?: string; // Refresh token (for refresh_token grant)
  redirect_uri: string; // Must match the one used in authorization
  client_id: string; // OAuth app client ID
  client_secret: string; // OAuth app client secret
  code_verifier?: string; // PKCE code verifier (if usePKCE is true)
}

/**
 * OAuth token refresh result
 */
export interface OAuthRefreshResult {
  success: boolean;
  tokens?: OAuthTokens;
  error?: string;
}

/**
 * OAuth connection status
 */
export interface OAuthConnectionStatus {
  connected: boolean;
  expiresAt?: number; // Unix timestamp
  expiresIn?: number; // Seconds remaining
  scopes?: string[];
  error?: string;
}
