import { promises as fs, readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import { pluginRegistryRepository } from "@server/repositories/plugin-registry.repository";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { PluginRegistry, PluginStatus } from "@server/entities/plugin-registry.entity";
import type { HayPluginManifest, PluginLocale } from "@server/types/plugin.types";
import { getPluginRunnerService } from "./plugin-runner.service";
import type { WorkerInfo } from "@server/types/plugin-sdk.types";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("plugin-manager");

type PluginType = HayPluginManifest["type"][number];

/**
 * The `hay-plugin` block embedded in a plugin's package.json. Richer than the
 * SDK's minimal manifest: it also carries Hay-specific extension fields used to
 * build the {@link HayPluginManifest} stored in the registry.
 */
interface HayPluginBlock {
  displayName?: string;
  category?: PluginType;
  entry?: string;
  capabilities?: string[];
  config?: HayPluginManifest["configSchema"];
  env?: string[];
  auth?: HayPluginManifest["auth"];
  channel?: string;
  autoActivate?: boolean;
  trpcRouter?: string;
  documentImporter?: boolean;
}

/**
 * Minimal shape of a plugin's package.json that this service reads.
 */
interface PluginPackageJson {
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  "hay-plugin"?: HayPluginBlock;
}

/**
 * Manifest as persisted in the plugin registry. Identical to
 * {@link HayPluginManifest} except `capabilities` is stored as the flat
 * string-array form sourced from package.json `hay-plugin.capabilities`.
 * Consumers branch on `Array.isArray(manifest.capabilities)` to read it.
 */
type RegistryManifest = Omit<HayPluginManifest, "capabilities"> & {
  capabilities: string[];
};

export class PluginManagerService {
  private pluginsDir: string;
  public registry: Map<string, PluginRegistry> = new Map();

  // Track discovered plugins during initialization
  private discoveredPluginIds: Set<string> = new Set();

  // SDK runner service - single source of truth for all worker management
  private runnerService = getPluginRunnerService();

  constructor() {
    // Look for plugins in the root /plugins directory
    this.pluginsDir = path.join(process.cwd(), "..", "plugins");
  }

  /**
   * Initialize the plugin manager and discover all plugins
   */
  async initialize(): Promise<void> {
    logger.info("Discovering plugins");

    // Clear discovered set for fresh initialization
    this.discoveredPluginIds.clear();

    await this.discoverPlugins();
    await this.loadRegistryFromDatabase();

    // Validate existing plugins and mark missing ones
    await this.validateExistingPlugins();

    // Restore plugins from ZIP if directories are missing
    await this.restorePluginsFromZip();

    logger.info("Plugin registry loaded");

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
      logger.error({ err: error }, "Failed to discover plugins");
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
      logger.error({ err: error, directory }, "Failed to scan plugin directory");
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
    sourceType: "core" | "custom" | "git",
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
        logger.warn({ pluginPath }, "No package.json found for plugin");
        return;
      }

      const packageContent = await fs.readFile(packagePath, "utf-8");
      const packageJson = JSON.parse(packageContent) as PluginPackageJson;

      // Check if this is a Hay plugin
      if (!packageJson["hay-plugin"]) {
        // Not a Hay plugin, skip silently
        return;
      }

      const hayPlugin = packageJson["hay-plugin"];

      // Plugin ID comes from NPM package name
      const pluginId = packageJson.name;

      if (!pluginId) {
        logger.warn({ pluginPath }, "No package name found");
        return;
      }

      // Display name from hay-plugin or parse from package name
      const displayName = hayPlugin.displayName || this.parseDisplayName(pluginId);

      // Build full manifest from package.json.
      // Primary type from category, plus any extra types inferred from
      // capabilities (e.g. a document_importer plugin that ALSO exposes MCP
      // tools — like Atlassian, where Confluence is the importer and Jira
      // is served over MCP from the same connection).
      const type = Array.from(
        new Set<PluginType>([
          ...(hayPlugin.category ? [hayPlugin.category] : []),
          ...this.inferTypeFromCapabilities(hayPlugin.capabilities || []),
          // Hay-specific extension: hay-plugin.documentImporter=true marks
          // a plugin as a document_importer without using SDK capability
          // names that the worker bootstrap doesn't recognize.
          ...(hayPlugin.documentImporter === true ? (["document_importer"] as const) : []),
        ]),
      );

      const manifest: RegistryManifest = {
        id: pluginId,
        name: displayName,
        version: packageJson.version || "1.0.0",
        description: packageJson.description || "",
        type,
        entry: hayPlugin.entry || "",
        capabilities: hayPlugin.capabilities || [],
        configSchema: hayPlugin.config || {},
        permissions: {
          env: hayPlugin.env || [],
          api: hayPlugin.capabilities || [],
        },
        auth: hayPlugin.auth || undefined, // Include auth config if present
        channel: hayPlugin.channel || undefined, // For channel-type plugins
        autoActivate: hayPlugin.autoActivate === true, // Eagerly load router at boot
        trpcRouter: hayPlugin.trpcRouter || undefined, // Optional plugin-side tRPC router file
      };

      // Load i18n translations from plugin's i18n/ directory
      const i18nDir = path.join(pluginPath, "i18n");
      const i18n: Record<string, PluginLocale> = {};
      try {
        const i18nFiles = await fs.readdir(i18nDir);
        for (const file of i18nFiles) {
          if (file.endsWith(".json")) {
            const locale = file.replace(".json", "");
            const content = await fs.readFile(path.join(i18nDir, file), "utf-8");
            i18n[locale] = JSON.parse(content) as PluginLocale;
          }
        }
      } catch {
        // No i18n directory — that's fine
      }
      if (Object.keys(i18n).length > 0) {
        manifest.i18n = i18n;
      }

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
        // The registry stores capabilities as the flat string-array form
        // (see RegistryManifest); the jsonb column is typed with the structured
        // HayPluginManifest, and consumers branch on Array.isArray() to read it.
        manifest: manifest as HayPluginManifest,
        checksum,
        sourceType,
        organizationId: organizationId || undefined,
      });

      this.registry.set(manifest.id, plugin);
      this.discoveredPluginIds.add(manifest.id); // Track as discovered
      logger.info({ pluginId, path: relativePath }, "Registered plugin");
    } catch (error) {
      logger.error({ err: error, pluginPath }, "Failed to register plugin");
    }
  }

  /**
   * Parse display name from package name
   * @example "hay-plugin-hubspot" => "HubSpot"
   * @example "my-plugin" => "My Plugin"
   */
  private parseDisplayName(packageName: string): string {
    // Remove hay-plugin- prefix
    const name = packageName.replace(/^hay-plugin-/, "");

    // Convert kebab-case to Title Case
    return name
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  /**
   * Infer plugin type from capabilities
   */
  private inferTypeFromCapabilities(capabilities: string[]): PluginType[] {
    const types: PluginType[] = [];

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
        logger.warn(
          { count: missingPlugins.length },
          "Found plugins in database but not on filesystem",
        );

        // Mark each missing plugin as not_found
        for (const plugin of missingPlugins) {
          await pluginRegistryRepository.updateStatus(plugin.id, PluginStatus.NOT_FOUND);

          // Update in-memory registry as well
          const registryPlugin = this.registry.get(plugin.pluginId);
          if (registryPlugin) {
            registryPlugin.status = PluginStatus.NOT_FOUND;
          }

          logger.info({ pluginId: plugin.pluginId }, "Plugin marked as not_found");
        }
      }
    } catch (error) {
      logger.error({ err: error }, "Failed to validate existing plugins");
    }
  }

  /**
   * Restore plugins from stored ZIP files if directories are missing
   */
  private async restorePluginsFromZip(): Promise<void> {
    try {
      const { storageService } = await import("./storage.service");
      const AdmZip = (await import("adm-zip")).default;

      // Get all custom/git plugins that have ZIP/archive uploads
      const customPlugins = Array.from(this.registry.values()).filter(
        (plugin) =>
          (plugin.sourceType === "custom" || plugin.sourceType === "git") && plugin.zipUploadId,
      );

      if (customPlugins.length === 0) {
        return;
      }

      logger.info({ count: customPlugins.length }, "Checking custom plugins for restoration");

      for (const plugin of customPlugins) {
        try {
          // Check if plugin directory exists
          const pluginPath = path.join(this.pluginsDir, plugin.pluginPath);
          const dirExists = await fs
            .access(pluginPath)
            .then(() => true)
            .catch(() => false);

          if (!dirExists && plugin.zipUploadId) {
            logger.info(
              { pluginName: plugin.name, sourceType: plugin.sourceType },
              "Restoring plugin from archive",
            );

            // Download archive from storage
            const { buffer } = await storageService.download(plugin.zipUploadId);

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

            // Extract based on source type
            if (plugin.sourceType === "git") {
              // Git plugins are stored as tar.gz archives
              const { extractTarball } = await import("@server/lib/git/tarball");
              await extractTarball(buffer, pluginPath);
            } else {
              // Custom plugins are stored as ZIP files
              const zip = new AdmZip(buffer);
              zip.extractAllTo(pluginPath, true);
            }

            // Re-register the plugin so it's discovered and status is reset to AVAILABLE
            const fullPluginPath = path.join(this.pluginsDir, plugin.pluginPath);
            await this.registerPlugin(
              fullPluginPath,
              plugin.sourceType as "custom" | "git",
              plugin.organizationId || null,
            );

            logger.info(
              { pluginName: plugin.name, pluginPath: plugin.pluginPath },
              "Restored plugin from archive",
            );
          }
        } catch (error) {
          logger.error({ err: error, pluginName: plugin.name }, "Failed to restore plugin");
        }
      }
    } catch (error) {
      logger.error({ err: error }, "Failed to restore plugins from ZIP");
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
    const isWorkspacePlugin = plugin.pluginPath.startsWith("core/");

    // Check for npm install in package.json
    let installCommand: string | undefined;
    try {
      const packageJsonPath = path.join(pluginPath, "package.json");
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as PluginPackageJson;

      // For custom/git plugins, fix @hay/plugin-sdk dependency path.
      // External plugins reference the SDK with a file: path relative to their
      // own repo, which breaks when extracted inside the monorepo.
      if (!isWorkspacePlugin) {
        this.fixPluginSdkPath(pluginPath, packageJson);
      }

      // Only run npm install if there are dependencies
      if (packageJson.dependencies || packageJson.devDependencies) {
        if (isWorkspacePlugin) {
          // For workspace plugins, run npm install from root to properly resolve workspace links
          // The plugin is part of plugins/core/* workspace, so we need workspace-aware install
          installCommand = `npm install --ignore-scripts --workspace=plugins/${plugin.pluginPath}`;
        } else {
          installCommand = "npm install --ignore-scripts";
        }
      }
    } catch (error) {
      // Ignore - package.json might not exist
    }

    try {
      // Install the plugin's own (root) dependencies, if it declares any. A
      // plugin may have none at the root and still ship a bundled mcp/ server
      // with its own deps, so this must NOT short-circuit the MCP install below.
      if (installCommand) {
        logger.info({ pluginName: plugin.name }, "Installing plugin");

        // For workspace plugins, run from root directory; otherwise run from plugin directory
        const rootDir = path.join(this.pluginsDir, "..");
        const execDir = isWorkspacePlugin ? rootDir : pluginPath;

        execSync(installCommand, {
          cwd: execDir,
          stdio: "inherit",
          env: this.buildMinimalEnv(),
        });
      } else {
        logger.debug({ pluginName: plugin.name }, "No root install command for plugin");
      }

      // Install bundled MCP server dependencies, if any. The mcp/ server is plain
      // runtime JS spawned over stdio and is NOT part of the npm workspace, so its
      // declared deps must be installed separately or the stdio server fails to
      // resolve modules at spawn time (it otherwise relies on monorepo hoisting).
      const mcpPackageJson = path.join(pluginPath, "mcp", "package.json");
      if (existsSync(mcpPackageJson)) {
        logger.info({ pluginName: plugin.name }, "Installing MCP server dependencies");
        execSync("npm install --ignore-scripts", {
          cwd: path.join(pluginPath, "mcp"),
          stdio: "inherit",
          env: this.buildMinimalEnv(),
        });
      }

      await pluginRegistryRepository.updateInstallStatus(plugin.id, true);
      plugin.installed = true;
      logger.info({ pluginName: plugin.name }, "Plugin installed successfully");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await pluginRegistryRepository.updateInstallStatus(plugin.id, false, errorMessage);
      plugin.installed = false;
      logger.error({ pluginName: plugin.name }, "Plugin installation failed");
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
    const isWorkspacePlugin = plugin.pluginPath.startsWith("core/");

    // Check for build script in package.json
    let buildCommand: string | undefined;
    try {
      const packageJsonPath = path.join(pluginPath, "package.json");
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as PluginPackageJson;

      if (packageJson.scripts?.build) {
        if (isWorkspacePlugin) {
          // For workspace plugins, run build from root with workspace flag
          // This ensures TypeScript can resolve workspace dependencies like @hay/plugin-sdk
          buildCommand = `npm run build --workspace=plugins/${plugin.pluginPath}`;
        } else {
          buildCommand = "npm run build";
        }
      }
    } catch (error) {
      // Ignore - package.json might not exist
    }

    if (!buildCommand) {
      logger.debug({ pluginName: plugin.name }, "No build command for plugin");
      await pluginRegistryRepository.updateBuildStatus(plugin.id, true);
      return;
    }

    try {
      // For workspace plugins, run from root directory; otherwise run from plugin directory
      const rootDir = path.join(this.pluginsDir, "..");
      const execDir = isWorkspacePlugin ? rootDir : pluginPath;

      logger.info(
        { pluginName: plugin.name, command: buildCommand, path: execDir },
        "Building plugin",
      );

      execSync(buildCommand, {
        cwd: execDir,
        stdio: "inherit",
        env: this.buildMinimalEnv(),
      });

      await pluginRegistryRepository.updateBuildStatus(plugin.id, true);
      plugin.built = true;
      logger.info({ pluginName: plugin.name }, "Plugin built successfully");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await pluginRegistryRepository.updateBuildStatus(plugin.id, false, errorMessage);
      plugin.built = false;
      logger.error({ pluginName: plugin.name }, "Plugin build failed");
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
    if (!plugin) return true;
    if (!plugin.installed) return true;

    // Even when bookkeeping says "installed", the bundled mcp/ node_modules may
    // be missing: it's gitignored and lives outside the npm workspace, so it
    // desyncs from the persisted flag on fresh clones, CI, or `git clean`.
    // Re-install if a bundled server's deps aren't actually present on disk.
    const pluginPath = path.join(this.pluginsDir, plugin.pluginPath);
    const hasMcpServer = existsSync(path.join(pluginPath, "mcp", "package.json"));
    if (hasMcpServer && !existsSync(path.join(pluginPath, "mcp", "node_modules"))) {
      return true;
    }

    return false;
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

    // SDK plugins use entry field
    if (manifest.entry) {
      return `node ${manifest.entry}`;
    }

    return undefined;
  }

  /**
   * Initialize auto-activated plugins
   */
  private async initializeAutoActivatedPlugins(): Promise<void> {
    for (const plugin of this.registry.values()) {
      const manifest = plugin.manifest as HayPluginManifest;

      if (manifest.autoActivate && manifest.trpcRouter) {
        await this.ensurePluginRouterRegistered(plugin.pluginId);
      }
    }
  }

  /**
   * Idempotently load and register a plugin's tRPC router with the
   * pluginRouterRegistry.
   *
   * Registration used to happen only here at boot, so a plugin that was built,
   * installed, or enabled while the server was already running had no router
   * registered until the next restart — making document-source listRoots/sync
   * fail with "does not expose a router". Callers that resolve a plugin router
   * on demand invoke this first so registration is self-healing.
   *
   * Returns true if a router is registered for the plugin after this call.
   */
  async ensurePluginRouterRegistered(pluginId: string): Promise<boolean> {
    const { pluginRouterRegistry } = await import("./plugin-router-registry.service");

    if (pluginRouterRegistry.hasRouter(pluginId)) {
      return true;
    }

    const plugin = this.registry.get(pluginId);
    if (!plugin) {
      return false;
    }

    const manifest = plugin.manifest as HayPluginManifest;
    if (!manifest.trpcRouter) {
      return false;
    }

    try {
      // Dynamically load the plugin's router using the stored plugin path.
      // For .ts files we go through CommonJS require() because dynamic
      // ESM import() rejects unknown file extensions under ts-node — but
      // require() is hooked by ts-node (and tsconfig-paths) so @server/*
      // aliases inside the plugin's router resolve correctly.
      const routerPath = path.join(this.pluginsDir, plugin.pluginPath, manifest.trpcRouter);
      logger.debug({ routerPath }, "Loading router");
      const routerModule = routerPath.endsWith(".ts")
        ? // eslint-disable-next-line @typescript-eslint/no-require-imports
          require(routerPath)
        : await import(routerPath);
      const pluginRouter = routerModule.default || routerModule.router;

      if (!pluginRouter) {
        logger.warn(
          { pluginName: plugin.name },
          "Plugin router module has no default/router export",
        );
        return false;
      }

      // Register with the manifest ID, not the directory name
      const registerId = manifest.id || plugin.pluginId;
      pluginRouterRegistry.registerRouter(registerId, pluginRouter);
      logger.info({ pluginName: plugin.name, registerId }, "Registered router for plugin");
      return true;
    } catch (error) {
      logger.warn({ err: error, pluginName: plugin.name }, "Could not load router for plugin");
      return false;
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
      logger.error({ err: error, pluginId }, "Failed to find folder for plugin");
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
  // Worker Management - Delegates to PluginRunnerService
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

      logger.info({ pluginId }, "Fetched and cached metadata");
    } catch (error) {
      logger.error({ err: error, pluginId }, "Failed to fetch metadata");
      throw error;
    }
  }

  /**
   * Start plugin worker for an organization
   * Delegates to PluginRunnerService (single source of truth)
   */
  async startPluginWorker(organizationId: string, pluginId: string): Promise<WorkerInfo> {
    const key = `${organizationId}:${pluginId}`;

    // Check if worker is already running in the runner service
    const existingWorker = this.runnerService.getWorker(organizationId, pluginId);
    if (existingWorker) {
      logger.debug({ key }, "Worker already running, reusing existing worker");
      existingWorker.lastActivity = new Date();
      await pluginInstanceRepository.updateHealthCheck(existingWorker.instanceId, "healthy");
      return existingWorker;
    }

    // Get plugin definition from registry
    const plugin = this.registry.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found in registry`);
    }

    logger.info({ pluginId }, "Starting worker");

    try {
      // Start worker using SDK runner service (source of truth)
      const workerInfo = await this.runnerService.startWorker(organizationId, pluginId);

      // Fetch and cache metadata (plugin-global, not per org)
      // Only fetch if: missing, stale (checksum changed), or error
      if (plugin.metadataState !== "fresh") {
        try {
          await this.fetchAndStoreMetadata(pluginId, workerInfo.port);
        } catch (error) {
          await pluginRegistryRepository.updateMetadataState(plugin.id, "error");
          logger.warn(
            { err: error, pluginId },
            "Metadata fetch failed, cached metadata may be stale",
          );
          // Don't throw - use cached metadata if available
        }
      }

      return workerInfo;
    } catch (error) {
      // If worker is already running (race condition), try to get it
      if (error instanceof Error && error.message.includes("Worker already running")) {
        logger.debug({ key }, "Caught already running error, attempting to get existing worker");
        const existingWorker = this.runnerService.getWorker(organizationId, pluginId);
        if (existingWorker) {
          logger.debug({ key }, "Successfully retrieved existing worker");
          return existingWorker;
        }
      }

      logger.error({ err: error, key }, "Failed to start worker");
      throw error;
    }
  }

  /**
   * Get worker info (or start if not running)
   * Delegates to PluginRunnerService (single source of truth)
   */
  async getOrStartWorker(organizationId: string, pluginId: string): Promise<WorkerInfo> {
    // Check the Runner service for worker state (single source of truth)
    const existingWorker = this.runnerService.getWorker(organizationId, pluginId);

    if (existingWorker) {
      existingWorker.lastActivity = new Date();
      await pluginInstanceRepository.updateHealthCheck(existingWorker.instanceId, "healthy");
      return existingWorker;
    }

    // No worker running - start one
    return await this.startPluginWorker(organizationId, pluginId);
  }

  /**
   * Find the plugin ID that handles a given conversation channel.
   * Looks up the in-memory registry for a plugin with matching `channel` field.
   */
  findPluginIdByChannel(channel: string): string | null {
    for (const [pluginId, plugin] of this.registry) {
      if (plugin.manifest?.channel === channel) {
        return pluginId;
      }
    }
    return null;
  }

  /**
   * Stop plugin worker
   * Delegates to PluginRunnerService (single source of truth)
   */
  async stopPluginWorker(organizationId: string, pluginId: string): Promise<void> {
    logger.info({ organizationId, pluginId }, "Stopping worker");
    await this.runnerService.stopWorker(organizationId, pluginId);
  }

  /**
   * Fix @hay/plugin-sdk file: dependency path for custom/git plugins.
   * External plugins reference the SDK with a relative path that only works
   * in their own repo. We rewrite it to the correct path within the monorepo.
   */
  private fixPluginSdkPath(pluginPath: string, packageJson: PluginPackageJson): void {
    const sdkAbsPath = path.join(this.pluginsDir, "..", "packages", "plugin-sdk");
    const sdkRelPath = path.relative(pluginPath, sdkAbsPath);
    let modified = false;

    for (const depKey of ["dependencies", "devDependencies"] as const) {
      const deps = packageJson[depKey];
      if (deps?.["@hay/plugin-sdk"] && deps["@hay/plugin-sdk"].startsWith("file:")) {
        const currentTarget = deps["@hay/plugin-sdk"].replace("file:", "");
        const resolvedCurrent = path.resolve(pluginPath, currentTarget);
        // Only rewrite if the current path doesn't resolve to the actual SDK
        if (resolvedCurrent !== sdkAbsPath) {
          deps["@hay/plugin-sdk"] = `file:${sdkRelPath}`;
          modified = true;
        }
      }
    }

    if (modified) {
      const packageJsonPath = path.join(pluginPath, "package.json");
      writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");
      logger.info(
        { pluginPath: path.basename(pluginPath) },
        "Fixed @hay/plugin-sdk dependency path",
      );
    }
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
   * Uses PluginRunnerService as the source of truth for active workers
   */
  async cleanupInactiveWorkers(): Promise<void> {
    const now = new Date();
    const allWorkers = this.runnerService.getAllWorkers();

    for (const worker of allWorkers) {
      const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
      const inactiveTime = now.getTime() - worker.lastActivity.getTime();

      if (inactiveTime > TIMEOUT_MS) {
        const key = `${worker.organizationId}:${worker.pluginId}`;
        logger.info(
          { key, inactiveSeconds: Math.round(inactiveTime / 1000) },
          "Cleaning up inactive worker",
        );
        await this.stopPluginWorker(worker.organizationId, worker.pluginId);
      }
    }
  }

  /**
   * Get all active workers
   * Delegates to PluginRunnerService (single source of truth)
   */
  getActiveWorkers(): WorkerInfo[] {
    return this.runnerService.getAllWorkers();
  }

  /**
   * Get worker by organization and plugin
   * Delegates to PluginRunnerService (single source of truth)
   */
  getWorker(organizationId: string, pluginId: string): WorkerInfo | undefined {
    return this.runnerService.getWorker(organizationId, pluginId);
  }
}

export const pluginManagerService = new PluginManagerService();
