// Plugin API helper for dynamic access to plugin routers
// This maintains plugin independence while providing a cleaner API

import { Hay } from './api';

/**
 * Get a plugin's router dynamically
 * @param pluginId - The plugin identifier (e.g., 'cloud')
 * @returns The plugin router or undefined if not available
 */
export function getPluginRouter(pluginId: string): any {
  return (Hay as any)[pluginId];
}

/**
 * Type-safe wrapper for plugin API calls with error handling
 */
export async function callPluginApi<T>(
  pluginId: string,
  path: string[],
  method: 'query' | 'mutate',
  params?: any
): Promise<T> {
  try {
    let current: any = getPluginRouter(pluginId);

    if (!current) {
      throw new Error(`Plugin "${pluginId}" is not available`);
    }

    // Navigate through the path
    for (const segment of path) {
      current = current[segment];
      if (!current) {
        throw new Error(`API path "${pluginId}.${path.join('.')}" is not available`);
      }
    }

    // Call the method
    if (typeof current[method] !== 'function') {
      throw new Error(`Method "${method}" is not available on "${pluginId}.${path.join('.')}"`);
    }

    return params ? await current[method](params) : await current[method]();
  } catch (error) {
    console.error(`Plugin API call failed:`, error);
    throw error;
  }
}