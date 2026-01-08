/**
 * Hay Plugin SDK - Context Type Implementations
 *
 * Full implementations of context types used in plugin hooks.
 *
 * @module @hay/plugin-sdk/types/contexts
 */

import type { HayRegisterAPI } from './register';
import type { HayConfigDescriptorAPI, HayConfigRuntimeAPI } from './config';
import type { HayAuthRuntimeAPI } from './auth';
import type { HayMcpRuntimeAPI } from './mcp';
import type { HayLogger } from './logger';
import type { HayOrg } from './org';

/**
 * Global context provided to onInitialize hook.
 *
 * Available during the global initialization phase, before any organization-specific
 * runtime begins.
 *
 * @remarks
 * Use this context to declare static, non-org-specific aspects of the plugin:
 * - Config schema (field definitions)
 * - Auth methods supported (API key, OAuth, etc.)
 * - UI extensions (settings panels, etc.)
 * - HTTP routes (webhooks, callbacks)
 *
 * **Restrictions**:
 * - No access to org config values (use `config.field()` for references only)
 * - No access to auth credentials
 * - Must not perform tenant-specific work
 * - Only use descriptor APIs (`register.*`, `config.field()`)
 *
 * @example
 * ```typescript
 * onInitialize(ctx: HayGlobalContext) {
 *   const { register, config, logger } = ctx;
 *
 *   register.config({
 *     apiKey: {
 *       type: 'string',
 *       required: true,
 *       env: 'STRIPE_API_KEY',
 *       encrypted: true,
 *     },
 *   });
 *
 *   register.auth.apiKey({
 *     id: 'apiKey',
 *     label: 'API Key',
 *     configField: 'apiKey',
 *   });
 *
 *   register.route('POST', '/webhook', async (req, res) => {
 *     logger.info('Webhook received');
 *     res.json({ ok: true });
 *   });
 * }
 * ```
 *
 * @see PLUGIN.md Section 5.2 (lines 350-449)
 */
export interface HayGlobalContext {
  /**
   * Registration API for declaring plugin capabilities.
   *
   * Used to register:
   * - Config schema
   * - Auth methods
   * - HTTP routes
   * - UI extensions
   */
  register: HayRegisterAPI;

  /**
   * Config descriptor API.
   *
   * Used to create field references for declarative contexts
   * (e.g., OAuth options that reference config fields).
   *
   * **Note**: This is NOT for reading config values.
   * Use `HayConfigRuntimeAPI.get()` in runtime hooks for that.
   */
  config: HayConfigDescriptorAPI;

  /**
   * Logger for plugin messages.
   *
   * Logs are automatically tagged with plugin context.
   */
  logger: HayLogger;
}

/**
 * Runtime context provided to onStart hook.
 *
 * Available during organization runtime, after the plugin has been initialized
 * and configured for a specific org.
 *
 * @remarks
 * Use this context to wire the plugin into org-specific resources:
 * - Read config values (`config.get()`)
 * - Read auth credentials (`auth.get()`)
 * - Start local MCP servers (`mcp.startLocal()`)
 * - Connect to external MCP servers (`mcp.startExternal()`)
 * - Run lightweight initialization logic
 *
 * **Hook behavior**:
 * - If something fails (e.g., MCP fails to start), plugin stays installed
 *   but may be marked as "degraded" in UI
 * - `onStart` must NOT crash the worker; errors should be logged via `logger`
 *
 * @example
 * ```typescript
 * async onStart(ctx: HayStartContext) {
 *   const { org, config, auth, mcp, logger } = ctx;
 *
 *   logger.info(`Starting plugin for org: ${org.id}`);
 *
 *   const authState = auth.get();
 *   if (!authState) {
 *     logger.warn('No auth configured');
 *     return;
 *   }
 *
 *   const apiKey = String(authState.credentials.apiKey);
 *
 *   await mcp.startLocal('stripe-mcp', () => {
 *     return new StripeMcpServer({ apiKey, logger });
 *   });
 *
 *   logger.info('Stripe MCP server started');
 * }
 * ```
 *
 * @see PLUGIN.md Section 5.3 (lines 453-577)
 */
export interface HayStartContext {
  /**
   * Organization information.
   *
   * Contains org ID and optional name.
   */
  org: HayOrg;

  /**
   * Config runtime API.
   *
   * Used to read configuration values for this organization.
   * Supports org config → env var fallback.
   */
  config: HayConfigRuntimeAPI;

