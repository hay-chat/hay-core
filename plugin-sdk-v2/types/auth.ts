/**
 * Hay Plugin SDK v2 - Auth System Types
 *
 * Types for plugin authentication including registration and runtime APIs.
 *
 * @module @hay/plugin-sdk-v2/types/auth
 */

import type { ConfigFieldReference } from './config';

/**
 * API Key authentication options.
 *
 * Configuration for API key-based authentication.
 *
 * @remarks
 * API key auth is the simplest form - just a single field (typically a secret key or token).
 * The `configField` must reference a field defined in `register.config()`.
 *
 * @example
 * ```typescript
 * register.config({
 *   apiKey: {
 *     type: 'string',
 *     required: true,
 *     sensitive: true,
 *     env: 'STRIPE_API_KEY',
 *   },
 * });
 *
 * register.auth.apiKey({
 *   id: 'apiKey',
 *   label: 'API Key',
 *   configField: 'apiKey',
 * });
 * ```
 *
 * @see PLUGIN.md Section 5.2.4 (lines 422-434)
 */
export interface ApiKeyAuthOptions {
  /**
   * Unique identifier for this auth method.
   *
   * @remarks
   * Used in `AuthState.methodId` to identify which method is active.
   *
   * @example "apiKey", "token", "secretKey"
   */
  id: string;

  /**
   * Human-readable label for UI.
   *
   * @example "API Key", "Secret Token"
   */
  label: string;

  /**
   * Name of the config field that holds the API key.
   *
   * @remarks
   * Must reference a field defined in `register.config()`.
   */
  configField: string;
}

/**
 * OAuth 2.0 authentication options.
 *
 * Configuration for OAuth 2.0-based authentication.
 *
 * @remarks
 * OAuth2 auth requires:
 * - Authorization and token URLs
 * - Client ID and secret (as config field references)
 * - Optional scopes
 *
 * The platform handles the OAuth flow and stores the resulting tokens.
 *
 * @example
 * ```typescript
 * register.config({
 *   clientId: {
 *     type: 'string',
 *     required: true,
 *     env: 'SHOPIFY_CLIENT_ID',
 *   },
 *   clientSecret: {
 *     type: 'string',
 *     required: true,
 *     sensitive: true,
 *     env: 'SHOPIFY_CLIENT_SECRET',
 *   },
 * });
 *
 * register.auth.oauth2({
 *   id: 'oauth',
 *   label: 'OAuth 2.0',
 *   authorizationUrl: 'https://accounts.shopify.com/oauth/authorize',
 *   tokenUrl: 'https://accounts.shopify.com/oauth/token',
 *   scopes: ['read_orders', 'write_products'],
 *   clientId: config.field('clientId'),
 *   clientSecret: config.field('clientSecret'),
 * });
 * ```
 *
 * @see PLUGIN.md Section 5.2.4 (lines 436-449)
 */
export interface OAuth2AuthOptions {
  /**
   * Unique identifier for this auth method.
   *
   * @example "oauth", "oauth2"
   */
  id: string;

  /**
   * Human-readable label for UI.
   *
   * @example "OAuth 2.0", "Connect with Shopify"
   */
  label: string;

  /**
   * OAuth authorization URL.
   *
   * @example "https://accounts.shopify.com/oauth/authorize"
   */
  authorizationUrl: string;

  /**
   * OAuth token URL.
   *
   * @example "https://accounts.shopify.com/oauth/token"
   */
  tokenUrl: string;

  /**
   * OAuth scopes (optional).
   *
   * @example ["read_orders", "write_products"]
   */
  scopes?: string[];

  /**
   * Reference to config field holding OAuth client ID.
   *
   * @remarks
   * Create using `config.field('clientId')` in onInitialize.
   */
  clientId: ConfigFieldReference;

  /**
   * Reference to config field holding OAuth client secret.
   *
   * @remarks
   * Create using `config.field('clientSecret')` in onInitialize.
   */
  clientSecret: ConfigFieldReference;

