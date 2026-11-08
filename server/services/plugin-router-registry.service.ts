import type { AnyRouter } from "@trpc/server";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("plugin-router-registry");

/**
 * Generic plugin router registry - plugins register their routers here.
 *
 * Registered routers are only ever invoked in-process through `createCaller`.
 * They are deliberately not part of the HTTP router served at /v1.
 */
export class PluginRouterRegistry {
  private static instance: PluginRouterRegistry;
  private pluginRouters: Map<string, AnyRouter> = new Map();

  private constructor() {}

  static getInstance(): PluginRouterRegistry {
    if (!PluginRouterRegistry.instance) {
      PluginRouterRegistry.instance = new PluginRouterRegistry();
    }
    return PluginRouterRegistry.instance;
  }

  /**
   * Register a plugin router
   * Called by plugins during initialization
   */
  registerRouter(pluginId: string, pluginRouter: AnyRouter): void {
    logger.info({ pluginId }, "Registering router for plugin");
    this.pluginRouters.set(pluginId, pluginRouter);
  }

  /**
   * Unregister a plugin router
   */
  unregisterRouter(pluginId: string): void {
    logger.info({ pluginId }, "Unregistering router for plugin");
    this.pluginRouters.delete(pluginId);
  }

  /**
   * Get all registered plugin routers as a map
   */
  getPluginRouters(): Map<string, AnyRouter> {
    return new Map(this.pluginRouters);
  }

  /**
   * Get a single registered plugin router by id, or undefined if not registered.
   */
  getRouter(pluginId: string): AnyRouter | undefined {
    return this.pluginRouters.get(pluginId);
  }

  /**
   * Check if a plugin router is registered
   */
  hasRouter(pluginId: string): boolean {
    return this.pluginRouters.has(pluginId);
  }
}

export const pluginRouterRegistry = PluginRouterRegistry.getInstance();
