import { promises as fs, readFileSync } from "fs";
import path from "path";
import crypto from "crypto";
import { execSync, spawn, type ChildProcess } from "child_process";
import * as jwt from "jsonwebtoken";
import * as net from "net";
import { pluginRegistryRepository } from "@server/repositories/plugin-registry.repository";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { PluginRegistry, PluginStatus } from "@server/entities/plugin-registry.entity";
import type { HayPluginManifest } from "@server/types/plugin.types";
import type { HayPluginManifestV2, PluginMetadata } from "@server/types/plugin-sdk-v2.types";
import { decryptConfig } from "@server/lib/auth/utils/encryption";
import { getPluginRunnerV2Service } from "./plugin-runner-v2.service";
import type { WorkerInfo as WorkerInfoV2 } from "@server/types/plugin-sdk-v2.types";

// Legacy WorkerInfo interface (for SDK v1 compatibility)
interface WorkerInfoLegacy {
  process: ChildProcess;
  port: number;
  startedAt: Date;
  lastActivity: Date;
  metadata: PluginRegistry;
  organizationId: string;
  pluginId: string;
  instanceId: string;
  sdkVersion?: "v1" | "v2"; // Track SDK version
}

// Union type for both SDK versions
type WorkerInfo = WorkerInfoV2 | WorkerInfoLegacy;

export class PluginManagerService {
  private pluginsDir: string;
  public registry: Map<string, PluginRegistry> = new Map();

  // Worker management
  private workers: Map<string, WorkerInfo> = new Map(); // key: organizationId:pluginId
  private allocatedPorts: Set<number> = new Set();
  private readonly PORT_RANGE_START = 5000;
  private readonly PORT_RANGE_END = 6000;

  // Track discovered plugins during initialization
  private discoveredPluginIds: Set<string> = new Set();

