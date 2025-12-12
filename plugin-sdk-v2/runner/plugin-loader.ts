/**
 * Hay Plugin SDK v2 - Plugin Loader
 *
 * Loads plugin code and validates the plugin definition.
 *
 * @module @hay/plugin-sdk-v2/runner/plugin-loader
 */

import type { HayPluginDefinition } from '../types';

/**
 * Load a plugin from its entry file.
 *
 * @param entryPath - Absolute path to the plugin entry file
 * @param pluginName - Plugin name for error messages
 * @returns Plugin definition
 * @throws Error if plugin fails to load or is invalid
 *
 * @remarks
 * This function:
 * 1. Dynamically imports the plugin entry file
 * 2. Expects a default export (the result of `defineHayPlugin()`)
 * 3. Validates the plugin definition structure
 * 4. Returns the validated plugin definition
 *
 * @see PLUGIN.md Section 3.1 (lines 96-132)
 */
export async function loadPlugin(
  entryPath: string,
  pluginName: string
): Promise<HayPluginDefinition> {
  let pluginModule: any;

  try {
    // Dynamic import of the plugin entry file
    pluginModule = await import(entryPath);
  } catch (err) {
    throw new Error(
      `Failed to load plugin "${pluginName}" from ${entryPath}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  // Validate default export exists
  if (!pluginModule.default) {
    throw new Error(
      `Plugin "${pluginName}" must export a default value (result of defineHayPlugin())`
    );
  }

  const pluginDefinition = pluginModule.default;

  // Validate plugin definition structure
  validatePluginDefinition(pluginDefinition, pluginName);

  return pluginDefinition as HayPluginDefinition;
}

/**
 * Validate a plugin definition structure.
 *
 * @param def - Plugin definition to validate
 * @param pluginName - Plugin name for error messages
 * @throws Error if plugin definition is invalid
 *
 * @remarks
 * Checks:
 * - Plugin definition is an object
 * - Has a `name` field (string)
 * - Hooks (if present) are functions
 */
function validatePluginDefinition(def: any, pluginName: string): void {
  if (!def || typeof def !== 'object') {
    throw new Error(
      `Plugin "${pluginName}" must export an object (HayPluginDefinition)`
    );
  }

  // Validate name field (required)
  if (!def.name || typeof def.name !== 'string') {
    throw new Error(
      `Plugin "${pluginName}" must have a "name" field (string)`
    );
  }

  // Validate hooks are functions (if present)
  const hookNames = [
    'onInitialize',
    'onStart',
    'onValidateAuth',
    'onConfigUpdate',
    'onDisable',
    'onEnable',
  ] as const;

  for (const hookName of hookNames) {
    if (def[hookName] !== undefined && typeof def[hookName] !== 'function') {
      throw new Error(
        `Plugin "${pluginName}" hook "${hookName}" must be a function`
      );
    }
  }
}
