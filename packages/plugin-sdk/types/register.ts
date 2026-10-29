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
import type { CronJobOptions } from "./cron";
import type { WebhookRoutingDescriptor } from "./webhook-routing";
import type { RegisterWebchatAPI } from "./webchat";
import type { SetupOptions } from "./setup";

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
 * - UI pages
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
 *   // Register UI page
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

  /**
   * Register a background cron job.
   *
   * The job is scheduled by Hay Core (not inside the worker, which is idle-killed).
   * When it fires, Core wakes this org's worker and invokes the handler with a
   * fresh org-scoped context. Use it for platform quirks like periodic token
   * refresh, data sync, or cleanup.
   *
   * @param options - Cron job name, schedule, handler, and optional retry policy
   *
   * @example
   * ```typescript
   * register.cron({
   *   name: 'refresh_shopify_token',
   *   schedule: '0 *​/20 * * *', // every 20 hours
   *   handler: async (ctx) => {
   *     const token = await refresh(ctx.config.get('clientId'), ctx.config.get('clientSecret'));
   *     ctx.auth.update({ accessToken: token.accessToken, expiresAt: token.expiresAt });
   *   },
   *   retryPolicy: { maxRetries: 3, backoff: 'exponential' },
   * });
   * ```
   */
  cron(options: CronJobOptions): void;

  /**
   * Declare a generic webhook routing strategy for a shared webhook URL.
   *
   * Some providers deliver every org's events to a SINGLE shared webhook URL
   * with no org identifier. This declaration tells Hay Core — as plain data —
   * how to verify the request signature, answer the verification handshake, and
   * extract per-event routing keys. Core executes the strategy blindly and fans
   * the single webhook out to the right per-org workers; it never learns which
   * provider this is.
   *
   * @param descriptor - Webhook routing descriptor
   *
   * @example
   * ```typescript
   * register.webhookRouting({
   *   signature: {
   *     header: 'x-hub-signature-256',
   *     format: 'sha256-hmac',
   *     secretEnv: 'META_APP_SECRET',
   *   },
   *   verificationChallenge: {
   *     modeParam: 'hub.mode',
   *     verifyTokenParam: 'hub.verify_token',
   *     challengeParam: 'hub.challenge',
   *     verifyTokenEnv: 'META_VERIFY_TOKEN',
   *   },
   *   routeKeyPath: { itemsPath: 'entry', keyPath: 'id' },
   * });
   * ```
   *
   * @example Nested routing — each sub-item carries its own key (WhatsApp
   * phone numbers under a WABA). Sub-items are filtered per org; sub-items
   * without a nested key fall back to the item-level owner, and sub-items
   * with an unknown nested key are dropped.
   * ```typescript
   * register.webhookRouting({
   *   // ...signature / verificationChallenge as above
   *   routeKeyPath: {
   *     itemsPath: 'entry',
   *     keyPath: 'id',
   *     nested: { itemsPath: 'changes', keyPath: 'value.metadata.phone_number_id' },
   *   },
   * });
   * ```
   */
  webhookRouting(descriptor: WebhookRoutingDescriptor): void;

  /**
   * Webchat extension API: declarative widget contributions (fixed versioned
   * types like `challenge@1`) and synchronous server-side gates for widget
   * actions. The widget never runs plugin code. Requires the `webchat`
   * capability in the manifest.
   */
  webchat: RegisterWebchatAPI;

  /**
   * Declare the setup checklist core shows on the plugin's Setup tab, and
   * optionally report the plugin's own status (`POST /setup/status`).
   * Each step needs `setupSteps.<id>.title` in `i18n/en.json` and `i18n/pt-BR.json`.
   *
   * @example
   * ```typescript
   * register.setup({
   *   steps: [
   *     { id: 'store', kind: 'fields', fields: ['shopDomain'] },
   *     { id: 'connect', kind: 'connect' },
   *     { id: 'notify', kind: 'fields', fields: ['recipients'], optional: true },
   *   ],
   *   async status({ auth, config }) {
   *     const connected = !!auth.get();
   *     return {
   *       state: connected ? 'connected' : 'needs_action',
   *       account: config.getOptional<string>('shopDomain'),
   *       steps: { connect: { done: connected } },
   *     };
   *   },
   * });
   * ```
   */
  setup(options: SetupOptions): void;

  // Future: mcp descriptor registration (optional)
  // mcp?: RegisterMcpDescriptorAPI;
}