  // Future: PKCE, redirect paths, custom parameters, etc.
}

/**
 * Auth registration API.
 *
 * Used in `onInitialize` to register supported authentication methods.
 *
 * @remarks
 * Plugins can register multiple auth methods (e.g., both API key and OAuth).
 * Users choose which method to use in the dashboard UI.
 *
 * @example
 * ```typescript
 * register.auth.apiKey({
 *   id: 'apiKey',
 *   label: 'API Key',
 *   configField: 'apiKey',
 * });
 *
 * register.auth.oauth2({
 *   id: 'oauth',
 *   label: 'OAuth 2.0',
 *   authorizationUrl: '...',
 *   tokenUrl: '...',
 *   clientId: config.field('clientId'),
 *   clientSecret: config.field('clientSecret'),
 * });
 * ```
 *
 * @see PLUGIN.md Section 5.2.4 (lines 422-449)
 */
export interface RegisterAuthAPI {
  /**
   * Register API key authentication method.
   *
   * @param options - API key auth configuration
   */
  apiKey(options: ApiKeyAuthOptions): void;

  /**
   * Register OAuth 2.0 authentication method.
   *
   * @param options - OAuth2 auth configuration
   */
  oauth2(options: OAuth2AuthOptions): void;

  // Future: custom(), jwt(), basic(), etc.
}

/**
 * Authentication state.
 *
 * Represents the resolved authentication for an organization.
 * Contains the selected auth method and credentials.
 *
 * @remarks
 * Retrieved via `auth.get()` in org runtime hooks.
 * The `methodId` corresponds to the `id` used when registering auth methods.
 *
 * **Credentials structure** depends on auth method:
 * - API Key: `{ apiKey: "sk_live_..." }`
 * - OAuth2: `{ accessToken: "...", refreshToken: "...", expiresAt: ... }`
 *
 * @example
 * ```typescript
 * const authState = ctx.auth.get();
 * if (!authState) {
 *   logger.warn('No auth configured');
 *   return;
 * }
 *
 * const { methodId, credentials } = authState;
 *
 * if (methodId === 'apiKey') {
 *   const apiKey = String(credentials.apiKey);
 *   // Use API key...
 * } else if (methodId === 'oauth') {
 *   const accessToken = String(credentials.accessToken);
 *   // Use OAuth token...
 * }
 * ```
 *
 * @see PLUGIN.md Section 5.3.3 (lines 505-521)
 */
export interface AuthState {
  /**
   * ID of the active auth method.
   *
   * @remarks
   * Corresponds to the `id` used when registering the auth method
   * (e.g., "apiKey", "oauth").
   */
  methodId: string;

  /**
   * Auth credentials.
   *
   * @remarks
   * Structure depends on the auth method:
   * - API Key: `{ apiKey: string }`
   * - OAuth2: `{ accessToken: string, refreshToken?: string, expiresAt?: number }`
   *
   * Use type assertions or runtime checks to access specific fields.
   */
  credentials: Record<string, unknown>;
}

/**
 * Auth runtime API.
 *
 * Used in org runtime hooks to access authentication state for the current organization.
 *
 * @remarks
 * **Constraint**: Only available in org runtime contexts (onStart, onValidateAuth, etc.).
 * NOT available in `onInitialize`.
 *
 * @see PLUGIN.md Section 5.3.3 (lines 505-521)
 */
export interface HayAuthRuntimeAPI {
  /**
   * Get resolved auth state for the current organization.
   *
   * Returns `null` if no auth is configured.
   *
   * @returns Auth state or null
   *
   * @example
   * ```typescript
   * const authState = ctx.auth.get();
   * if (!authState) {
   *   logger.warn('Plugin started without auth');
   *   return;
   * }
   *
   * const { methodId, credentials } = authState;
   * // Use credentials...
   * ```
   */
  get(): AuthState | null;
}
