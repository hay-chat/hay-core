/**
 * Hay Plugin SDK - Organization Types
 *
 * Types for organization information in plugin contexts.
 *
 * @module @hay/plugin-sdk/types/org
 */

/**
 * Organization information.
 *
 * Basic information about the organization for which the plugin is running.
 *
 * @remarks
 * Each plugin worker process runs for a specific organization.
 * The org context is available in all runtime hooks (onStart, onValidateAuth, etc.).
 *
 * @example
 * ```typescript
 * async onStart(ctx) {
 *   const { org, logger } = ctx;
 *   logger.info(`Plugin started for org: ${org.id} (${org.name})`);
 * }
 * ```
 *
 * @see PLUGIN.md Section 5.3.1 (lines 465-473)
 */
export interface HayOrg {
  /**
   * Unique organization identifier.
   *
   * @remarks
   * This is the UUID or ID used to identify the organization in the platform.
   */
  id: string;

  /**
   * Organization name (optional).
   *
   * @remarks
   * Human-readable organization name, if available.
   */
  name?: string;

  // Future: region, plan, metadata, etc.
}
