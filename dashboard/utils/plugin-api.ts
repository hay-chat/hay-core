// Plugin API helper for dynamic access to plugin routers
// This maintains plugin independence while providing a cleaner API

import { Hay } from "./api";

/**
 * A node in the dynamically-accessed plugin tRPC tree. Plugin routers are not
 * known statically, so we model them as a nested record whose leaves expose
 * tRPC `query`/`mutate` procedure callers.
 */
type PluginApiNode = {
  query?: (input?: unknown) => Promise<unknown>;
  mutate?: (input?: unknown) => Promise<unknown>;
  [segment: string]: unknown;
};

function isPluginApiNode(value: unknown): value is PluginApiNode {
  return typeof value === "object" && value !== null;
}

/**
 * Get a plugin's router dynamically
 * @param pluginId - The plugin identifier (e.g., 'cloud')
 * @returns The plugin router or undefined if not available
 */
export function getPluginRouter(pluginId: string): PluginApiNode | undefined {
  const router = (Hay as Record<string, unknown>)[pluginId];
  return isPluginApiNode(router) ? router : undefined;
}

/**
 * Type-safe wrapper for plugin API calls with error handling
 */
export async function callPluginApi<T>(
  pluginId: string,
  path: string[],
  method: "query" | "mutate",
  params?: unknown,
): Promise<T> {
  try {
    let current: PluginApiNode | undefined = getPluginRouter(pluginId);

    if (!current) {
      throw new Error(`Plugin "${pluginId}" is not available`);
    }

    // Navigate through the path
    for (const segment of path) {
      const next: unknown = current[segment];
      if (!isPluginApiNode(next)) {
        throw new Error(`API path "${pluginId}.${path.join(".")}" is not available`);
      }
      current = next;
    }

    // Call the method
    const caller = current[method];
    if (typeof caller !== "function") {
      throw new Error(`Method "${method}" is not available on "${pluginId}.${path.join(".")}"`);
    }

    return (params ? await caller(params) : await caller()) as T;
  } catch (error) {
    console.error(`Plugin API call failed:`, error);
    throw error;
  }
}
