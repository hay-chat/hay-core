/**
 * Hay Plugin SDK - Hook Type Signatures
 *
 * Type definitions for all plugin lifecycle hooks.
 *
 * @module @hay/plugin-sdk/types/hooks
 */

import type {
  HayGlobalContext,
  HayStartContext,
  HayAuthValidationContext,
  HayConfigUpdateContext,
  HayDisableContext,
} from './contexts';

/**
 * Global initialization hook.
 *
 * Called once per worker process at startup, before the HTTP server starts.
 * Used to declare static, non-org-specific aspects of the plugin:
 * - Config schema (field definitions)
 * - Auth methods supported (API key, OAuth, etc.)
 * - UI extensions (settings panels, etc.)
 * - HTTP routes (webhooks, callbacks)
 *
 * @param ctx - Global context with register API, config descriptor API, and logger
 * @returns Promise or void
 *
 * @remarks
 * **Restrictions**:
 * - No access to org config or auth values
 * - Must not perform tenant-specific work
 * - Only use descriptor APIs (register.*, config.field)
 *
 * @see {@link HayGlobalContext}
 * @see PLUGIN.md Section 4.1 (lines 168-193)
 */
export type OnInitializeHook = (ctx: HayGlobalContext) => Promise<void> | void;

/**
 * Organization runtime start hook.
 *
 * Called whenever the plugin needs to start or restart for an org:
 * - After initial installation + first config save
 * - After config updates (platform may restart worker)
 * - After auth changes
 *
 * Used to wire the plugin into org-specific resources:
 * - Read config values (config.get)
 * - Read auth credentials (auth.get)
 * - Start local MCP servers
 * - Connect to external MCP servers
 * - Run lightweight initialization logic
 *
 * @param ctx - Runtime context with org, config, auth, MCP, and logger
 * @returns Promise or void
 *
 * @remarks
 * If something fails (e.g., MCP fails to start), plugin stays installed
 * but may be marked as "degraded" in UI. onStart must NOT crash the worker;
 * errors should be logged via logger.
 *
 * @see {@link HayStartContext}
 * @see PLUGIN.md Section 4.2 (lines 195-223)
 */
export type OnStartHook = (ctx: HayStartContext) => Promise<void> | void;

/**
 * Authentication validation hook.
 *
 * Called whenever auth-related settings are saved or updated:
 * - Immediately after user configures auth (API key/OAuth) in UI
 * - Optionally before calling onStart
 *
 * Allows plugin to verify that auth credentials are valid by:
 * - Testing API key by calling provider endpoint
 * - Testing OAuth token by calling a "me" or "ping" endpoint
 *
 * @param ctx - Auth validation context with org, config, auth, and logger
 * @returns Promise<boolean> or boolean
 *   - true: auth is valid; UI shows "Connected"
 *   - false: auth invalid; UI shows "Auth failed"
 *
 * @remarks
 * If this hook is not implemented, platform assumes auth is always valid (true).
 * Plugin remains installed but may be considered not fully configured if auth fails.
 *
 * @see {@link HayAuthValidationContext}
 * @see PLUGIN.md Section 4.3 (lines 225-257)
 */
export type OnValidateAuthHook = (
  ctx: HayAuthValidationContext,
) => Promise<boolean> | boolean;

/**
 * Configuration update hook.
 *
 * Called after settings are saved for an org (before or around restart of onStart).
 *
 * @param ctx - Config update context with org, config, and logger
 * @returns Promise or void
 *
 * @remarks
 * **Optional hook** - most plugins can ignore this and just react in onStart.
 * Use this only if plugin needs to be notified about config changes
 * beyond what's handled in onStart.
 *
 * @see {@link HayConfigUpdateContext}
 * @see PLUGIN.md Section 4.4 (lines 259-274)
 */
export type OnConfigUpdateHook = (
  ctx: HayConfigUpdateContext,
) => Promise<void> | void;

/**
 * Plugin disable/uninstall hook.
 *
 * Called when the plugin is uninstalled or disabled for an org.
 * Used to cleanup org-specific resources:
 * - Revoke tokens
 * - Remove webhooks or subscriptions on external services
 * - Stop long-running jobs (if not already stopped by worker shutdown)
 *
 * @param ctx - Disable context with org and logger
 * @returns Promise or void
 *
 * @see {@link HayDisableContext}
 * @see PLUGIN.md Section 4.5 (lines 276-295)
 */
export type OnDisableHook = (ctx: HayDisableContext) => Promise<void> | void;

/**
 * Plugin enable hook.
 *
 * **⚠️ CORE-ONLY HOOK - NOT CALLED BY RUNNER**
 *
 * This hook is triggered by Hay Core during plugin installation/enablement,
 * NOT by the worker runner. The runner only handles:
 * - onInitialize
 * - onStart
 * - onValidateAuth
 * - onConfigUpdate
 * - onDisable
 *
 * @param ctx - Global context (similar to onInitialize)
 * @returns Promise or void
 *
 * @remarks
 * This hook is reserved for future use by Hay Core.
 * Plugin developers can implement it, but it will only be called
 * by the core system, not during normal worker lifecycle.
 *
 * @see CONSTRAINT 4 in PLUGIN_SDK_V2_PLAN.md (line 361)
 */
export type OnEnableHook = (ctx: HayGlobalContext) => Promise<void> | void;
