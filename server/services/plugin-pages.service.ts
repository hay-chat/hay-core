import { promises as fs } from "fs";
import path from "path";
import { pluginManagerService } from "./plugin-manager.service";

export class PluginPagesService {
  private dashboardPagesDir: string;
  private pluginPagesMap: Map<string, string[]> = new Map();

  constructor() {
    // Dashboard pages directory
    this.dashboardPagesDir = path.join(process.cwd(), "..", "dashboard", "pages", "plugins");
  }

  /**
   * Initialize plugin pages management
   */
  async initialize(): Promise<void> {
    console.log("🔍 Initializing plugin pages...");

    // Ensure plugins pages directory exists in dashboard
    await this.ensurePluginsPagesDirectory();

    // Sync plugin pages
    await this.syncAllPluginPages();
  }

  /**
   * Ensure the plugins pages directory exists in dashboard
   */
  private async ensurePluginsPagesDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.dashboardPagesDir, { recursive: true });
    } catch (error) {
      console.error("Failed to create plugins pages directory:", error);
    }
  }

  /**
   * Sync all plugin pages with dashboard
   */
  async syncAllPluginPages(): Promise<void> {
    const plugins = pluginManagerService.getAllPlugins();

    for (const plugin of plugins) {
      const manifest = plugin.manifest as any;

      // Only process system plugins (autoActivate)
      // Organization-specific plugins would be handled separately when enabled
      if (manifest.autoActivate) {
        await this.syncPluginPages(plugin.pluginId);
      }
    }
  }

  /**
   * Sync pages for a specific plugin
   */
  async syncPluginPages(pluginId: string): Promise<void> {
    // Map plugin ID to actual directory name
    // e.g., "hay-plugin-cloud" -> "cloud", or just use the ID if it's already simple
    let pluginDirName = pluginId;
    if (pluginId.startsWith("hay-plugin-")) {
      pluginDirName = pluginId.replace("hay-plugin-", "");
    }

    const pluginDir = path.join(process.cwd(), "..", "plugins", pluginDirName);
    // First check public/pages, then fallback to root pages directory
    const pluginPublicPagesDir = path.join(pluginDir, "public", "pages");
    const pluginPagesDir = path.join(pluginDir, "pages");

    try {
      // Check if plugin has pages directory (try public first)
      let actualPagesDir = pluginPublicPagesDir;
      let pagesExist = await fs
        .access(pluginPublicPagesDir)
        .then(() => true)
        .catch(() => false);

      // If not in public, check root directory
      if (!pagesExist) {
        actualPagesDir = pluginPagesDir;
        pagesExist = await fs
          .access(pluginPagesDir)
          .then(() => true)
          .catch(() => false);
      }

      if (!pagesExist) {
        return;
      }

      // Create plugin-specific directory in dashboard
      const dashboardPluginDir = path.join(this.dashboardPagesDir, pluginId);
      await fs.mkdir(dashboardPluginDir, { recursive: true });

      // Read all pages from plugin
      const pages = await fs.readdir(actualPagesDir);
      const vuePages = pages.filter((f) => f.endsWith(".vue"));

      // Create symlinks for each page
      for (const page of vuePages) {
        const sourcePath = path.join(actualPagesDir, page);
        const targetPath = path.join(dashboardPluginDir, page);

        // Remove existing symlink if it exists
        try {
          await fs.unlink(targetPath);
        } catch {}

        // Create new symlink
        await fs.symlink(path.relative(path.dirname(targetPath), sourcePath), targetPath);
      }

      // Track pages for this plugin
      this.pluginPagesMap.set(pluginId, vuePages);

      console.log(`✅ Synced ${vuePages.length} pages for plugin ${pluginId}`);
    } catch (error) {
      console.error(`Failed to sync pages for plugin ${pluginId}:`, error);
    }
  }

  /**
   * Remove pages for a specific plugin
   */
  async removePluginPages(pluginId: string): Promise<void> {
    const dashboardPluginDir = path.join(this.dashboardPagesDir, pluginId);

    try {
      // Remove the entire plugin pages directory
      await fs.rm(dashboardPluginDir, { recursive: true, force: true });

      // Remove from map
      this.pluginPagesMap.delete(pluginId);

      console.log(`🗑️ Removed pages for plugin ${pluginId}`);
    } catch (error) {
      console.error(`Failed to remove pages for plugin ${pluginId}:`, error);
    }
  }

  /**
   * Get mapped pages for all plugins
   */
  getPluginPagesMap(): Map<string, string[]> {
    return this.pluginPagesMap;
  }
}

export const pluginPagesService = new PluginPagesService();
