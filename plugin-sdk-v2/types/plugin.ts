/**
 * Hay Plugin SDK v2 - Plugin Definition Types
 *
 * Core types for defining Hay plugins.
 *
 * @module @hay/plugin-sdk-v2/types/plugin
 */

import type { HayGlobalContext } from './contexts';
import type {
  OnInitializeHook,
  OnStartHook,
  OnValidateAuthHook,
  OnConfigUpdateHook,
  OnDisableHook,
  OnEnableHook,
} from './hooks';

/**
 * Plugin definition interface.
 *
 * Defines the structure and lifecycle hooks for a Hay plugin.
 * All hooks are optional except `name`.
 *
 * @remarks
 * Plugins are defined using the {@link defineHayPlugin} factory function,
 * which receives a {@link HayGlobalContext} and returns a HayPluginDefinition.
 *
 * **Hook execution order**:
 * 1. onInitialize (global, once per worker process)
 * 2. onEnable (CORE-ONLY, not called by runner)
 * 3. onStart (org runtime, may be called multiple times)
 * 4. onValidateAuth (when auth settings change)
 * 5. onConfigUpdate (when config settings change)
 * 6. onDisable (when plugin is uninstalled/disabled)
 *
 * @example
 * ```typescript
 * export default defineHayPlugin((globalCtx) => ({
 *   name: "Stripe",
 *
 *   onInitialize() {
 *     globalCtx.register.config({ ... });
 *     globalCtx.register.auth.apiKey({ ... });
 *   },
 *
 *   async onStart(ctx) {
 *     const apiKey = ctx.config.get<string>("apiKey");
 *     await ctx.mcp.startLocal("stripe-mcp", () => ...);
 *   },
 *
 *   async onValidateAuth(ctx) {
 *     const auth = ctx.auth.get();
 *     return await validateCredentials(auth);
 *   },
 * }));
 * ```
 *
 * @see PLUGIN.md Section 5.1 (lines 302-346)
 */
export interface HayPluginDefinition {
  /**
   * Plugin name (required).
   *
   * @remarks
   * This is the display name shown in the Hay dashboard.
   * Should match or be similar to the package name.
   */
  name: string;

  /**
   * Global initialization hook (optional).
   *
   * Called once per worker process at startup.
   * Use this to register config schema, auth methods, routes, and UI extensions.
   *
   * @see {@link OnInitializeHook}
   */
  onInitialize?: OnInitializeHook;

  /**
   * Organization runtime start hook (optional).
   *
   * Called when the plugin starts for a specific organization.
   * Use this to read config/auth and start MCP servers.
   *
   * @see {@link OnStartHook}
   */
  onStart?: OnStartHook;

  /**
   * Authentication validation hook (optional).
   *
   * Called when auth credentials are saved/updated.
   * Return true if credentials are valid, false otherwise.
   *
   * @see {@link OnValidateAuthHook}
   */
  onValidateAuth?: OnValidateAuthHook;

  /**
   * Configuration update hook (optional).
   *
   * Called when plugin settings are updated.
   * Most plugins can omit this and handle updates in onStart.
   *
   * @see {@link OnConfigUpdateHook}
   */
  onConfigUpdate?: OnConfigUpdateHook;

  /**
   * Disable/uninstall hook (optional).
   *
   * Called when the plugin is disabled for an organization.
   * Use this to clean up resources (revoke tokens, remove webhooks, etc.).
   *
   * @see {@link OnDisableHook}
   */
  onDisable?: OnDisableHook;

  /**
   * **⚠️ CORE-ONLY HOOK - NOT CALLED BY RUNNER**
   *
   * Enable hook (optional).
   *
   * This hook is triggered by Hay Core during plugin installation,
   * NOT by the worker runner. Reserved for future use.
   *
   * @see {@link OnEnableHook}
   * @see CONSTRAINT 4 in PLUGIN_SDK_V2_PLAN.md
   */
  onEnable?: OnEnableHook;
}

/**
 * Plugin factory function type.
 *
 * A function that receives a global context and returns a plugin definition.
 * This is the signature expected by {@link defineHayPlugin}.
 *
 * @param ctx - Global context available during plugin initialization
 * @returns Plugin definition with lifecycle hooks
 *
 * @remarks
 * The factory pattern allows plugins to capture the global context
 * and use it across multiple hooks without needing to pass it explicitly.
 *
 * @example
 * ```typescript
 * const myPluginFactory: HayPluginFactory = (globalCtx) => {
 *   return {
 *     name: "My Plugin",
 *     onInitialize() {
 *       globalCtx.register.config({ ... });
 *     },
 *   };
 * };
 * ```
 *
 * @see PLUGIN.md Section 5.1 (lines 302-331)
 */
export type HayPluginFactory = (ctx: HayGlobalContext) => HayPluginDefinition;
