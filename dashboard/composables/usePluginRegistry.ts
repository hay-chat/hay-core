/**
 * Plugin Registry Composable
 *
 * Provides dynamic loading of plugin UI components from built bundles.
 * Components are loaded through authenticated HTTP endpoints.
 *
 * @example
 * ```typescript
 * const { loadPluginComponent } = usePluginRegistry();
 * const AfterSettings = loadPluginComponent('@hay/plugin-zendesk', 'AfterSettings');
 * ```
 */

import { defineAsyncComponent, type Component } from "vue";
import { useDomain } from "@/composables/useDomain";

interface PluginComponentCache {
  [key: string]: Component;
}

interface WindowWithVue {
  Vue?: typeof import("vue");
  [key: string]: unknown;
}

/**
 * Convert plugin ID to global variable name.
 * Examples:
 * - @hay/plugin-zendesk -> ZendeskPlugin
 * - @hay/plugin-oauth2 -> Oauth2Plugin
 *
 * @param pluginId - Plugin ID
 * @returns Global variable name
 */
function convertPluginIdToGlobalVar(pluginId: string): string {
  return (
    pluginId
      .replace(/@hay\/plugin-/, "")
      // Handle numbers and uppercase letters: oauth2 -> Oauth2, shopify-v2 -> ShopifyV2
      .replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase())
      .replace(/^[a-z]/, (letter) => letter.toUpperCase()) + "Plugin"
  );
}