  // SDK v2 runner service
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
   * Maintains backward compatibility with type field
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
   * Build a plugin (run build command)
   *
   * Supports both legacy SDK v1 plugins (buildCommand in manifest.capabilities.mcp)
   * and SDK v2 plugins (build script in package.json)
   */
  async buildPlugin(pluginId: string): Promise<void> {
    const plugin = this.registry.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    const manifest = plugin.manifest as HayPluginManifest;
    const pluginPath = path.join(this.pluginsDir, plugin.pluginPath);

    // Try to get build command from multiple sources:
    // 1. Legacy SDK v1: manifest.capabilities.mcp.buildCommand
    // 2. SDK v2: package.json scripts.build (run via npm run build)
    let buildCommand = manifest.capabilities?.mcp?.buildCommand;

    // If no legacy build command, check for SDK v2 package.json scripts.build
    if (!buildCommand) {
      try {
        const packageJsonPath = path.join(pluginPath, 'package.json');
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

        if (packageJson.scripts?.build) {
          buildCommand = 'npm run build';
          console.log(`ℹ️  Detected SDK v2 plugin with build script: ${plugin.name}`);
        }
      } catch (error) {
        // Ignore - package.json might not exist or be malformed
      }
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

    // TypeScript-first plugins: capabilities is an array and entry field is used
    if (Array.isArray(manifest.capabilities) && manifest.entry) {
      return `node ${manifest.entry}`;
    }

    // Legacy MCP plugins: capabilities.mcp.startCommand
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
            return path.relative(this.pluginsDir, pluginPath);
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
  // Worker Management (for TypeScript-based plugins)
  // =========================================================================

  /**
   * Detect if a plugin uses SDK v2
   *
   * SDK v2 plugins have a minimal manifest in package.json with entry point
   * Legacy plugins have full manifest with configSchema, auth, etc.
   */
  private isSDKv2Plugin(plugin: PluginRegistry): boolean {
    const manifest = plugin.manifest as any;

    // SDK v2 check: Has entry field but NO configSchema/auth in manifest
    // (metadata will be fetched from /metadata endpoint instead)
    const hasEntry = !!manifest.entry;
    const hasConfigSchema = !!manifest.configSchema && Object.keys(manifest.configSchema).length > 0;
    const hasAuth = !!manifest.auth;

    // SDK v2 = has entry, no embedded schema/auth
    return hasEntry && !hasConfigSchema && !hasAuth;
  }

  /**
   * Fetch and store metadata from SDK v2 plugin worker
   *
   * Implements retry logic with AbortController-based timeouts
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
   *
   * Automatically detects SDK version and routes to appropriate worker implementation
   */
  async startPluginWorker(organizationId: string, pluginId: string): Promise<WorkerInfo> {
    const key = `${organizationId}:${pluginId}`;

    // Return existing worker if already running
    if (this.workers.has(key)) {
      const worker = this.workers.get(key)!;
      worker.lastActivity = new Date();

      // Update last activity in database
      await pluginInstanceRepository.updateHealthCheck(worker.instanceId);

      return worker;
    }

    // Get plugin definition from registry
    const plugin = this.registry.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found in registry`);
    }

    // Detect SDK version and route to appropriate implementation
    if (this.isSDKv2Plugin(plugin)) {
      console.log(`[PluginManager] Starting SDK v2 worker: ${pluginId}`);
      return await this.startPluginWorkerV2(organizationId, pluginId, plugin);
    } else {
      console.log(`[PluginManager] Starting legacy worker: ${pluginId}`);
      return await this.startPluginWorkerLegacy(organizationId, pluginId, plugin);
    }
  }

  /**
   * Start SDK v2 plugin worker
   *
   * Uses PluginRunnerV2Service for isolated worker management
   */
  private async startPluginWorkerV2(
    organizationId: string,
    pluginId: string,
    plugin: PluginRegistry
  ): Promise<WorkerInfo> {
    const key = `${organizationId}:${pluginId}`;

    try {
      // Start worker using SDK v2 runner service
      const workerInfo = await this.runnerV2Service.startWorker(organizationId, pluginId);

      // Fetch and cache metadata (plugin-global, not per org)
      // Only fetch if: missing, stale (checksum changed), or error
      if (plugin.metadataState !== "fresh") {
        try {
          await this.fetchAndStoreMetadata(pluginId, workerInfo.port);
        } catch (error) {
          await pluginRegistryRepository.updateMetadataState(plugin.id, "error");
          console.warn(`Metadata fetch failed for ${pluginId}, cached metadata may be stale`, error);
          // Don't throw - use cached metadata if available
        }
      }

      // Store worker in plugin manager's map (for compatibility)
      this.workers.set(key, {
        ...workerInfo,
        metadata: plugin,
        sdkVersion: "v2"
      });

      return workerInfo;
    } catch (error) {
      console.error(`Failed to start SDK v2 worker for ${key}:`, error);
      throw error;
    }
  }

  /**
   * Start legacy plugin worker
   *
   * Original implementation for backward compatibility
   */
  private async startPluginWorkerLegacy(
    organizationId: string,
    pluginId: string,
    plugin: PluginRegistry
  ): Promise<WorkerInfo> {
    const key = `${organizationId}:${pluginId}`;

    // Get plugin instance from database
    const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
    if (!instance || !instance.enabled) {
      throw new Error(`Plugin ${pluginId} not enabled for organization ${organizationId}`);
    }

    // Get available port
    const port = await this.getAvailablePort();

    // Extract capabilities from manifest
    const manifest = plugin.manifest as HayPluginManifest;
    const capabilities = this.extractCapabilities(manifest);

    // Create JWT token for this plugin+org
    const apiToken = jwt.sign(
      {
        organizationId: organizationId,
        pluginId,
        scope: "plugin-api",
        capabilities,
      },
      process.env.JWT_SECRET!,
      {
        expiresIn: "24h",
        issuer: "hay-plugin-api",
        audience: "plugin",
      },
    );

    // Prepare environment variables (SECURITY: explicit allowlist only)
    const env = this.buildSafeEnv({
      organizationId,
      pluginId,
      port,
      apiToken,
      pluginConfig: this.configToEnvVars(instance.config || {}, manifest.configSchema),
      capabilities,
    });

    // Get plugin path
    const pluginPath = path.join(this.pluginsDir, plugin.pluginPath);

    // Update instance status to starting
    await pluginInstanceRepository.updateStatus(instance.id, "starting");

    try {
      // Spawn worker process
      const workerProcess = spawn("node", ["dist/index.js"], {
        cwd: pluginPath,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Log stdout
      workerProcess.stdout?.on("data", (data) => {
        console.log(`[Worker:${organizationId}:${pluginId}] ${data.toString().trim()}`);
      });

      // Log stderr
      workerProcess.stderr?.on("data", (data) => {
        console.error(`[Worker:${organizationId}:${pluginId}] ${data.toString().trim()}`);
      });

      // Handle process exit
      workerProcess.on("exit", async (code, signal) => {
        console.log(
          `[Worker:${organizationId}:${pluginId}] Exited with code ${code}, signal ${signal}`,
        );
        this.workers.delete(key);
        this.allocatedPorts.delete(port);

        // Update instance status
        await pluginInstanceRepository.updateStatus(
          instance.id,
          "stopped",
          code !== 0 ? `Process exited with code ${code}` : undefined,
        );
        await pluginInstanceRepository.updateProcessId(instance.id, null);
      });

      // Handle process errors
      workerProcess.on("error", async (error) => {
        console.error(`[Worker:${organizationId}:${pluginId}] Process error:`, error);
        this.workers.delete(key);
        this.allocatedPorts.delete(port);

        await pluginInstanceRepository.updateStatus(instance.id, "error", error.message);
      });

      // Store worker info
      const workerInfo: WorkerInfo = {
        process: workerProcess,
        port,
        startedAt: new Date(),
        lastActivity: new Date(),
        metadata: plugin,
        organizationId,
        pluginId,
        instanceId: instance.id,
        sdkVersion: "v1", // Legacy worker
      };

      this.workers.set(key, workerInfo);

      console.log(
        `[PluginManager] Started worker: ${key} on port ${port} (PID: ${workerProcess.pid})`,
      );

      // Wait for worker to be ready
      // All plugins now have HTTP server for metadata endpoint
      await this.waitForWorkerReady(port, 20);

      // Update instance status to running
      await pluginInstanceRepository.updateStatus(instance.id, "running");
      await pluginInstanceRepository.updateProcessId(
        instance.id,
        workerProcess.pid?.toString() || null,
      );

      // Fetch runtime metadata from worker (configSchema, auth, tools, etc.)
      await this.fetchAndStoreWorkerMetadata(pluginId, port);

      return workerInfo;
    } catch (error) {
      // Clean up on error
      this.allocatedPorts.delete(port);
      await pluginInstanceRepository.updateStatus(
        instance.id,
        "error",
        error instanceof Error ? error.message : "Failed to start worker",
      );
      throw error;
    }
  }

  /**
   * Get worker info (or start if not running)
   */
  async getOrStartWorker(organizationId: string, pluginId: string): Promise<WorkerInfo> {
    const key = `${organizationId}:${pluginId}`;

    if (this.workers.has(key)) {
      const worker = this.workers.get(key)!;
      worker.lastActivity = new Date();
      await pluginInstanceRepository.updateHealthCheck(worker.instanceId);
      return worker;
    }

    return await this.startPluginWorker(organizationId, pluginId);
  }

  /**
   * Stop plugin worker
   *
   * Automatically detects SDK version and routes to appropriate stop implementation
   */
  async stopPluginWorker(organizationId: string, pluginId: string): Promise<void> {
    const key = `${organizationId}:${pluginId}`;
    const worker = this.workers.get(key);

    if (!worker) {
      console.log(`[PluginManager] Worker not found: ${key}`);
      return;
    }

    // Route to appropriate stop implementation based on SDK version
    if (worker.sdkVersion === "v2") {
      console.log(`[PluginManager] Stopping SDK v2 worker: ${key}`);
      await this.runnerV2Service.stopWorker(organizationId, pluginId);
      this.workers.delete(key);
    } else {
      console.log(`[PluginManager] Stopping legacy worker: ${key}`);
      await this.stopPluginWorkerLegacy(organizationId, pluginId, worker);
    }
  }

  /**
   * Stop legacy plugin worker
   */
  private async stopPluginWorkerLegacy(
    organizationId: string,
    pluginId: string,
    worker: WorkerInfo
  ): Promise<void> {
    const key = `${organizationId}:${pluginId}`;

    // Update status to stopping
    await pluginInstanceRepository.updateStatus(worker.instanceId, "stopping");

    // Send SIGTERM for graceful shutdown
    worker.process.kill("SIGTERM");

    // Wait up to 5 seconds for graceful shutdown
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if still running
        if (this.workers.has(key)) {
          console.log(`[PluginManager] Force killing worker: ${key}`);
          worker.process.kill("SIGKILL");
        }
        resolve();
      }, 5000);

      worker.process.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.workers.delete(key);
    this.allocatedPorts.delete(worker.port);

    // Update status to stopped
    await pluginInstanceRepository.updateStatus(worker.instanceId, "stopped");
    await pluginInstanceRepository.updateProcessId(worker.instanceId, null);

    console.log(`[PluginManager] Stopped worker: ${key}`);
  }

  /**
   * Get available port for worker
   */
  private async getAvailablePort(): Promise<number> {
    for (let port = this.PORT_RANGE_START; port <= this.PORT_RANGE_END; port++) {
      if (!this.allocatedPorts.has(port) && (await this.isPortAvailable(port))) {
        this.allocatedPorts.add(port);
        return port;
      }
    }
    throw new Error("No available ports in range");
  }

  /**
   * Check if port is available
   */
  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close();
        resolve(true);
      });
      server.listen(port);
    });
  }

  /**
   * Wait for worker to be ready (health check)
   */
  private async waitForWorkerReady(port: number, maxAttempts: number = 10): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(`http://localhost:${port}/health`);
        if (response.ok) {
          console.log(`[PluginManager] Worker ready on port ${port}`);
          return;
        }
      } catch (error) {
        // Worker not ready yet, continue
      }

      // Wait 500ms before next attempt
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(`Worker failed to start after ${maxAttempts} attempts`);
  }

  /**
   * Fetch runtime metadata from plugin worker and update registry
   * This includes configSchema, auth config, tools, etc.
   */
  private async fetchAndStoreWorkerMetadata(pluginId: string, port: number): Promise<void> {
    try {
      console.log(`[PluginManager] Fetching metadata from worker ${pluginId} on port ${port}...`);

      const response = await fetch(`http://localhost:${port}/metadata`);
      if (!response.ok) {
        console.warn(`[PluginManager] Failed to fetch metadata from worker ${pluginId}: ${response.status}`);
        return;
      }

      const metadata = await response.json();

      // Update plugin registry with runtime metadata
      const plugin = this.registry.get(pluginId);
      if (!plugin) {
        console.warn(`[PluginManager] Plugin ${pluginId} not found in registry`);
        return;
      }

      // Merge runtime metadata into manifest
      const manifest = plugin.manifest as HayPluginManifest;
      const updatedManifest: HayPluginManifest = {
        ...manifest,
        configSchema: metadata.configSchema || manifest.configSchema || {},
        auth: metadata.auth || manifest.auth,
        settingsExtensions: metadata.settingsExtensions || manifest.settingsExtensions,
        // Note: tools are stored in metadata, not in manifest (they're dynamic)
      };

      // Update registry in memory and database
      plugin.manifest = updatedManifest;
      await pluginRegistryRepository.updateManifest(pluginId, updatedManifest);

      console.log(`[PluginManager] Updated metadata for plugin ${pluginId}`, {
        hasConfigSchema: Object.keys(updatedManifest.configSchema || {}).length > 0,
        hasAuth: !!updatedManifest.auth,
      });
    } catch (error) {
      console.error(`[PluginManager] Error fetching metadata from worker ${pluginId}:`, error);
      // Don't throw - metadata fetch is not critical for worker startup
    }
  }

  /**
   * Build safe environment for plugin worker
   * SECURITY: Never spread process.env - explicit allowlist only
   *
   * This method ensures plugins only receive the environment variables they need,
   * preventing access to sensitive system secrets like OPENAI_API_KEY, DB_PASSWORD, etc.
   */
  private buildSafeEnv(params: {
    organizationId: string;
    pluginId: string;
    port?: number;
    apiToken?: string;
    pluginConfig: Record<string, string>;
    capabilities: string[];
  }): Record<string, string> {
    const { organizationId, pluginId, port, apiToken, pluginConfig, capabilities } = params;

    // Get plugin manifest from registry
    const plugin = this.registry.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found in registry`);
    }

    const manifest = plugin.manifest as any;
    const allowedEnvVars = manifest.permissions?.env || [];

    // Explicit allowlist - only safe variables
    const safeEnv: Record<string, string> = {
      // Node.js runtime essentials
      NODE_ENV: process.env.NODE_ENV || "production",
      PATH: process.env.PATH || "",

      // Plugin context
      ORGANIZATION_ID: organizationId,
      PLUGIN_ID: pluginId,

      // Plugin capabilities (for self-awareness)
      HAY_CAPABILITIES: capabilities.join(","),
    };

    // Add Hay API access only if plugin has routes/messages/mcp capabilities
    if (
      capabilities.includes("routes") ||
      capabilities.includes("messages") ||
      capabilities.includes("mcp")
    ) {
      safeEnv.HAY_API_URL = process.env.API_URL || "http://localhost:3001";
      if (apiToken) {
        safeEnv.HAY_API_TOKEN = apiToken;
      }
    }

    // Add worker port (all plugins now have HTTP server for metadata endpoint)
    if (port) {
      safeEnv.HAY_WORKER_PORT = port.toString();
    }

    // Add plugin-specific config from database (already scoped and decrypted)
    Object.assign(safeEnv, pluginConfig);

    // Add explicitly allowed env vars from package.json (permissions.env)
    for (const envVar of allowedEnvVars) {
      if (process.env[envVar]) {
        safeEnv[envVar] = process.env[envVar]!;
      }
    }

    // SECURITY: NEVER include these sensitive variables:
    // - OPENAI_API_KEY (AI API credentials)
    // - DB_* (database credentials)
    // - JWT_SECRET, JWT_REFRESH_SECRET (authentication secrets)
    // - STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (payment credentials)
    // - SMTP_AUTH_PASS (email service credentials)
    // - PLUGIN_ENCRYPTION_KEY (encryption key for configs)
    // - *_OAUTH_CLIENT_SECRET (OAuth secrets)
    // - REDIS_* (Redis credentials)
    // - Any other core system secrets

    return safeEnv;
  }

  /**
   * Build minimal environment for build/install operations
   * Only includes what npm/node needs to build, no sensitive credentials
   */
  private buildMinimalEnv(): Record<string, string> {
    return {
      NODE_ENV: process.env.NODE_ENV || "production",
      PATH: process.env.PATH || "",
      HOME: process.env.HOME || "",
      // Only what npm/node needs to build
    };
  }

  /**
   * Convert plugin config to environment variables
   */
  private configToEnvVars(
    config: Record<string, unknown>,
    schema?: HayPluginManifest["configSchema"],
  ): Record<string, string> {
    const env: Record<string, string> = {};

    if (!schema) return env;

    // Decrypt config first
    const decryptedConfig = decryptConfig(config);

    for (const [key, value] of Object.entries(decryptedConfig)) {
      const fieldDef = schema[key];
      if (fieldDef?.env) {
        // Convert value to string (handle different types)
        if (typeof value === "object") {
          env[fieldDef.env] = JSON.stringify(value);
        } else if (value !== undefined && value !== null) {
          env[fieldDef.env] = String(value);
        }
      }
    }

    return env;
  }

  /**
   * Extract capabilities from manifest
   */
  private extractCapabilities(manifest: HayPluginManifest): string[] {
    const capabilities: string[] = [];

    // TypeScript-first plugins: capabilities is an array
    if (Array.isArray(manifest.capabilities)) {
      capabilities.push(...manifest.capabilities);
    } else {
      // Legacy format: capabilities is an object
      // Check for MCP capability
      if (manifest.capabilities?.mcp) {
        capabilities.push("mcp");
      }

      // Check for channel capability
      if (manifest.capabilities?.chat_connector) {
        capabilities.push("routes", "messages", "customers", "sources");
      }
    }

    // Merge with permissions.api (TypeScript-first plugins)
    if (manifest.permissions?.api && Array.isArray(manifest.permissions.api)) {
      capabilities.push(...manifest.permissions.api);
    }

    // Always allow routes if the plugin has any
    if (manifest.apiEndpoints && manifest.apiEndpoints.length > 0) {
      capabilities.push("routes");
    }

    return [...new Set(capabilities)]; // Remove duplicates
  }

  /**
   * Cleanup inactive workers
   */
  async cleanupInactiveWorkers(): Promise<void> {
    const now = new Date();

    for (const [key, worker] of this.workers.entries()) {
      const manifest = worker.metadata.manifest as HayPluginManifest;

      // Determine timeout based on plugin type
      const isChannelPlugin = manifest.type.includes("channel");
      const TIMEOUT_MS = isChannelPlugin ? 30 * 60 * 1000 : 5 * 60 * 1000; // 30min for channels, 5min for others

      const inactiveTime = now.getTime() - worker.lastActivity.getTime();

      if (inactiveTime > TIMEOUT_MS) {
        console.log(
          `[PluginManager] Cleaning up inactive worker: ${key} (inactive for ${Math.round(inactiveTime / 1000)}s)`,
        );
        await this.stopPluginWorker(worker.organizationId, worker.pluginId);
      }
    }
  }

  /**
   * Get all active workers
   */
  getActiveWorkers(): WorkerInfo[] {
    return Array.from(this.workers.values());
  }

  /**
   * Get worker by organization and plugin
   */
  getWorker(organizationId: string, pluginId: string): WorkerInfo | undefined {
    return this.workers.get(`${organizationId}:${pluginId}`);
  }
}

export const pluginManagerService = new PluginManagerService();
