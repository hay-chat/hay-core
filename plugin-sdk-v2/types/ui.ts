/**
 * Hay Plugin SDK v2 - UI Extension Types
 *
 * Types for registering UI extensions in plugins.
 *
 * @module @hay/plugin-sdk-v2/types/ui
 */

/**
 * UI extension descriptor.
 *
 * Defines a UI extension that will be rendered in the Hay dashboard.
 *
 * @remarks
 * UI extensions allow plugins to add custom Vue components to specific
 * slots in the dashboard UI (e.g., settings panels, custom views).
 *
 * The `component` path is relative to the plugin root and should point
 * to a Vue component file.
 *
 * @example
 * ```typescript
 * register.ui({
 *   slot: 'after-settings',
 *   component: 'components/ShopifySettings.vue',
 * });
 * ```
 *
 * @see PLUGIN.md Section 5.2.3 (lines 411-419)
 */
export interface UIExtensionDescriptor {
  /**
   * UI slot identifier.
   *
   * @remarks
   * Common slots:
   * - `"after-settings"` - After plugin settings form
   * - `"header"` - In dashboard header
   * - `"sidebar"` - In dashboard sidebar
   * - Custom slots defined by the platform
   *
   * @example "after-settings", "header", "custom-analytics"
   */
  slot: string;

  /**
   * Path to Vue component file.
   *
   * @remarks
   * Path is relative to plugin root directory.
   * Must be a valid Vue component file (.vue).
   *
   * @example "components/ShopifySettings.vue"
   */
  component: string;

  // Future: props, conditions, permissions, etc.
}
