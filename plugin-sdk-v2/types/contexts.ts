/**
 * Hay Plugin SDK v2 - Context Type Declarations
 *
 * Forward declarations for context types used in plugin hooks.
 * These are empty interfaces that will be fully implemented in Phase 2.2.
 *
 * @module @hay/plugin-sdk-v2/types/contexts
 */

/**
 * Global context provided to onInitialize hook.
 * Allows registration of config, auth, routes, UI extensions, etc.
 *
 * @remarks
 * This context is available during the global initialization phase,
 * before any organization-specific runtime begins.
 *
 * **Phase 2.2 will add**: register, config, logger properties
 */
export interface HayGlobalContext {
  // To be implemented in Phase 2.2
}

/**
 * Runtime context provided to onStart hook.
 * Provides access to org-specific config, auth, MCP, and logger.
 *
 * @remarks
 * This context is available during organization runtime,
 * after the plugin has been initialized and configured for a specific org.
 *
 * **Phase 2.2 will add**: org, config, auth, mcp, logger properties
 */
export interface HayStartContext {
  // To be implemented in Phase 2.2
}

/**
 * Context provided to onValidateAuth hook.
 * Used to validate authentication credentials for an organization.
 *
 * @remarks
 * Called when auth settings are saved or updated.
 * Plugin should verify credentials and return true/false.
 *
 * **Phase 2.2 will add**: org, config, auth, logger properties
 */
export interface HayAuthValidationContext {
  // To be implemented in Phase 2.2
}

/**
 * Context provided to onConfigUpdate hook.
 * Notifies plugin of configuration changes.
 *
 * @remarks
 * Optional hook - most plugins can handle config changes in onStart.
 *
 * **Phase 2.2 will add**: org, config, logger properties
 */
export interface HayConfigUpdateContext {
  // To be implemented in Phase 2.2
}

/**
 * Context provided to onDisable hook.
 * Used for cleanup when plugin is disabled/uninstalled for an org.
 *
 * @remarks
 * Plugin should clean up org-specific resources (tokens, webhooks, etc.)
 *
 * **Phase 2.2 will add**: org, logger properties
 */
export interface HayDisableContext {
  // To be implemented in Phase 2.2
}
