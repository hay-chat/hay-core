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
import { createPluginStateRuntime } from '../sdk/plugin-state-runtime.js';
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
 * - `state`: persisted key/value store in core (when HAY_API_URL/TOKEN are set;
 *   a worker serves one organization, so it is that org's state)
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
    state:
      process.env.HAY_API_URL && process.env.HAY_API_TOKEN
        ? createPluginStateRuntime({
            apiUrl: process.env.HAY_API_URL,
            apiToken: process.env.HAY_API_TOKEN,
          })
        : undefined,
  };
}
