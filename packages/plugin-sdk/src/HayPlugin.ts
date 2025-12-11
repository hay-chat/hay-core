import express from "express";
import path from "path";
import fs from "fs";
import { PluginSDK } from "./PluginSDK";
import { MCPServerManager } from "./MCPServerManager";
import {
  PluginMetadata,
  RouteMethod,
  RouteHandler,
  ConfigFieldSchema,
  SettingsExtension,
} from "./types";

/**
 * HayPlugin Base Class
 *
 * All Hay plugins extend this base class. It provides:
 * - Express HTTP server for receiving webhooks/requests
 * - Plugin SDK for communicating with main Hay application
 * - Route registration helpers
 * - Configuration management from environment variables
 * - Lifecycle hooks (onInitialize, onEnable, onDisable, onConfigUpdate)
 *
 * Example:
 * ```typescript
 * export default class WhatsAppPlugin extends HayPlugin {
 *   constructor() {
 *     super(); // Metadata loaded from package.json automatically
 *   }
 *
 *   async onInitialize(): Promise<void> {
 *     await this.sdk.registerSource({ ... });
 *     this.registerRoute('POST', '/webhook', this.handleWebhook.bind(this));
 *   }
 * }
 * ```
 */
export abstract class HayPlugin {
  public readonly metadata: PluginMetadata;
  protected config: Record<string, any>;
  protected sdk: PluginSDK;
  protected mcpManager?: MCPServerManager;

  private app: express.Application;
  private server: any;
  private registeredRoutes: Array<{ method: string; path: string }> = [];
  private configSchema: Record<string, any> = {};
  private settingsExtensions: SettingsExtension[] = [];

  constructor() {
    // Load metadata from package.json
    this.metadata = this.loadMetadataFromPackageJson();

    // Initialize Express app
    this.app = express();
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Add health check endpoint
    this.app.get("/health", (_req, res) => {
      res.json({
        status: "ok",
        plugin: this.metadata.id,
        version: this.metadata.version,
      });
    });

    // Add metadata endpoint - returns runtime-only data
    this.app.get("/metadata", (_req, res) => {
      res.json({
        auth: this.getAuthConfig(),
        tools: this.getMCPTools(),
        routes: this.registeredRoutes,
        configSchema: this.configSchema,
        settingsExtensions:
          this.settingsExtensions.length > 0 ? this.settingsExtensions : undefined,
      });
    });

    // Load config from environment variables
    this.config = this.loadConfigFromEnv();

    // Validate required environment variables first
    this.validateEnvironment();

    // Initialize SDK (HTTP client to main app)
    this.sdk = new PluginSDK({
      apiUrl: process.env.HAY_API_URL!,
      apiToken: process.env.HAY_API_TOKEN!,
      capabilities: this.metadata.capabilities,
    });
  }

  // =========================================================================
  // Lifecycle Hooks (implemented by plugin)
  // =========================================================================

  /**
   * Called when plugin worker starts
   * Use this to register routes, sources, and perform initialization
   */
  abstract onInitialize(): Promise<void>;

  /**
   * Called when plugin is enabled for an organization
   */
  async onEnable?(): Promise<void>;

  /**
   * Called when plugin is disabled for an organization
   */
  async onDisable?(): Promise<void>;

  /**
   * Called when plugin configuration is updated
   */
  async onConfigUpdate?(newConfig: Record<string, any>): Promise<void>;

  // =========================================================================
  // Route Registration
  // =========================================================================

