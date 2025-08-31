import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import { pluginRegistryRepository } from "@server/repositories/plugin-registry.repository";
import { PluginRegistry } from "@server/entities/plugin-registry.entity";
import type { HayPluginManifest } from "@server/types/plugin.types";

export class PluginManagerService {
  private pluginsDir: string;
  private registry: Map<string, PluginRegistry> = new Map();

  constructor() {
    // Look for plugins in the root /plugins directory
    this.pluginsDir = path.join(process.cwd(), "..", "plugins");
  }

  /**
   * Initialize the plugin manager and discover all plugins
   */
  async initialize(): Promise<void> {
    console.log("🔍 Discovering plugins...");
    await this.discoverPlugins();
    await this.loadRegistryFromDatabase();
  }

  /**
   * Discover all plugins in the plugins directory
   */
  private async discoverPlugins(): Promise<void> {
    try {
      const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== "base") {
          const pluginPath = path.join(this.pluginsDir, entry.name);
          await this.registerPlugin(pluginPath);
        }
      }
    } catch (error) {
      console.error("Failed to discover plugins:", error);
    }
  }

  /**
   * Register a single plugin from its directory
   */
  private async registerPlugin(pluginPath: string): Promise<void> {
    try {
      const manifestPath = path.join(pluginPath, "manifest.ts");
      const manifestExists = await fs.access(manifestPath).then(() => true).catch(() => false);
      
      if (!manifestExists) {
        console.warn(`⚠️  No manifest found for plugin at ${pluginPath}`);
        return;
      }

      // Import the manifest dynamically
      const manifestModule = await import(manifestPath);
      const manifest: HayPluginManifest = manifestModule.manifest || manifestModule.default;
      
      if (!manifest || !manifest.name) {
        console.warn(`⚠️  Invalid manifest at ${pluginPath}`);
        return;
      }

      // Calculate checksum of plugin files
      const checksum = await this.calculatePluginChecksum(pluginPath);
      
      // Upsert plugin in registry
      const plugin = await pluginRegistryRepository.upsertPlugin({
        name: manifest.name,
        version: manifest.version,
        manifest: manifest as any,
        checksum,
      });
      
      this.registry.set(manifest.name, plugin);
      console.log(`✅ Registered plugin: ${manifest.name} v${manifest.version}`);
    } catch (error) {
      console.error(`Failed to register plugin at ${pluginPath}:`, error);
    }
  }

  /**
   * Calculate checksum of plugin files for change detection
   */
  private async calculatePluginChecksum(pluginPath: string): Promise<string> {
    const hash = crypto.createHash("sha256");
    
    async function processDirectory(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") {
          await processDirectory(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
          const content = await fs.readFile(fullPath);
          hash.update(content);
        }
      }
    }
    
    await processDirectory(pluginPath);
    return hash.digest("hex");
  }

  /**
   * Load plugin registry from database
   */
  private async loadRegistryFromDatabase(): Promise<void> {
    const plugins = await pluginRegistryRepository.getAllPlugins();
    for (const plugin of plugins) {
      this.registry.set(plugin.name, plugin);
    }
  }

  /**
   * Install a plugin (run npm install)
   */
  async installPlugin(pluginName: string): Promise<void> {
    const plugin = this.registry.get(pluginName);
    if (!plugin) {
      throw new Error(`Plugin ${pluginName} not found`);
    }

    const manifest = plugin.manifest as HayPluginManifest;
    const installCommand = manifest.capabilities?.mcp?.installCommand;
    
    if (!installCommand) {
      console.log(`ℹ️  No install command for plugin ${pluginName}`);
      await pluginRegistryRepository.updateInstallStatus(plugin.id, true);
      return;
    }

    try {
      console.log(`📦 Installing plugin ${pluginName}...`);
      const pluginPath = path.join(this.pluginsDir, pluginName.replace("hay-plugin-", ""));
      
      execSync(installCommand, {
        cwd: pluginPath,
        stdio: "inherit",
        env: { ...process.env },
      });
      
      await pluginRegistryRepository.updateInstallStatus(plugin.id, true);
      plugin.installed = true;
      console.log(`✅ Plugin ${pluginName} installed successfully`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await pluginRegistryRepository.updateInstallStatus(plugin.id, false, errorMessage);
      plugin.installed = false;
      throw new Error(`Failed to install plugin ${pluginName}: ${errorMessage}`);
    }
  }

  /**
   * Build a plugin (run build command)
   */
  async buildPlugin(pluginName: string): Promise<void> {
    const plugin = this.registry.get(pluginName);
    if (!plugin) {
      throw new Error(`Plugin ${pluginName} not found`);
    }

    const manifest = plugin.manifest as HayPluginManifest;
    const buildCommand = manifest.capabilities?.mcp?.buildCommand;
    
    if (!buildCommand) {
      console.log(`ℹ️  No build command for plugin ${pluginName}`);
      await pluginRegistryRepository.updateBuildStatus(plugin.id, true);
      return;
    }

    try {
      console.log(`🔨 Building plugin ${pluginName}...`);
      const pluginPath = path.join(this.pluginsDir, pluginName.replace("hay-plugin-", ""));
      
      execSync(buildCommand, {
        cwd: pluginPath,
        stdio: "inherit",
        env: { ...process.env },
      });
      
      await pluginRegistryRepository.updateBuildStatus(plugin.id, true);
      plugin.built = true;
      console.log(`✅ Plugin ${pluginName} built successfully`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await pluginRegistryRepository.updateBuildStatus(plugin.id, false, errorMessage);
      plugin.built = false;
      throw new Error(`Failed to build plugin ${pluginName}: ${errorMessage}`);
    }
  }

  /**
   * Get all registered plugins
   */
  getAllPlugins(): PluginRegistry[] {
    return Array.from(this.registry.values());
  }

  /**
   * Get a plugin by name
   */
  getPlugin(name: string): PluginRegistry | undefined {
    return this.registry.get(name);
  }

  /**
   * Check if a plugin needs installation
   */
  needsInstallation(pluginName: string): boolean {
    const plugin = this.registry.get(pluginName);
    return plugin ? !plugin.installed : true;
  }

  /**
   * Check if a plugin needs building
   */
  needsBuilding(pluginName: string): boolean {
    const plugin = this.registry.get(pluginName);
    return plugin ? !plugin.built : true;
  }

  /**
   * Get plugin start command
   */
  getStartCommand(pluginName: string): string | undefined {
    const plugin = this.registry.get(pluginName);
    if (!plugin) return undefined;
    
    const manifest = plugin.manifest as HayPluginManifest;
    return manifest.capabilities?.mcp?.startCommand;
  }
}

export const pluginManagerService = new PluginManagerService();