/**
 * Plugin SDK v2 Utilities
 *
 * Helper functions for config/auth separation and validation
 */

import type { PluginMetadata, AuthState } from "../types/plugin-sdk-v2.types";

/**
 * Separate configuration into auth and non-auth fields
 *
 * SDK v2 plugins declare auth methods via metadata.authMethods.
 * This function identifies auth-related fields and separates them from regular config.
 *
 * @param input User-provided configuration from UI
 * @param metadata Plugin metadata from /metadata endpoint
 * @returns Separated config and authState
 */
export function separateConfigAndAuth(
  input: Record<string, any>,
  metadata: PluginMetadata | null | undefined
): {
  config: Record<string, any>;
  authState: AuthState | null;
} {
  // If no metadata, treat everything as config (fallback for legacy plugins)
  if (!metadata || !metadata.authMethods || metadata.authMethods.length === 0) {
    return {
      config: input,
      authState: null
    };
  }

  // Identify auth fields from metadata
  const authFieldNames = new Set<string>();
  let primaryAuthMethod: string | null = null;

  for (const method of metadata.authMethods) {
    if (method.type === "apiKey" && method.configField) {
      // API Key auth: configField points to the auth field
      authFieldNames.add(method.configField);
      if (!primaryAuthMethod) {
        primaryAuthMethod = method.id;
      }
    } else if (method.type === "oauth2") {
      // OAuth2: credentials come from OAuth flow, not direct config
      // Mark common OAuth field names if they exist in config
      authFieldNames.add("accessToken");
      authFieldNames.add("refreshToken");
      authFieldNames.add("expiresAt");
      if (!primaryAuthMethod) {
        primaryAuthMethod = method.id;
      }
    }
  }

  // Also check configSchema for encrypted fields
  if (metadata.configSchema) {
    for (const [key, schema] of Object.entries(metadata.configSchema)) {
      if (schema.encrypted) {
        authFieldNames.add(key);
      }
    }
  }

  // Separate into auth and config
  const config: Record<string, any> = {};
  const credentials: Record<string, any> = {};

  for (const [key, value] of Object.entries(input)) {
    if (authFieldNames.has(key)) {
      credentials[key] = value;
    } else {
      config[key] = value;
    }
  }

  // Build authState if we have credentials
  let authState: AuthState | null = null;
  if (Object.keys(credentials).length > 0 && primaryAuthMethod) {
    authState = {
      methodId: primaryAuthMethod,
      credentials
    };
  }

  return { config, authState };
}

/**
 * Check if auth-related fields have changed in the input
 *
 * @param input New configuration
 * @param metadata Plugin metadata
 * @returns True if auth fields are present in input
 */
export function hasAuthChanges(
  input: Record<string, any>,
  metadata: PluginMetadata | null | undefined
): boolean {
  if (!metadata || !metadata.authMethods) {
    return false;
  }

  // For OAuth2 plugins, only validate when OAuth tokens are present
  // Don't validate when just saving clientId/clientSecret config
  const hasOAuth2 = metadata.authMethods.some(m => m.type === "oauth2");
  if (hasOAuth2) {
    // Only check for OAuth tokens (from OAuth flow)
    if (input.accessToken !== undefined || input.refreshToken !== undefined) {
      return true;
    }
    // Don't validate for encrypted config fields like clientSecret
    return false;
  }

  // For API Key auth, check if API key field is present
  for (const method of metadata.authMethods) {
    if (method.type === "apiKey" && method.configField) {
      if (input[method.configField] !== undefined) {
        return true;
      }
    }
  }

  // Check for encrypted fields in configSchema (non-OAuth plugins)
  if (metadata.configSchema) {
    for (const [key, schema] of Object.entries(metadata.configSchema)) {
      if (schema.encrypted && input[key] !== undefined) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Extract auth state from separated input
 *
 * @param input User-provided configuration
 * @param metadata Plugin metadata
 * @returns Auth state or null
 */
export function extractAuthState(
  input: Record<string, any>,
  metadata: PluginMetadata | null | undefined
): AuthState | null {
  const { authState } = separateConfigAndAuth(input, metadata);
  return authState;
}
