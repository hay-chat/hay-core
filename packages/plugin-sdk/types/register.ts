/**
 * Hay Plugin SDK - Register API Types
 *
 * Types for the registration API used in onInitialize.
 *
 * @module @hay/plugin-sdk/types/register
 */

import type { ConfigFieldDescriptor } from "./config";
import type { RegisterAuthAPI } from "./auth";
import type { HttpMethod, RouteHandler } from "./route";
import type { PluginPage } from "./ui";

/**
 * UI registration API.
 *
 * Provides methods for registering plugin UI components.
 */
export interface UIRegistrationAPI {
  /**
   * Register a plugin page with metadata.
   *
   * Plugin pages are Vue components built into bundles and loaded dynamically
   * by the dashboard. They can be rendered in specific slots (before/after settings)
   * or as standalone pages (future enhancement).
   *
   * @param page - Plugin page descriptor
   *
   * @example
   * ```typescript
   * register.ui.page({
   *   id: 'setup-guide',
   *   title: 'Setup Guide',
   *   component: './components/settings/AfterSettings.vue',
   *   slot: 'after-settings',
   *   icon: 'book',
   * });
   * ```
   */
  page(page: PluginPage): void;
}

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
 *   // Register UI extension (legacy)
 *   register.ui({
 *     slot: 'after-settings',
 *     component: 'components/Settings.vue',
 *   });
 *
 *   // Register UI page (new)
 *   register.ui.page({
 *     id: 'setup-guide',
 *     title: 'Setup Guide',
 *     component: './components/settings/AfterSettings.vue',
 *     slot: 'after-settings',
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
   * UI registration API.
   *
   * Used to register plugin UI components and pages.
   *
   * @example
   * ```typescript
   * register.ui.page({
   *   id: 'setup-guide',
   *   title: 'Setup Guide',
   *   component: './components/settings/AfterSettings.vue',
   *   slot: 'after-settings',
   * });
   * ```
   */
  ui: UIRegistrationAPI;

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
