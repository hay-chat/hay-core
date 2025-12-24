/**
 * Hay Plugin SDK v2 - Register API Types
 *
 * Types for the registration API used in onInitialize.
 *
 * @module @hay/plugin-sdk-v2/types/register
 */

import type { ConfigFieldDescriptor } from './config';
import type { RegisterAuthAPI } from './auth';
import type { HttpMethod, RouteHandler } from './route';
import type { UIExtensionDescriptor } from './ui';

/**
 * Register API for global context.
 *
 * Used in `onInitialize` to register plugin capabilities:
 * - Config schema
 * - Auth methods
 * - HTTP routes
 * - UI extensions
 *
 * @remarks
 * All registration happens during `onInitialize`, before the HTTP server starts.
 * Registered metadata is exposed via the `/metadata` endpoint.
 *
 * **Important**: This is a descriptor API - you're declaring what the plugin supports,
 * not performing runtime operations.
 *
 * @example
 * ```typescript
 * onInitialize() {
 *   const { register, config, logger } = globalCtx;
 *
 *   // Register config schema
 *   register.config({
 *     apiKey: {
 *       type: 'string',
 *       required: true,
 *       encrypted: true,
 *       env: 'STRIPE_API_KEY',
 *     },
 *   });
 *
 *   // Register auth method
 *   register.auth.apiKey({
 *     id: 'apiKey',
 *     label: 'API Key',
 *     configField: 'apiKey',
 *   });
 *
 *   // Register HTTP route
 *   register.route('POST', '/webhook', async (req, res) => {
 *     logger.info('Webhook received');
 *     res.status(200).json({ ok: true });
 *   });
 *
 *   // Register UI extension
 *   register.ui({
 *     slot: 'after-settings',
 *     component: 'components/Settings.vue',
 *   });
 * }
 * ```
 *
 * @see PLUGIN.md Section 5.2.1 (lines 360-383)
 */
export interface HayRegisterAPI {
  /**
   * Register an HTTP route.
   *
   * Routes are mounted on the plugin's HTTP server (internal only).
   * Common use cases:
   * - Webhooks from external services
   * - OAuth callbacks
   * - Health checks
   *
   * @param method - HTTP method (GET, POST, PUT, PATCH, DELETE)
   * @param path - Route path (e.g., "/webhook", "/oauth/callback")
   * @param handler - Express-compatible route handler
   *
   * @example
   * ```typescript
   * register.route('POST', '/webhook', async (req, res) => {
   *   const signature = req.headers['x-webhook-signature'];
   *   const payload = req.body;
   *
   *   // Verify and process webhook...
   *
   *   res.status(200).json({ received: true });
   * });
   * ```
   */
  route(method: HttpMethod, path: string, handler: RouteHandler): void;

  /**
   * Register config schema.
   *
   * Defines configuration fields for this plugin.
   * The schema is used to:
   * - Generate settings UI in dashboard
   * - Validate config values
   * - Enable env var fallback
   *
   * @param schema - Config field descriptors keyed by field name
   *
   * @example
   * ```typescript
   * register.config({
   *   apiKey: {
   *     type: 'string',
   *     required: false,
   *     env: 'SHOPIFY_API_KEY',
   *     encrypted: true,
   *     label: 'API Key',
   *     description: 'Your Shopify API key',
   *   },
   *   storeUrl: {
   *     type: 'string',
   *     required: true,
   *     label: 'Store URL',
   *     description: 'Your Shopify store URL (e.g., mystore.myshopify.com)',
   *   },
   *   maxRetries: {
   *     type: 'number',
   *     default: 3,
   *     label: 'Max Retries',
   *   },
   * });
   * ```
   */
  config(schema: Record<string, ConfigFieldDescriptor>): void;

  /**
   * Register a UI extension.
   *
   * UI extensions allow plugins to add custom Vue components to the dashboard.
   *
   * @param extension - UI extension descriptor
   *
   * @example
   * ```typescript
   * register.ui({
   *   slot: 'after-settings',
   *   component: 'components/AdvancedSettings.vue',
   * });
   * ```
   */
  ui(extension: UIExtensionDescriptor): void;

  /**
   * Auth registration API.
   *
   * Used to register supported authentication methods (API key, OAuth2, etc.).
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
   *   authorizationUrl: 'https://...',
   *   tokenUrl: 'https://...',
   *   clientId: config.field('clientId'),
   *   clientSecret: config.field('clientSecret'),
   * });
   * ```
   */
  auth: RegisterAuthAPI;

  // Future: mcp descriptor registration (optional)
  // mcp?: RegisterMcpDescriptorAPI;
}
