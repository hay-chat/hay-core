/**
 * Hay Plugin SDK - Global Context Factory
 *
 * Creates the global context for onInitialize hook execution.
 *
 * @module @hay/plugin-sdk/runner/global-context
 */

import type { HayGlobalContext, HayPluginManifest } from '../types/index.js';
import { PluginRegistry } from '../sdk/registry.js';
import { createRegisterAPI } from '../sdk/register.js';
import { createConfigDescriptorAPI } from '../sdk/config-descriptor.js';
import type { HayLogger } from '../types/index.js';

/**
 * Create a global context for onInitialize.
 *
 * @param logger - Logger instance
 * @param registry - Plugin registry
 * @param manifest - Plugin manifest (for env validation)
 * @returns Global context instance
 *
 * @remarks
 * The global context provides:
 * - `register`: API for registering config, auth, routes, UI
 * - `config`: API for creating config field references (descriptor API only)
 * - `logger`: Logger instance
 *
 * This context is passed to the plugin factory and used in `onInitialize`.
 *
 * @see PLUGIN.md Section 5.2 (lines 350-449)
 */
export function createGlobalContext(
  logger: HayLogger,
  registry: PluginRegistry,
  manifest: HayPluginManifest
): HayGlobalContext {
  return {
    register: createRegisterAPI({
      registry,
      manifest: {
        env: manifest.env,
      },
      logger,
    }),
    config: createConfigDescriptorAPI(),
    logger,
  };
}