  /**
   * Register an HTTP route (Express-like)
   *
   * Example:
   * ```typescript
   * this.registerRoute('POST', '/webhook', async (req, res) => {
   *   const data = req.body;
   *   await this.sdk.messages.receive({ ... });
   *   res.json({ success: true });
   * });
   * ```
   */
  protected registerRoute(method: RouteMethod, path: string, handler: RouteHandler): void {
    const methodLower = method.toLowerCase() as "get" | "post" | "put" | "delete" | "patch";

    this.app[methodLower](path, async (req, res, next) => {
      try {
        await handler(req, res, next);
      } catch (error) {
        console.error(`[${this.metadata.id}] Error in route ${method} ${path}:`, error);

        // Only send error response if headers haven't been sent
        if (!res.headersSent) {
          res.status(500).json({
            error: "Internal server error",
            message: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    });

    // Track registered route for /metadata endpoint
    this.registeredRoutes.push({ method, path });

    console.log(`[${this.metadata.id}] Registered route: ${method} ${path}`);
  }

  // =========================================================================
  // Internal: Server Lifecycle (called by startPluginWorker)
  // =========================================================================

  /**
   * Internal: Start HTTP server
   * Called by startPluginWorker() - do not call directly
   */
  async _start(): Promise<void> {
    // Call plugin's initialization FIRST (registers UI extensions, config, etc.)
    console.log(`[${this.metadata.id}] Initializing plugin...`);
    await this.onInitialize();

    // Start HTTP server IMMEDIATELY so metadata endpoint is available
    const port = parseInt(process.env.HAY_WORKER_PORT || "0");

    if (!port) {
      throw new Error("HAY_WORKER_PORT environment variable not set");
    }

    await new Promise<void>((resolve, reject) => {
      this.server = this.app.listen(port, () => {
        console.log(`[${this.metadata.id}] Worker listening on port ${port}`);
        resolve();
      });

      this.server.on("error", (error: Error) => {
        console.error(`[${this.metadata.id}] Server error:`, error);
        reject(error);
      });
    });

    // Initialize MCP manager if plugin has MCP capability (non-blocking)
    if (this.metadata.capabilities.includes("mcp")) {
      console.log(`[${this.metadata.id}] Initializing MCP manager...`);
      this.mcpManager = new MCPServerManager({
        workingDir: process.cwd(),
        logger: console,
      });

      try {
        await this.mcpManager.initialize();

        // Register MCP servers if plugin implements registerMCP()
        if ("registerMCP" in this) {
          console.log(`[${this.metadata.id}] Registering MCP servers...`);
          await (this as any).registerMCP();
        }
      } catch (error) {
        // Log MCP errors but don't crash the worker
        console.error(`[${this.metadata.id}] MCP initialization failed:`, error);
        console.log(`[${this.metadata.id}] Worker will continue without MCP functionality`);
      }
    }
  }

  /**
   * Internal: Stop HTTP server
   * Called during graceful shutdown - do not call directly
   */
  async _stop(): Promise<void> {
    // Shutdown MCP manager if active
    if (this.mcpManager) {
      console.log(`[${this.metadata.id}] Shutting down MCP manager...`);
      await this.mcpManager.shutdown();
    }

    // Stop HTTP server
    if (this.server) {
      return new Promise<void>((resolve) => {
        this.server.close(() => {
          console.log(`[${this.metadata.id}] Worker stopped`);
          resolve();
        });
      });
    }
  }

  // =========================================================================
  // Configuration Management
  // =========================================================================

  /**
   * Register a configuration option
   * Call this in onInitialize() to define configuration fields for your plugin
   *
   * Example:
   * ```typescript
   * this.registerConfigOption('apiKey', {
   *   type: 'string',
   *   label: 'API Key',
   *   description: 'Your API key for authentication',
   *   required: true,
   *   encrypted: true,
   *   env: 'MY_API_KEY'
   * });
   * ```
   */
  protected registerConfigOption(name: string, schema: ConfigFieldSchema): void {
    this.configSchema[name] = schema;
    this.log(`Registered config option: ${name}`);
  }

  /**
   * Register a UI extension for the plugin settings page
   * Call this in onInitialize() to add custom components to the settings page
   *
   * Example:
   * ```typescript
   * this.registerUIExtension({
   *   slot: 'after-settings',
   *   component: 'components/settings/AfterSettings.vue',
   * });
   * ```
   */
  protected registerUIExtension(extension: SettingsExtension): void {
    // Validate slot-specific requirements
    if (extension.slot === "tab" && !extension.tabName) {
      throw new Error("tabName is required for tab slot");
    }

    this.settingsExtensions.push(extension);
    this.log(`Registered UI extension: ${extension.slot} - ${extension.component}`);
  }

  /**
   * Load config from environment variables
   * Maps config field definitions to actual env vars
   */
  private loadConfigFromEnv(): Record<string, any> {
    const config: Record<string, any> = {};

    for (const [configKey, def] of Object.entries(this.metadata.config || {})) {
      if (def.envVar && process.env[def.envVar]) {
        const value = process.env[def.envVar]!; // Non-null assertion since we checked above

        // Type conversion based on field type
        switch (def.type) {
          case "number":
            config[configKey] = parseFloat(value);
            break;
          case "boolean":
            config[configKey] = value === "true" || value === "1";
            break;
          case "array":
          case "object":
            try {
              config[configKey] = JSON.parse(value);
            } catch (error) {
              console.warn(
                `[${this.metadata.id}] Failed to parse ${configKey} as JSON, using raw value`,
              );
              config[configKey] = value;
            }
            break;
          default:
            config[configKey] = value;
        }
      } else if (def.default !== undefined) {
        // Use default value if env var not set
        config[configKey] = def.default;
      }
    }

    return config;
  }

  /**
   * Validate required environment variables
   */
  private validateEnvironment(): void {
    const missing: string[] = [];

    // Check SDK environment variables
    if (!process.env.HAY_API_URL) {
      missing.push("HAY_API_URL");
    }
    if (!process.env.HAY_API_TOKEN) {
      missing.push("HAY_API_TOKEN");
    }

    // HAY_WORKER_PORT is required for all plugins (for metadata endpoint)
    if (!process.env.HAY_WORKER_PORT) {
      missing.push("HAY_WORKER_PORT");
    }

    // Check required config fields
    for (const [, def] of Object.entries(this.metadata.config || {})) {
      if (def.required && def.envVar && !process.env[def.envVar]) {
        missing.push(def.envVar);
      }
    }

    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
    }
  }

  // =========================================================================
  // Utilities
  // =========================================================================

  /**
   * Get Express app instance (for advanced usage)
   */
  protected getApp(): express.Application {
    return this.app;
  }

  /**
   * Log with plugin prefix
   */
  protected log(message: string, ...args: any[]): void {
    console.log(`[${this.metadata.id}]`, message, ...args);
  }

  /**
   * Log error with plugin prefix
   */
  protected logError(message: string, error?: Error | unknown): void {
    console.error(`[${this.metadata.id}]`, message, error);
  }

  // =========================================================================
  // Metadata Loading
  // =========================================================================

  /**
   * Load plugin metadata from package.json
   * Package.json is the single source of truth for static metadata
   */
  private loadMetadataFromPackageJson(): PluginMetadata {
    const packagePath = path.join(process.cwd(), "package.json");

    if (!fs.existsSync(packagePath)) {
      throw new Error(`package.json not found at ${packagePath}`);
    }

    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
    const hayPlugin = packageJson["hay-plugin"];

    if (!hayPlugin) {
      throw new Error("Missing hay-plugin configuration in package.json");
    }

    // Plugin ID comes from NPM package name
    const id = packageJson.name;

    // Display name from hay-plugin or parse from package name
    const name = hayPlugin.displayName || this.parseDisplayName(packageJson.name);

    return {
      id,
      name,
      version: packageJson.version,
      description: packageJson.description,
      author: packageJson.author,
      category: hayPlugin.category,
      icon: "./thumbnail.jpg", // Convention: always thumbnail.jpg
      capabilities: hayPlugin.capabilities || [],
      config: hayPlugin.config || {},
    };
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

  // =========================================================================
  // Runtime Metadata (for /metadata endpoint)
  // =========================================================================

  /**
   * Get runtime auth configuration
   * Override this in your plugin if it uses authentication
   *
   * @returns Auth config or null if not configured
   */
  protected getAuthConfig(): any | null {
    // Override in plugin if auth is configured
    // Example: return { type: 'oauth2', authorizationUrl: '...', ... }
    return null;
  }

  /**
   * Get runtime MCP tools
   * Override this in your plugin to return registered MCP tools
   *
   * @returns Array of MCP tools or null
   */
  protected getMCPTools(): any[] | null {
    // Override in plugin if MCP tools are configured
    // Or get from MCPServerManager if available
    return null;
  }
}
