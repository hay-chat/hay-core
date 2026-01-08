/**
 * Hay Plugin SDK - Manifest Types
 *
 * Types for the plugin manifest in package.json.
 *
 * @module @hay/plugin-sdk/types/manifest
 */

/**
 * Plugin category type.
 *
 * Determines how the plugin is classified in the Hay marketplace.
 */
export type PluginCategory = 'integration' | 'channel' | 'tool' | 'analytics';

/**
 * Plugin capabilities.
 *
 * Declares what features the plugin uses.
 */
export type PluginCapability = 'routes' | 'mcp' | 'auth' | 'config' | 'ui';

/**
 * Hay plugin manifest structure.
 *
 * This is the `hay-plugin` block inside package.json.
 *
 * @remarks
 * The manifest is **intentionally minimal**:
 * - NO config schema (defined in onInitialize via register.config)
 * - NO MCP definitions (registered in onStart via mcp.startLocal/External)
 * - NO auth details (registered in onInitialize via register.auth)
 *
 * The `env` field is an **allow-list** of environment variables that the
 * plugin may access. If a config field references an env var NOT in this list,
 * it's a configuration error.
 *
 * @example
 * ```json
 * {
 *   "name": "hay-plugin-shopify",
 *   "version": "0.1.0",
 *   "main": "dist/index.js",
 *   "hay-plugin": {
 *     "entry": "./dist/index.js",
 *     "displayName": "Shopify",
 *     "category": "integration",
 *     "capabilities": ["routes", "mcp", "auth", "config", "ui"],
 *     "env": ["SHOPIFY_API_KEY", "SHOPIFY_SECRET"]
 *   }
 * }
 * ```
 *
 * @see PLUGIN.md Section 2 (lines 58-92)
 */
export interface HayPluginManifest {
  /**
   * Path to the compiled plugin entry file (relative to plugin root).
   *
   * @remarks
   * This is the file that exports the result of `defineHayPlugin()`.
   * Typically `./dist/index.js` after TypeScript compilation.
   *
   * @example "./dist/index.js"
   */
  entry: string;

  /**
   * Display name shown in the Hay marketplace and dashboard.
   *
   * @example "Shopify"
   */
  displayName: string;

  /**
   * Plugin category for marketplace classification.
   *
   * @example "integration"
   */
  category: PluginCategory;

  /**
   * List of capabilities the plugin uses.
   *
   * @remarks
   * This helps Hay understand what features the plugin needs:
   * - `routes`: Plugin registers HTTP routes
   * - `mcp`: Plugin starts MCP servers
   * - `auth`: Plugin uses authentication
   * - `config`: Plugin has configuration settings
   * - `ui`: Plugin provides UI extensions
   *
   * @example ["routes", "mcp", "auth", "config"]
   */
  capabilities: PluginCapability[];

  /**
   * Allow-list of environment variables the plugin may access.
   *
   * @remarks
   * - Only env vars listed here can be used as fallbacks in config fields.
   * - If a config field has `env: "SHOPIFY_API_KEY"` but "SHOPIFY_API_KEY"
   *   is NOT in this list, it's a configuration error.
   * - This prevents plugins from accessing core env vars (DB_PASSWORD, etc.).
   *
   * @example ["SHOPIFY_API_KEY", "SHOPIFY_SECRET"]
   */
  env?: string[];
}

/**
 * Package.json with Hay plugin manifest.
 *
 * @remarks
 * This is the full package.json structure with the `hay-plugin` field.
 */
export interface HayPluginPackageJson {
  /**
   * Package name (e.g., "hay-plugin-shopify")
   */
  name: string;

  /**
   * Package version (semver)
   */
  version: string;

  /**
   * Main entry point (optional, typically same as hay-plugin.entry)
   */
  main?: string;

  /**
   * Hay plugin manifest
   */
  'hay-plugin': HayPluginManifest;

  /**
   * Other standard package.json fields
   */
  [key: string]: any;
}
