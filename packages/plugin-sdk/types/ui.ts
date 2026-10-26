/**
 * Hay Plugin SDK - UI Page Types
 *
 * Types for registering UI pages in plugins.
 *
 * @module @hay/plugin-sdk/types/ui
 */

/**
 * Plugin page descriptor.
 *
 * Defines a UI page/component provided by the plugin with metadata
 * for dashboard rendering. Supports slots, standalone pages, and custom routes.
 *
 * @remarks
 * Plugin pages are built Vue components served as bundles from
 * `dashboard/public/plugins/{pluginId}/ui.js`. They are loaded dynamically
 * at runtime using the plugin registry composable.
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
export interface PluginPage {
  /**
   * Unique identifier for the page.
   *
   * @remarks
   * Used as a key for component caching and routing.
   * Must be unique within the plugin.
   *
   * @example "setup-guide", "analytics-dashboard", "settings"
   */
  id: string;

  /**
   * Display title for the page.
   *
   * @remarks
   * Shown in navigation, tabs, or page headers.
   *
   * @example "Setup Guide", "Analytics", "Advanced Settings"
   */
  title: string;

  /**
   * Path to the Vue component relative to plugin root.
   *
   * @remarks
   * Component will be built into the UI bundle and exported by name.
   * The component name is extracted from the path (e.g., "AfterSettings" from "./components/settings/AfterSettings.vue").
   *
   * @example "./components/settings/AfterSettings.vue", "./pages/Analytics.vue"
   */
  component: string;

  /**
   * Icon name for the page (optional).
   *
   * @remarks
   * Icon identifier for UI rendering (sidebar, tabs, etc.).
   * Icon system depends on dashboard implementation.
   *
   * @example "book", "chart", "settings", "shield"
   */
  icon?: string;

  /**
   * Where to render the component.
   *
   * @remarks
   * - `"standalone"` - Own route/page (future enhancement)
   * - `"after-settings"` - Below plugin settings form
   * - `"before-settings"` - Above plugin settings form
   *
   * @default "standalone"
   */
  slot?: "standalone" | "after-settings" | "before-settings";

  /**
   * Whether the page requires plugin setup to be complete.
   *
   * @remarks
   * If true, page is only accessible after plugin configuration is complete.
   *
   * @default false
   */
  requiresSetup?: boolean;
}
