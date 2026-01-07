import { promises as fs, readFileSync } from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import { pluginRegistryRepository } from "@server/repositories/plugin-registry.repository";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { PluginRegistry, PluginStatus } from "@server/entities/plugin-registry.entity";
import type { HayPluginManifest } from "@server/types/plugin.types";
import { getPluginRunnerV2Service } from "./plugin-runner-v2.service";
import type { WorkerInfo } from "@server/types/plugin-sdk-v2.types";

export class PluginManagerService {
  private pluginsDir: string;
  public registry: Map<string, PluginRegistry> = new Map();

  // Track discovered plugins during initialization
  private discoveredPluginIds: Set<string> = new Set();

  // SDK v2 runner service - single source of truth for all worker management
  private runnerV2Service = getPluginRunnerV2Service();

  constructor() {
    // Look for plugins in the root /plugins directory
    this.pluginsDir = path.join(process.cwd(), "..", "plugins");
  }

  /**
   * Initialize the plugin manager and discover all plugins
   */
  async initialize(): Promise<void> {
    console.log("🔍 Discovering plugins...");

    // Clear discovered set for fresh initialization
    this.discoveredPluginIds.clear();

    await this.discoverPlugins();
    await this.loadRegistryFromDatabase();

    // Validate existing plugins and mark missing ones
    await this.validateExistingPlugins();

    // Restore plugins from ZIP if directories are missing
    await this.restorePluginsFromZip();

    console.log("📦 Plugin registry loaded:");

    // Initialize auto-activated plugins
    await this.initializeAutoActivatedPlugins();
  }

  /**
   * Discover all plugins in the plugins directory
   */
  private async discoverPlugins(): Promise<void> {
    try {
      // Scan core plugins
      const coreDir = path.join(this.pluginsDir, "core");
      const coreExists = await fs
        .access(coreDir)
        .then(() => true)
        .catch(() => false);

      if (coreExists) {
        await this.scanPluginDirectory(coreDir, "core", null);
      }

      // Scan custom plugins for all organizations
      const customDir = path.join(this.pluginsDir, "custom");
      const customExists = await fs
        .access(customDir)
        .then(() => true)
        .catch(() => false);

      if (customExists) {
        const orgDirs = await fs.readdir(customDir, { withFileTypes: true });

        for (const orgDir of orgDirs) {
          if (orgDir.isDirectory() && !orgDir.name.startsWith(".")) {
            const organizationId = orgDir.name;
            const orgPath = path.join(customDir, organizationId);
            await this.scanPluginDirectory(orgPath, "custom", organizationId);
          }
        }
      }
    } catch (error) {
      console.error("Failed to discover plugins:", error);
    }
  }

