import { promises as fs, readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import {
  CUSTOM_PLUGIN_INSTALL_COMMAND,
  prepareCustomPluginInstall,
} from "@server/lib/plugin-dependencies";
import { pluginRegistryRepository } from "@server/repositories/plugin-registry.repository";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { PluginRegistry, PluginStatus } from "@server/entities/plugin-registry.entity";
import type { HayPluginManifest, PluginLocale } from "@server/types/plugin.types";
import { getPluginRunnerService } from "./plugin-runner.service";
import type { WorkerInfo } from "@server/types/plugin-sdk.types";
import { createLogger } from "@server/lib/logger";
import { registerServerAliasForPlugins } from "@server/lib/plugin-router-alias";
import { packPluginChecksum } from "@server/lib/plugin-checksum";
import {
  INACTIVITY_MINUTES_LIMITS,
  isValidInactivityTiming,
  type InactivityTiming,
} from "@server/lib/inactivity-timing";
import { config } from "@server/config/env";
import { readSetupHints } from "@server/services/setup/plugin-hints";

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
  rendering?: HayPluginManifest["rendering"];
  inactivity?: unknown;
  autoActivate?: boolean;
  /** Enable this plugin automatically for newly created organizations. */
  defaultEnabled?: boolean;
  trpcRouter?: string;
  documentImporter?: boolean;
  /** Hosts a server-managed OAuth client secret may be sent to (exact or `*.suffix`). */
  oauthHosts?: string[];
  /** Outbound destinations the worker may reach. */
  network?: HayPluginManifest["network"];
  /** When in-app setup should suggest this plugin, and what it can do for customers. */
  setup?: unknown;
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

/** Whether an organization may see and use a registered plugin. */
export function isPluginVisibleToOrganization(
  plugin: Pick<PluginRegistry, "sourceType" | "organizationId">,
  organizationId: string,
): boolean {
  return plugin.sourceType === "core" || plugin.organizationId === organizationId;
}

/** Throws when the server does not accept organization-supplied plugin code. */
export function assertCustomPluginsAllowed(): void {
  if (!config.plugins.allowCustomPlugins) {
    throw new Error("Custom plugins are disabled on this server");
  }
}

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
      const customExists =
        config.plugins.allowCustomPlugins &&
        (await fs
          .access(customDir)
          .then(() => true)
          .catch(() => false));

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
          // One invalid plugin (already logged) must not stop discovery
          await this.registerPlugin(pluginPath, sourceType, organizationId).catch(() => {});
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
   * Throws when the plugin is invalid or its id belongs to another owner.
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

      // Organization-supplied plugins only ever run inside their own worker:
      // eager activation and in-process tRPC routers are reserved for core.
      if (sourceType !== "core" && (hayPlugin.autoActivate || hayPlugin.trpcRouter)) {
        throw new Error("autoActivate and trpcRouter are only supported for core plugins");
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
        rendering: hayPlugin.rendering || undefined, // What the channel can show (D13-12)
        inactivity: this.readInactivityTiming(pluginId, hayPlugin.inactivity),
        autoActivate: hayPlugin.autoActivate === true, // Eagerly load router at boot
        defaultEnabled: hayPlugin.defaultEnabled === true, // Enabled for new orgs
        trpcRouter: hayPlugin.trpcRouter || undefined, // Optional plugin-side tRPC router file
        oauthHosts: hayPlugin.oauthHosts || undefined, // Hosts a managed OAuth secret may reach
        network: hayPlugin.network || undefined, // Hosts the worker may reach through the egress proxy
        setup: readSetupHints(hayPlugin.setup), // In-app setup suggestions
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
      throw error;
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
    if (capabilities.includes("products")) {
      types.push("products");
    }

    return types.length > 0 ? types : ["mcp-connector"];
  }

  /**
   * Calculate the plugin's checksum (source + dependencies, see lib/plugin-checksum)
   */
  private async calculatePluginChecksum(pluginPath: string): Promise<string> {
    const [sourceHash, depsHash] = await Promise.all([
      this.hashPluginSource(pluginPath),
      this.hashPluginDependencies(pluginPath),
    ]);
    return packPluginChecksum(sourceHash, depsHash);
  }

  /**
   * Hash the dependency fields of the plugin's package.json and its bundled
   * mcp/package.json: the inputs of installPlugin.
   */
  private async hashPluginDependencies(pluginPath: string): Promise<string> {
    const hash = crypto.createHash("sha256");

    for (const file of ["package.json", path.join("mcp", "package.json")]) {
      let packageJson: Record<string, Record<string, string> | undefined>;
      try {
        packageJson = JSON.parse(await fs.readFile(path.join(pluginPath, file), "utf-8"));
      } catch {
        continue;
      }
      for (const field of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
      ]) {
        const deps = { ...packageJson[field] };
        // installPlugin rewrites this file: path for custom plugins; it is not
        // a dependency change.
        if (deps["@hay/plugin-sdk"]?.startsWith("file:")) deps["@hay/plugin-sdk"] = "file:";
        const entries = Object.entries(deps).sort(([a], [b]) => a.localeCompare(b));
        hash.update(JSON.stringify([file, field, entries]));
      }
    }

    return hash.digest("hex");
  }

  private async hashPluginSource(pluginPath: string): Promise<string> {
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
      if (plugin.sourceType !== "core" && !config.plugins.allowCustomPlugins) {
        continue;
      }
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
      const { extractPluginZip } = await import("@server/lib/plugin-archive");

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

            // Extract based on source type. Both extractors re-validate the
            // stored archive (paths, links, size) before writing anything.
            if (plugin.sourceType === "git") {
              // Git plugins are stored as tar.gz archives
              const { extractTarball } = await import("@server/lib/git/tarball");
              await extractTarball(buffer, pluginPath);
            } else {
              // Custom plugins are stored as ZIP files
              await extractPluginZip(buffer, pluginPath);
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

    if (this.isPrebuiltCorePlugin(plugin)) {
      await pluginRegistryRepository.updateInstallStatus(plugin.id, true);
      plugin.installed = true;
      return;
    }

    const pluginPath = path.join(this.pluginsDir, plugin.pluginPath);
    const isWorkspacePlugin = plugin.pluginPath.startsWith("core/");

    // Production images carry core plugins' dependencies from the image build.
    if (isWorkspacePlugin && config.isProduction) {
      await pluginRegistryRepository.updateInstallStatus(plugin.id, true);
      plugin.installed = true;
      return;
    }

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
          installCommand = CUSTOM_PLUGIN_INSTALL_COMMAND;
        }
      }
    } catch (error) {
      // Ignore - package.json might not exist
    }

    try {
      if (!isWorkspacePlugin) {
        const sdkPath = path.join(this.pluginsDir, "..", "packages", "plugin-sdk");
        await prepareCustomPluginInstall(pluginPath, sdkPath);
        await prepareCustomPluginInstall(path.join(pluginPath, "mcp"), sdkPath);
      }

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
        execSync(
          isWorkspacePlugin ? "npm install --ignore-scripts" : CUSTOM_PLUGIN_INSTALL_COMMAND,
          {
            cwd: path.join(pluginPath, "mcp"),
            stdio: "inherit",
            env: this.buildMinimalEnv(),
          },
        );
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
   * Build a plugin (run build command from package.json), then stop its
   * running workers so no request is served by the previous build. They
   * restart on demand.
   */
  async buildPlugin(pluginId: string): Promise<void> {
    await this.runBuild(pluginId);
    await this.runnerService.stopWorkersForPlugin(pluginId);
    await this.reloadPluginRouter(pluginId);
  }

  /**
   * Swap an in-process plugin router for the freshly built one. Consumers look
   * routers up per call (pluginRouterRegistry.getRouter), so no restart is
   * needed. No-op for plugins whose router was never loaded.
   */
  private async reloadPluginRouter(pluginId: string): Promise<void> {
    const { pluginRouterRegistry } = await import("./plugin-router-registry.service");
    const plugin = this.registry.get(pluginId);
    if (!plugin || !pluginRouterRegistry.hasRouter(pluginId)) return;

    // Drop every cached module of the plugin so the next require reads the new
    // build. require.cache is keyed by real path, so resolve symlinks first.
    const pluginDir = (await fs.realpath(path.join(this.pluginsDir, plugin.pluginPath))) + path.sep;
    for (const cached of Object.keys(require.cache)) {
      if (cached.startsWith(pluginDir)) delete require.cache[cached];
    }
    pluginRouterRegistry.unregisterRouter(pluginId);
    await this.ensurePluginRouterRegistered(pluginId);
  }

  private async runBuild(pluginId: string): Promise<void> {
    const plugin = this.registry.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    const pluginPath = path.join(this.pluginsDir, plugin.pluginPath);
    const isWorkspacePlugin = plugin.pluginPath.startsWith("core/");

    // Organization-supplied plugins are never built on the host (a build
    // script is arbitrary code): they must ship their compiled entry file.
    if (plugin.sourceType !== "core") {
      const entry = (plugin.manifest as HayPluginManifest).entry;
      const entryPath = entry ? path.resolve(pluginPath, entry) : "";
      const hasEntry = entryPath.startsWith(pluginPath + path.sep) && existsSync(entryPath);
      const error = hasEntry
        ? undefined
        : `Plugin ${plugin.name} must include its pre-built entry file (${entry || "hay-plugin.entry"})`;
      await pluginRegistryRepository.updateBuildStatus(plugin.id, hasEntry, error);
      plugin.built = hasEntry;
      if (error) {
        throw new Error(error);
      }
      return;
    }

    if (this.isPrebuiltCorePlugin(plugin)) {
      await pluginRegistryRepository.updateBuildStatus(plugin.id, true);
      plugin.built = true;
      return;
    }

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

      if (plugin.sourceType === "core" && manifest.autoActivate && manifest.trpcRouter) {
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
    // Routers load into the server process, so only core plugins may have one.
    if (!plugin || plugin.sourceType !== "core") {
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
      // Compiled runtime (node dist/main.js) has no path-alias resolver, and the
      // bundled router keeps `@server/*` external — map it to this server.
      registerServerAliasForPlugins();
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
   * Find the plugin that handles a conversation channel for one organization.
   *
   * Resolution is per org: the enabled plugin instance whose manifest declares
   * this `channel` slug wins. Two plugins may share a slug across the platform
   * (e.g. two WhatsApp providers) as long as an org enables only one of them.
   */
  async findPluginIdByChannel(organizationId: string, channel: string): Promise<string | null> {
    const instances = await pluginInstanceRepository.findEnabledByOrganization(organizationId);

    const matches = instances
      .map((instance) => instance.plugin?.pluginId)
      .filter((pluginId): pluginId is string => Boolean(pluginId))
      .filter((pluginId) => {
        const manifest =
          this.registry.get(pluginId)?.manifest ??
          instances.find((i) => i.plugin?.pluginId === pluginId)?.plugin?.manifest;
        return manifest?.channel === channel;
      })
      .sort();

    if (matches.length > 1) {
      logger.warn(
        { organizationId, channel, pluginIds: matches },
        "Multiple enabled plugins claim the same channel; using the first by id",
      );
    }

    return matches[0] ?? null;
  }

  /** When a channel plugin checks in on and closes a silent conversation; undefined = env default. */
  getChannelInactivity(pluginId: string): InactivityTiming | undefined {
    return this.registry.get(pluginId)?.manifest?.inactivity;
  }

  /** A declared `hay-plugin.inactivity`, or undefined (with a warning) when it is malformed. */
  private readInactivityTiming(pluginId: string, value: unknown): InactivityTiming | undefined {
    if (value === undefined) return undefined;
    if (isValidInactivityTiming(value)) return value;
    logger.warn(
      { pluginId, inactivity: value, limits: INACTIVITY_MINUTES_LIMITS },
      "Ignoring invalid hay-plugin.inactivity: closeMinutes and warningMinutes must be whole minutes in range, the check-in before the close",
    );
    return undefined;
  }

  /** What a channel plugin declares it can show (D13-12). Empty when nothing is declared. */
  getChannelRendering(pluginId: string): NonNullable<HayPluginManifest["rendering"]> {
    return this.registry.get(pluginId)?.manifest?.rendering ?? {};
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
  private isPrebuiltCorePlugin(plugin: PluginRegistry): boolean {
    return config.plugins.prebuilt && plugin.sourceType === "core";
  }

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