  /**
   * Auth runtime API.
   *
   * Used to read authentication credentials for this organization.
   * Returns `null` if no auth is configured.
   */
  auth: HayAuthRuntimeAPI;

  /**
   * MCP runtime API.
   *
   * Used to start local or external MCP servers for this organization.
   */
  mcp: HayMcpRuntimeAPI;

  /**
   * Logger for plugin messages.
   *
   * Logs are automatically tagged with org and plugin context.
   */
  logger: HayLogger;
}

/**
 * Context provided to onValidateAuth hook.
 *
 * Used to validate authentication credentials for an organization.
 *
 * @remarks
 * Called when auth-related settings are saved or updated.
 * Plugin should verify credentials and return `true` if valid, `false` otherwise.
 *
 * **Common validation approaches**:
 * - API Key: Call a "ping" or "verify" endpoint
 * - OAuth: Call a "me" or "profile" endpoint with the access token
 *
 * @example
 * ```typescript
 * async onValidateAuth(ctx: HayAuthValidationContext) {
 *   const { org, config, auth, logger } = ctx;
 *
 *   const authState = auth.get();
 *   if (!authState) return false;
 *
 *   const { methodId, credentials } = authState;
 *
 *   try {
 *     if (methodId === 'apiKey') {
 *       const apiKey = String(credentials.apiKey);
 *       const client = new StripeClient(apiKey);
 *       const isValid = await client.verify();
 *       return isValid;
 *     }
 *
 *     logger.warn(`Unknown auth method: ${methodId}`);
 *     return false;
 *   } catch (err) {
 *     logger.error('Auth validation failed', err);
 *     return false;
 *   }
 * }
 * ```
 *
 * @see PLUGIN.md Section 5.4 (lines 580-589)
 */
export interface HayAuthValidationContext {
  /**
   * Organization information.
   */
  org: HayOrg;

  /**
   * Config runtime API.
   *
   * Access to org configuration values.
   */
  config: HayConfigRuntimeAPI;

  /**
   * Auth runtime API.
   *
   * Access to auth credentials being validated.
   */
  auth: HayAuthRuntimeAPI;

  /**
   * Logger for validation messages.
   */
  logger: HayLogger;
}

/**
 * Context provided to onConfigUpdate hook.
 *
 * Notifies plugin of configuration changes.
 *
 * @remarks
 * **Optional hook** - most plugins can ignore this and handle config changes in `onStart`.
 * Use this only if plugin needs to react to config updates beyond what's in `onStart`.
 *
 * Called after settings are saved but before/around restart of `onStart`.
 *
 * @example
 * ```typescript
 * onConfigUpdate(ctx: HayConfigUpdateContext) {
 *   const { org, config, logger } = ctx;
 *   logger.info(`Config updated for org: ${org.id}`);
 *   // Platform will restart plugin if needed
 * }
 * ```
 *
 * @see PLUGIN.md Section 5.5 (lines 593-601)
 */
export interface HayConfigUpdateContext {
  /**
   * Organization information.
   */
  org: HayOrg;

  /**
   * Config runtime API with new config values.
   */
  config: HayConfigRuntimeAPI;

  /**
   * Logger for config update messages.
   */
  logger: HayLogger;
}

/**
 * Context provided to onDisable hook.
 *
 * Used for cleanup when plugin is disabled/uninstalled for an org.
 *
 * @remarks
 * Plugin should clean up org-specific resources:
 * - Revoke tokens
 * - Remove webhooks or subscriptions on external services
 * - Cancel scheduled jobs
 * - Delete temporary data
 *
 * MCP servers are automatically stopped by the platform; no need to stop them manually.
 *
 * @example
 * ```typescript
 * async onDisable(ctx: HayDisableContext) {
 *   const { org, logger } = ctx;
 *
 *   logger.info(`Disabling plugin for org: ${org.id}`);
 *
 *   // Clean up external resources
 *   await removeWebhooks(org.id);
 *   await revokeTokens(org.id);
 *
 *   logger.info('Cleanup complete');
 * }
 * ```
 *
 * @see PLUGIN.md Section 5.6 (lines 605-613)
 */
export interface HayDisableContext {
  /**
   * Organization information.
   */
  org: HayOrg;

  /**
   * Logger for disable/cleanup messages.
   */
  logger: HayLogger;
}
