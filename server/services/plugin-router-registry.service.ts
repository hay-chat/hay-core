import { router } from "@server/trpc";

/**
 * Generic plugin router registry - plugins register their routers here
 */
export class PluginRouterRegistry {
  private static instance: PluginRouterRegistry;
  private pluginRouters: Map<string, any> = new Map();
  private mergedRouter: any = null;

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
  registerRouter(pluginId: string, pluginRouter: any): void {
    console.log(`📦 Registering router for plugin: ${pluginId}`);
    this.pluginRouters.set(pluginId, pluginRouter);
    this.mergedRouter = null; // Invalidate cache
  }

  /**
   * Unregister a plugin router
   */
  unregisterRouter(pluginId: string): void {
    console.log(`📦 Unregistering router for plugin: ${pluginId}`);
    this.pluginRouters.delete(pluginId);
    this.mergedRouter = null; // Invalidate cache
  }

  /**
   * Get all registered plugin routers as a map
   */
  getPluginRouters(): Map<string, any> {
    return new Map(this.pluginRouters);
  }

  /**
   * Create a merged router with all plugin routers
   */
  createMergedRouter(baseRouters: Record<string, any>): any {
    if (this.mergedRouter) {
      return this.mergedRouter;
    }

    const allRouters = { ...baseRouters };

    // Add all registered plugin routers
    for (const [pluginId, pluginRouter] of this.pluginRouters) {
      allRouters[pluginId] = pluginRouter;
    }

    this.mergedRouter = router(allRouters);
    return this.mergedRouter;
  }

  /**
   * Check if a plugin router is registered
   */
  hasRouter(pluginId: string): boolean {
    return this.pluginRouters.has(pluginId);
  }
}

export const pluginRouterRegistry = PluginRouterRegistry.getInstance();