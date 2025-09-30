import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import Ajv from "ajv";
import { pluginRegistryRepository } from "@server/repositories/plugin-registry.repository";
import { PluginRegistry } from "@server/entities/plugin-registry.entity";
import type { HayPluginManifest } from "@server/types/plugin.types";

export class PluginManagerService {
  private pluginsDir: string;
  private registry: Map<string, PluginRegistry> = new Map();
  private ajv: Ajv;
  private manifestSchema: Record<string, unknown> | null = null;

  constructor() {
    // Look for plugins in the root /plugins directory
    this.pluginsDir = path.join(process.cwd(), "..", "plugins");

    // Initialize AJV for JSON schema validation
    this.ajv = new Ajv({ allErrors: true });
  }

  /**
   * Initialize the plugin manager and discover all plugins
   */
  async initialize(): Promise<void> {
    console.log("🔍 Discovering plugins...");

    // Load the manifest schema
    await this.loadManifestSchema();

    await this.discoverPlugins();
    await this.loadRegistryFromDatabase();
    console.log("📦 Plugin registry loaded:");

    // Initialize auto-activated plugins
    await this.initializeAutoActivatedPlugins();
  }

  /**
   * Load the JSON schema for plugin manifests
   */
  private async loadManifestSchema(): Promise<void> {
    try {
      const schemaPath = path.join(this.pluginsDir, "base", "plugin-manifest.schema.json");
      const schemaContent = await fs.readFile(schemaPath, "utf-8");
      this.manifestSchema = JSON.parse(schemaContent);
      if (this.manifestSchema) {
        this.ajv.compile(this.manifestSchema);
      }
      console.log("✅ Loaded plugin manifest schema");
    } catch (error) {
      console.warn("⚠️  Could not load plugin manifest schema, validation will be skipped:", error);
    }
  }

  /**
   * Discover all plugins in the plugins directory
   */
  private async discoverPlugins(): Promise<void> {
    try {
      const entries = await fs.readdir(this.pluginsDir, {
        withFileTypes: true,
      });

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
      // First, try to load manifest.json
      const jsonManifestPath = path.join(pluginPath, "manifest.json");
      const jsonExists = await fs
        .access(jsonManifestPath)
        .then(() => true)
        .catch(() => false);

      let manifest: HayPluginManifest;

      if (jsonExists) {
        // Load and validate JSON manifest
        const manifestContent = await fs.readFile(jsonManifestPath, "utf-8");
        manifest = JSON.parse(manifestContent);

        // Validate manifest against schema if available
        if (this.manifestSchema) {
          const validate = this.ajv.compile(this.manifestSchema);
          const valid = validate(manifest);

          if (!valid) {
            console.warn(`⚠️  Invalid manifest at ${pluginPath}:`);
            console.warn(validate.errors);
            return;
          }
        }
      } else {
        // Fallback to TypeScript manifest for backward compatibility
        const tsManifestPath = path.join(pluginPath, "manifest.ts");
        const tsExists = await fs
          .access(tsManifestPath)
          .then(() => true)
          .catch(() => false);

        if (tsExists) {
          console.warn(
            `⚠️  Plugin at ${pluginPath} is using deprecated manifest.ts. Please migrate to manifest.json`,
          );
          const manifestModule = await import(tsManifestPath);
          manifest = manifestModule.manifest || manifestModule.default;
        } else {
          console.warn(`⚠️  No manifest.json found for plugin at ${pluginPath}`);
          return;
        }
      }

      if (!manifest || !manifest.id) {
        console.warn(`⚠️  Invalid manifest at ${pluginPath}`);
        return;
      }

      // Calculate checksum of plugin files
      const checksum = await this.calculatePluginChecksum(pluginPath);

      // Extract the plugin directory name from the full path
      const pluginDirName = path.basename(pluginPath);

      // Upsert plugin in registry
      const plugin = await pluginRegistryRepository.upsertPlugin({
        pluginId: manifest.id,
        name: manifest.name,
        version: manifest.version,
        pluginPath: pluginDirName, // Store the actual directory name
        manifest: manifest as any,
        checksum,
      });

      this.registry.set(manifest.id, plugin);
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
      this.registry.set(plugin.pluginId, plugin);
    }
  }