export const usePluginRegistry = () => {
  const componentCache: PluginComponentCache = {};
  const loadedResources = new Set<string>(); // Track loaded scripts and styles
  const { getApiUrl } = useDomain();

  /**
   * Load a plugin component dynamically from its UI bundle.
   *
   * @param pluginId - Plugin identifier (e.g., '@hay/plugin-zendesk')
   * @param componentName - Component name as exported from the bundle (e.g., 'AfterSettings')
   * @param _pluginPath - Plugin source path (unused, kept for compatibility)
   * @returns Vue component or null if loading fails
   */
  const loadPluginComponent = (
    pluginId: string,
    componentName: string,
    _pluginPath?: string,
  ): Component | null => {
    const cacheKey = `${pluginId}:${componentName}`;

    // Return cached component if available
    if (componentCache[cacheKey]) {
      return componentCache[cacheKey];
    }

    try {
      console.log(`[PluginRegistry] Loading ${componentName} from ${pluginId}`);

      const component = defineAsyncComponent({
        loader: async () => {
          // Ensure Vue is available globally before loading plugin bundle
          const globalWindow = window as unknown as WindowWithVue;
          if (typeof window !== "undefined" && !globalWindow.Vue) {
            // Import Vue and expose it globally
            const Vue = await import("vue");
            globalWindow.Vue = Vue;
            console.log("[PluginRegistry] Vue exposed globally for UMD bundles");
          }

          // Build authenticated URL to plugin UI bundle (UMD format)
          // URL format: http://localhost:3001/plugins/ui/@hay/plugin-zendesk/ui.js
          const apiBaseUrl = getApiUrl();
          const bundleUrl = `${apiBaseUrl}/plugins/ui/${encodeURIComponent(pluginId)}/ui.js`;
          const styleUrl = `${apiBaseUrl}/plugins/ui/${encodeURIComponent(pluginId)}/style.css`;

          console.log(`[PluginRegistry] Loading UMD bundle from ${bundleUrl}`);

          // Check if plugin resources are already loaded
          if (loadedResources.has(pluginId)) {
            console.log(
              `[PluginRegistry] Plugin ${pluginId} resources already loaded, skipping script/style`,
            );
          } else {
            // Load CSS first (if not already loaded)
            const styleId = `plugin-style-${pluginId}`;
            if (!document.getElementById(styleId)) {
              await new Promise<void>((resolve) => {
                const link = document.createElement("link");
                link.id = styleId;
                link.rel = "stylesheet";
                link.href = styleUrl;
                link.onload = () => {
                  console.log(`[PluginRegistry] CSS loaded for ${pluginId}`);
                  resolve();
                };
                link.onerror = () => {
                  // CSS loading failure is non-fatal - proceed anyway
                  console.warn(`[PluginRegistry] Failed to load CSS for ${pluginId}, continuing`);
                  resolve();
                };
                document.head.appendChild(link);
              });
            }

            // Load the UMD bundle as a script tag (it will set a global variable)
            const scriptId = `plugin-script-${pluginId}`;
            if (!document.getElementById(scriptId)) {
              await new Promise<void>((resolve, reject) => {
                const script = document.createElement("script");
                script.id = scriptId;
                script.src = bundleUrl;
                script.async = true;
                script.onload = () => {
                  console.log(`[PluginRegistry] UMD bundle loaded for ${pluginId}`);
                  resolve();
                };
                script.onerror = () => {
                  reject(new Error(`Failed to load plugin bundle from ${bundleUrl}`));
                };
                document.head.appendChild(script);
              });
            }

            // Mark plugin as loaded
            loadedResources.add(pluginId);
          }

          // The UMD bundle exposes components on a global variable
          // For Zendesk plugin, it's window.ZendeskPlugin
          const pluginNamePascal = convertPluginIdToGlobalVar(pluginId);
          const pluginGlobal = globalWindow[pluginNamePascal] as
            | Record<string, unknown>
            | undefined;

          if (!pluginGlobal) {
            throw new Error(
              `Plugin global variable "${pluginNamePascal}" not found. Bundle may not have loaded correctly.`,
            );
          }

          const loadedComponent = pluginGlobal[componentName];
          if (!loadedComponent) {
            throw new Error(
              `Component "${componentName}" not found in plugin "${pluginId}" (global: ${pluginNamePascal})`,
            );
          }

          console.log(`[PluginRegistry] Successfully loaded ${componentName} from ${pluginId}`);
          return loadedComponent;
        },
        delay: 200,
        timeout: 10000,
        onError(error, _retry, fail) {
          console.error(`Failed to load plugin component ${pluginId}/${componentName}:`, error);
          fail();
        },
      });

      // Cache the component
      componentCache[cacheKey] = component;
      return component;
    } catch (error) {
      console.error(`Failed to load plugin component ${pluginId}/${componentName}:`, error);
      return null;
    }
  };

  /**
   * Clear the component cache.
   * Useful when plugins are updated or reloaded.
   */
  const clearCache = () => {
    Object.keys(componentCache).forEach((key) => delete componentCache[key]);
  };

  /**
   * Unload a plugin completely by removing its scripts, styles, and cache entries.
   * This helps prevent memory leaks when plugins are disabled or updated.
   *
   * @param pluginId - Plugin identifier to unload
   */
  const unloadPlugin = (pluginId: string) => {
    console.log(`[PluginRegistry] Unloading plugin ${pluginId}`);

    // Remove script tag
    const scriptId = `plugin-script-${pluginId}`;
    const script = document.getElementById(scriptId);
    if (script) {
      script.remove();
      console.log(`[PluginRegistry] Removed script for ${pluginId}`);
    }

    // Remove style tag
    const styleId = `plugin-style-${pluginId}`;
    const style = document.getElementById(styleId);
    if (style) {
      style.remove();
      console.log(`[PluginRegistry] Removed styles for ${pluginId}`);
    }

    // Remove from loaded resources set
    loadedResources.delete(pluginId);

    // Clear all components for this plugin from cache
    Object.keys(componentCache)
      .filter((key) => key.startsWith(`${pluginId}:`))
      .forEach((key) => {
        delete componentCache[key];
        console.log(`[PluginRegistry] Removed cached component ${key}`);
      });

    // Clear the global variable (if it exists)
    const pluginNamePascal = convertPluginIdToGlobalVar(pluginId);
    const globalWindow = window as unknown as WindowWithVue;
    if (globalWindow[pluginNamePascal]) {
      delete globalWindow[pluginNamePascal];
      console.log(`[PluginRegistry] Removed global variable ${pluginNamePascal}`);
    }
  };

  /**
   * Check if a component is cached.
   *
   * @param pluginId - Plugin identifier
   * @param componentName - Component name
   * @returns true if component is in cache
   */
  const isCached = (pluginId: string, componentName: string): boolean => {
    const cacheKey = `${pluginId}:${componentName}`;
    return !!componentCache[cacheKey];
  };

  /**
   * Check if a plugin's resources (scripts/styles) are loaded.
   *
   * @param pluginId - Plugin identifier
   * @returns true if plugin resources are loaded
   */
  const isPluginLoaded = (pluginId: string): boolean => {
    return loadedResources.has(pluginId);
  };

  return {
    loadPluginComponent,
    clearCache,
    unloadPlugin,
    isCached,
    isPluginLoaded,
  };
};