  /**
   * Scan a specific directory for plugins
   */
  private async scanPluginDirectory(
    directory: string,
    sourceType: "core" | "custom",
    organizationId: string | null,
  ): Promise<void> {
    try {
      const dirExists = await fs
        .access(directory)
        .then(() => true)
        .catch(() => false);

      if (!dirExists) {
        return;
      }

      const entries = await fs.readdir(directory, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          const pluginPath = path.join(directory, entry.name);
          await this.registerPlugin(pluginPath, sourceType, organizationId);
        }
      }
    } catch (error) {
      console.error(`Failed to scan plugin directory ${directory}:`, error);
    }
  }

  /**
   * Register a single plugin from its directory
   *
   * Reads package.json to discover plugins (TypeScript-first approach).
   * Full metadata is fetched from the plugin worker when it starts.
   */
  public async registerPlugin(
    pluginPath: string,
    sourceType: "core" | "custom",
    organizationId: string | null,
  ): Promise<void> {
    try {
      // Load package.json for plugin discovery
      const packagePath = path.join(pluginPath, "package.json");
      const packageExists = await fs
        .access(packagePath)
        .then(() => true)
        .catch(() => false);

      if (!packageExists) {
        console.warn(`⚠️  No package.json found for plugin at ${pluginPath}`);
        return;
      }

      const packageContent = await fs.readFile(packagePath, "utf-8");
      const packageJson = JSON.parse(packageContent);

      // Check if this is a Hay plugin
      if (!packageJson["hay-plugin"]) {
        // Not a Hay plugin, skip silently
        return;
      }

      const hayPlugin = packageJson["hay-plugin"];

      // Plugin ID comes from NPM package name
      const pluginId = packageJson.name;

      if (!pluginId) {
        console.warn(`⚠️  No package name found at ${pluginPath}`);
        return;
      }

      // Display name from hay-plugin or parse from package name
      const displayName = hayPlugin.displayName || this.parseDisplayName(pluginId);

      // Build full manifest from package.json
      const manifest: any = {
        id: pluginId,
        name: displayName,
        version: packageJson.version || "1.0.0",
        description: packageJson.description || "",
        author: packageJson.author,
        category: hayPlugin.category,
        icon: "./thumbnail.jpg", // Convention: always thumbnail.jpg
        type: this.inferTypeFromCapabilities(hayPlugin.capabilities || []),
        entry: hayPlugin.entry,
        capabilities: hayPlugin.capabilities || [],
        configSchema: hayPlugin.config || {},
        permissions: {
          env: hayPlugin.env || [],
          api: hayPlugin.capabilities || [],
        },
        auth: hayPlugin.auth || undefined, // Include auth config if present
      };

      // Calculate checksum of plugin files
      const checksum = await this.calculatePluginChecksum(pluginPath);

      // Calculate relative plugin path from plugins root
      const relativePath = path.relative(this.pluginsDir, pluginPath);

      // Upsert plugin in registry with source metadata
      const plugin = await pluginRegistryRepository.upsertPlugin({
        pluginId: manifest.id,
        name: manifest.name,
        version: manifest.version,
        pluginPath: relativePath, // e.g., "core/stripe" or "custom/{organizationId}/{pluginId}"
        manifest: manifest as any,
        checksum,
        sourceType,
        organizationId: organizationId || undefined,
      });

      this.registry.set(manifest.id, plugin);
      this.discoveredPluginIds.add(manifest.id); // Track as discovered
      console.log(`✅ Registered plugin: ${pluginId} from ${relativePath}`);
    } catch (error) {
      console.error(`Failed to register plugin at ${pluginPath}:`, error);
    }
  }

  /**
   * Parse display name from package name
   * @example "@hay/plugin-hubspot" => "HubSpot"
   * @example "my-plugin" => "My Plugin"
   */
  private parseDisplayName(packageName: string): string {
    // Remove scope (@hay/)
    let name = packageName.replace(/^@[^/]+\//, "");

    // Remove plugin- prefix
    name = name.replace(/^plugin-/, "");

    // Convert kebab-case to Title Case
    return name
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  /**
   * Infer plugin type from capabilities
   */
  private inferTypeFromCapabilities(capabilities: string[]): string[] {
    const types: string[] = [];

    if (capabilities.includes("mcp")) {
      types.push("mcp-connector");
    }
    if (capabilities.includes("routes") || capabilities.includes("messages")) {
      types.push("channel");
    }
    if (capabilities.includes("sources")) {
      types.push("retriever");
    }

    return types.length > 0 ? types : ["mcp-connector"];
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
   * Validate existing plugins in database and mark missing ones as not_found
   */
  private async validateExistingPlugins(): Promise<void> {
    try {
      // Get all plugins from database
      const allPlugins = await pluginRegistryRepository.findAll();

      // Find plugins in DB but not discovered on filesystem
      const missingPlugins = allPlugins.filter(
        (plugin) => !this.discoveredPluginIds.has(plugin.pluginId),
      );

      if (missingPlugins.length > 0) {
        console.log(
          `⚠️  Found ${missingPlugins.length} plugin(s) in database but not on filesystem`,
        );

        // Mark each missing plugin as not_found
        for (const plugin of missingPlugins) {
          await pluginRegistryRepository.updateStatus(plugin.id, PluginStatus.NOT_FOUND);

          // Update in-memory registry as well
          const registryPlugin = this.registry.get(plugin.pluginId);
          if (registryPlugin) {
            registryPlugin.status = PluginStatus.NOT_FOUND;
          }

          console.log(`   - ${plugin.pluginId} marked as not_found`);
        }
      }
    } catch (error) {
      console.error("Failed to validate existing plugins:", error);
    }
  }

  /**
   * Restore plugins from stored ZIP files if directories are missing
   */
  private async restorePluginsFromZip(): Promise<void> {
    try {
      const { storageService } = await import("./storage.service");
      const AdmZip = (await import("adm-zip")).default;

      // Get all custom plugins that have ZIP uploads
      const customPlugins = Array.from(this.registry.values()).filter(
        (plugin) => plugin.sourceType === "custom" && plugin.zipUploadId,
      );

      if (customPlugins.length === 0) {
        return;
      }

      console.log(`🔄 Checking ${customPlugins.length} custom plugins for restoration...`);

      for (const plugin of customPlugins) {
        try {
          // Check if plugin directory exists
          const pluginPath = path.join(this.pluginsDir, plugin.pluginPath);
          const dirExists = await fs
            .access(pluginPath)
            .then(() => true)
            .catch(() => false);

          if (!dirExists && plugin.zipUploadId) {
            console.log(`📥 Restoring plugin ${plugin.name} from ZIP...`);

            // Download ZIP from storage
            const { buffer } = await storageService.download(plugin.zipUploadId);

            // Extract ZIP to file system
            const zip = new AdmZip(buffer);

            // Create organization directory if needed
            const orgDir = path.dirname(pluginPath);
            if (
              !(await fs
                .access(orgDir)
                .then(() => true)
                .catch(() => false))
            ) {
              await fs.mkdir(orgDir, { recursive: true });
            }

            // Extract to plugin directory
            zip.extractAllTo(pluginPath, true);

            console.log(`✅ Restored plugin ${plugin.name} to ${plugin.pluginPath}`);
          }
        } catch (error) {
          console.error(`❌ Failed to restore plugin ${plugin.name}:`, error);
        }
      }
    } catch (error) {
      console.error("Failed to restore plugins from ZIP:", error);
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

    const pluginPath = path.join(this.pluginsDir, plugin.pluginPath);

    // Check for npm install in package.json
    let installCommand: string | undefined;
    try {
      const packageJsonPath = path.join(pluginPath, "package.json");
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

      // Only run npm install if there are dependencies
      if (packageJson.dependencies || packageJson.devDependencies) {
        installCommand = "npm install";
      }
    } catch (error) {
      // Ignore - package.json might not exist
    }

    if (!installCommand) {
      console.log(`ℹ️  No install command for plugin ${plugin.name}`);
      await pluginRegistryRepository.updateInstallStatus(plugin.id, true);
      return;
    }

    try {
      console.log(`📦 Installing plugin ${plugin.name}...`);

      execSync(installCommand, {
        cwd: pluginPath,
        stdio: "inherit",
        env: this.buildMinimalEnv(),
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
   * Build a plugin (run build command from package.json)
   */
  async buildPlugin(pluginId: string): Promise<void> {
    const plugin = this.registry.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    const pluginPath = path.join(this.pluginsDir, plugin.pluginPath);

    // Check for build script in package.json
    let buildCommand: string | undefined;
    try {
      const packageJsonPath = path.join(pluginPath, "package.json");
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

      if (packageJson.scripts?.build) {
        buildCommand = "npm run build";
      }
    } catch (error) {
      // Ignore - package.json might not exist
    }

    if (!buildCommand) {
      console.log(`ℹ️  No build command for plugin ${plugin.name}`);
      await pluginRegistryRepository.updateBuildStatus(plugin.id, true);
      return;
    }

    try {
      console.log(`🔨 Building plugin ${plugin.name}...`);
      console.log(`   Command: ${buildCommand}`);
      console.log(`   Path: ${pluginPath}`);

      execSync(buildCommand, {
        cwd: pluginPath,
        stdio: "inherit",
        env: this.buildMinimalEnv(),
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

    // SDK v2 plugins use entry field
    if (manifest.entry) {
      return `node ${manifest.entry}`;
    }

    return undefined;
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
      // First check if we have it in registry (faster)
      const plugin = this.registry.get(pluginId);
      if (plugin && plugin.pluginPath) {
        return plugin.pluginPath;
      }

      // Fallback: scan directories
      const dirsToScan = [path.join(this.pluginsDir, "core"), path.join(this.pluginsDir, "custom")];

      for (const baseDir of dirsToScan) {
        const baseDirExists = await fs
          .access(baseDir)
          .then(() => true)
          .catch(() => false);

        if (!baseDirExists) continue;

        const result = await this.scanForPluginId(baseDir, pluginId);
        if (result) {
          return result;
        }
      }

      return null;
    } catch (error) {
      console.error(`Failed to find folder for plugin ${pluginId}:`, error);
      return null;
    }
  }

  /**
   * Recursively scan directory for a specific plugin ID
   */
  private async scanForPluginId(directory: string, pluginId: string): Promise<string | null> {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          const pluginPath = path.join(directory, entry.name);

          // Check package.json for plugin ID
          const packageJsonPath = path.join(pluginPath, "package.json");
          try {
            const packageContent = await fs.readFile(packageJsonPath, "utf-8");
            const packageJson = JSON.parse(packageContent);

            if (packageJson.name === pluginId && packageJson["hay-plugin"]) {
              return path.relative(this.pluginsDir, pluginPath);
            }
          } catch (error) {
            // Skip this folder if package.json is missing/invalid
          }

          // Recursively search subdirectories (for custom org folders)
          const subdirs = await fs.readdir(pluginPath, { withFileTypes: true });
          const hasSubdirs = subdirs.some((d) => d.isDirectory() && !d.name.startsWith("."));

          if (hasSubdirs) {
            const result = await this.scanForPluginId(pluginPath, pluginId);
            if (result) {
              return result;
            }
          }
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  // =========================================================================
  // Worker Management - Delegates to PluginRunnerV2Service
  // =========================================================================

  /**
   * Fetch and store metadata from plugin worker
   */
  private async fetchAndStoreMetadata(pluginId: string, port: number): Promise<void> {
    const { fetchMetadataFromWorker } = await import("./plugin-metadata.service");

    try {
      // Fetch metadata using shared service with retry logic
      const metadata = await fetchMetadataFromWorker(port, pluginId);

      // Store in database
      await pluginRegistryRepository.updateMetadata(pluginId, {
        metadata,
        metadataFetchedAt: new Date(),
        metadataState: "fresh",
      });

      // Update in-memory registry
      const plugin = this.registry.get(pluginId);
      if (plugin) {
        plugin.metadata = metadata;
        plugin.metadataFetchedAt = new Date();
        plugin.metadataState = "fresh";
      }

      console.log(`✅ Fetched and cached metadata for ${pluginId}`);
    } catch (error) {
      console.error(`Failed to fetch metadata for ${pluginId}:`, error);
      throw error;
    }
  }

  /**
   * Start plugin worker for an organization
   * Delegates to PluginRunnerV2Service (single source of truth)
   */
  async startPluginWorker(organizationId: string, pluginId: string): Promise<WorkerInfo> {
    const key = `${organizationId}:${pluginId}`;

    // Check if worker is already running in the runner service
    const existingWorker = this.runnerV2Service.getWorker(organizationId, pluginId);
    if (existingWorker) {
      console.log(`[PluginManager] Worker already running for ${key}, reusing existing worker`);
      existingWorker.lastActivity = new Date();
      await pluginInstanceRepository.updateHealthCheck(existingWorker.instanceId, "healthy");
      return existingWorker;
    }

    // Get plugin definition from registry
    const plugin = this.registry.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found in registry`);
    }

    console.log(`[PluginManager] Starting worker: ${pluginId}`);

    try {
      // Start worker using SDK v2 runner service (source of truth)
      const workerInfo = await this.runnerV2Service.startWorker(organizationId, pluginId);

      // Fetch and cache metadata (plugin-global, not per org)
      // Only fetch if: missing, stale (checksum changed), or error
      if (plugin.metadataState !== "fresh") {
        try {
          await this.fetchAndStoreMetadata(pluginId, workerInfo.port);
        } catch (error) {
          await pluginRegistryRepository.updateMetadataState(plugin.id, "error");
          console.warn(
            `Metadata fetch failed for ${pluginId}, cached metadata may be stale`,
            error,
          );
          // Don't throw - use cached metadata if available
        }
      }

      return workerInfo;
    } catch (error) {
      // If worker is already running (race condition), try to get it
      if (error instanceof Error && error.message.includes("Worker already running")) {
        console.log(
          `[PluginManager] Caught "already running" error, attempting to get existing worker for ${key}`,
        );
        const existingWorker = this.runnerV2Service.getWorker(organizationId, pluginId);
        if (existingWorker) {
          console.log(`[PluginManager] Successfully retrieved existing worker for ${key}`);
          return existingWorker;
        }
      }

      console.error(`Failed to start worker for ${key}:`, error);
      throw error;
    }
  }

  /**
   * Get worker info (or start if not running)
   * Delegates to PluginRunnerV2Service (single source of truth)
   */
  async getOrStartWorker(organizationId: string, pluginId: string): Promise<WorkerInfo> {
    // Check the RunnerV2 service for worker state (single source of truth)
    const existingWorker = this.runnerV2Service.getWorker(organizationId, pluginId);

    if (existingWorker) {
      existingWorker.lastActivity = new Date();
      await pluginInstanceRepository.updateHealthCheck(existingWorker.instanceId, "healthy");
      return existingWorker;
    }

    // No worker running - start one
    return await this.startPluginWorker(organizationId, pluginId);
  }

  /**
   * Stop plugin worker
   * Delegates to PluginRunnerV2Service (single source of truth)
   */
  async stopPluginWorker(organizationId: string, pluginId: string): Promise<void> {
    console.log(`[PluginManager] Stopping worker: ${organizationId}:${pluginId}`);
    await this.runnerV2Service.stopWorker(organizationId, pluginId);
  }

  /**
   * Build minimal environment for build/install operations
   */
  private buildMinimalEnv(): Record<string, string> {
    return {
      NODE_ENV: process.env.NODE_ENV || "production",
      PATH: process.env.PATH || "",
      HOME: process.env.HOME || "",
    };
  }

  /**
   * Cleanup inactive workers
   * Uses PluginRunnerV2Service as the source of truth for active workers
   */
  async cleanupInactiveWorkers(): Promise<void> {
    const now = new Date();
    const allWorkers = this.runnerV2Service.getAllWorkers();

    for (const worker of allWorkers) {
      const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
      const inactiveTime = now.getTime() - worker.lastActivity.getTime();

      if (inactiveTime > TIMEOUT_MS) {
        const key = `${worker.organizationId}:${worker.pluginId}`;
        console.log(
          `[PluginManager] Cleaning up inactive worker: ${key} (inactive for ${Math.round(inactiveTime / 1000)}s)`,
        );
        await this.stopPluginWorker(worker.organizationId, worker.pluginId);
      }
    }
  }

  /**
   * Get all active workers
   * Delegates to PluginRunnerV2Service (single source of truth)
   */
  getActiveWorkers(): WorkerInfo[] {
    return this.runnerV2Service.getAllWorkers();
  }

  /**
   * Get worker by organization and plugin
   * Delegates to PluginRunnerV2Service (single source of truth)
   */
  getWorker(organizationId: string, pluginId: string): WorkerInfo | undefined {
    return this.runnerV2Service.getWorker(organizationId, pluginId);
  }
}

export const pluginManagerService = new PluginManagerService();