  /**
   * Install a plugin (run npm install)
   */
  async installPlugin(pluginId: string): Promise<void> {
    const plugin = this.registry.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    const manifest = plugin.manifest as HayPluginManifest;
    const installCommand = manifest.capabilities?.mcp?.installCommand;

    if (!installCommand) {
      console.log(`ℹ️  No install command for plugin ${plugin.name}`);
      await pluginRegistryRepository.updateInstallStatus(plugin.id, true);
      return;
    }

    try {
      console.log(`📦 Installing plugin ${plugin.name}...`);
      const pluginPath = path.join(this.pluginsDir, plugin.pluginPath);

      execSync(installCommand, {
        cwd: pluginPath,
        stdio: "inherit",
        env: { ...process.env },
      });

      await pluginRegistryRepository.updateInstallStatus(plugin.id, true);
      plugin.installed = true;
      console.log(`✅ [HAY OK] Plugin ${plugin.name} installed successfully`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await pluginRegistryRepository.updateInstallStatus(plugin.id, false, errorMessage);
      plugin.installed = false;
      console.error(`❌ [HAY FAILED] Plugin ${plugin.name} installation failed`);
      throw new Error(`Failed to install plugin ${plugin.name}: ${errorMessage}`);
    }
  }

  /**
   * Build a plugin (run build command)
   */
  async buildPlugin(pluginId: string): Promise<void> {
    const plugin = this.registry.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    const manifest = plugin.manifest as HayPluginManifest;
    const buildCommand = manifest.capabilities?.mcp?.buildCommand;

    if (!buildCommand) {
      console.log(`ℹ️  No build command for plugin ${plugin.name}`);
      await pluginRegistryRepository.updateBuildStatus(plugin.id, true);
      return;
    }

    try {
      console.log(`🔨 Building plugin ${plugin.name}...`);
      const pluginPath = path.join(this.pluginsDir, plugin.pluginPath);

      execSync(buildCommand, {
        cwd: pluginPath,
        stdio: "inherit",
        env: { ...process.env },
      });

      await pluginRegistryRepository.updateBuildStatus(plugin.id, true);
      plugin.built = true;
      console.log(`✅ [HAY OK] Plugin ${plugin.name} built successfully`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await pluginRegistryRepository.updateBuildStatus(plugin.id, false, errorMessage);
      plugin.built = false;
      console.error(`❌ [HAY FAILED] Plugin ${plugin.name} build failed`);
      throw new Error(`Failed to build plugin ${plugin.name}: ${errorMessage}`);
    }
  }

  /**
   * Get all registered plugins
   */
  getAllPlugins(): PluginRegistry[] {
    return Array.from(this.registry.values());
  }

  /**
   * Get a plugin by ID
   */
  getPlugin(pluginId: string): PluginRegistry | undefined {
    return this.registry.get(pluginId);
  }

  /**
   * Check if a plugin needs installation
   */
  needsInstallation(pluginId: string): boolean {
    const plugin = this.registry.get(pluginId);
    return plugin ? !plugin.installed : true;
  }

  /**
   * Check if a plugin needs building
   */
  needsBuilding(pluginId: string): boolean {
    const plugin = this.registry.get(pluginId);
    return plugin ? !plugin.built : true;
  }

  /**
   * Get plugin start command
   */
  getStartCommand(pluginId: string): string | undefined {
    const plugin = this.registry.get(pluginId);
    if (!plugin) return undefined;

    const manifest = plugin.manifest as HayPluginManifest;
    return manifest.capabilities?.mcp?.startCommand;
  }

  /**
   * Initialize auto-activated plugins
   */
  private async initializeAutoActivatedPlugins(): Promise<void> {
    const { pluginRouterRegistry } = await import("./plugin-router-registry.service");

    for (const plugin of this.registry.values()) {
      const manifest = plugin.manifest as HayPluginManifest;

      if (manifest.autoActivate && manifest.trpcRouter) {
        try {
          // Dynamically import the plugin's router using the stored plugin path
          const routerPath = path.join(this.pluginsDir, plugin.pluginPath, manifest.trpcRouter);
          console.log(`Loading router from: ${routerPath}`);
          const routerModule = await import(routerPath);
          const pluginRouter = routerModule.default || routerModule.router;

          if (pluginRouter) {
            // Register with the manifest ID, not the directory name
            const registerId = manifest.id || plugin.pluginId;
            pluginRouterRegistry.registerRouter(registerId, pluginRouter);
            console.log(
              `✅ Auto-activated router for plugin: ${plugin.name} with ID: ${registerId}`,
            );
          }
        } catch (error) {
          console.warn(`⚠️ Could not load router for plugin ${plugin.name}:`, error);
        }
      }
    }
  }

  /**
   * Get the actual folder name for a plugin by scanning the filesystem
   */
  async getPluginFolderName(pluginId: string): Promise<string | null> {
    try {
      const entries = await fs.readdir(this.pluginsDir, {
        withFileTypes: true,
      });

      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== "base") {
          const pluginPath = path.join(this.pluginsDir, entry.name);

          // Check for manifest.json first
          const jsonManifestPath = path.join(pluginPath, "manifest.json");
          const jsonExists = await fs
            .access(jsonManifestPath)
            .then(() => true)
            .catch(() => false);

          let manifest: HayPluginManifest | null = null;

          if (jsonExists) {
            try {
              const manifestContent = await fs.readFile(jsonManifestPath, "utf-8");
              manifest = JSON.parse(manifestContent);
            } catch (error) {
              // Skip this folder if manifest is invalid
              continue;
            }
          } else {
            // Fallback to TypeScript manifest
            const tsManifestPath = path.join(pluginPath, "manifest.ts");
            const tsExists = await fs
              .access(tsManifestPath)
              .then(() => true)
              .catch(() => false);

            if (tsExists) {
              try {
                const manifestModule = await import(tsManifestPath);
                manifest = manifestModule.manifest || manifestModule.default;
              } catch (error) {
                // Skip this folder if manifest is invalid
                continue;
              }
            }
          }

          if (manifest && manifest.id === pluginId) {
            return entry.name;
          }
        }
      }

      return null;
    } catch (error) {
      console.error(`Failed to find folder for plugin ${pluginId}:`, error);
      return null;
    }
  }
}

export const pluginManagerService = new PluginManagerService();
