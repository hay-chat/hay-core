import type { HayPluginManifest } from "./types";

export interface PluginContext {
  organizationId: string;
  instanceId: string;
  config: Record<string, any>;
  env: NodeJS.ProcessEnv;
}

export interface PluginMessage {
  type: "health" | "error" | "log" | "metric" | "custom";
  payload?: any;
  timestamp?: Date;
}

export abstract class HayPlugin {
  protected manifest: HayPluginManifest;
  protected context?: PluginContext;
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(manifest: HayPluginManifest) {
    this.manifest = manifest;
    this.setupProcessHandlers();
  }

  getManifest(): HayPluginManifest {
    return this.manifest;
  }

  getName(): string {
    return this.manifest.name;
  }

  getVersion(): string {
    return this.manifest.version;
  }

  getTypes(): Array<
    "mcp-connector" | "retriever" | "playbook" | "document_importer" | "channel"
  > {
    return this.manifest.type;
  }

  hasCapability(
    capability:
      | "mcp-connector"
      | "retriever"
      | "playbook"
      | "document_importer"
      | "channel"
  ): boolean {
    return this.manifest.type.includes(capability);
  }

  /**
   * Initialize the plugin with context
   */
  async initialize(context: PluginContext): Promise<void> {
    this.context = context;

    // Start health check
    this.startHealthCheck();

    // Call lifecycle hook
    await this.onInitialize(context.config);
  }

  /**
   * Execute a plugin action
   */
  async execute(action: string, payload?: any): Promise<any> {
    try {
      const result = await this.onExecute(action, payload);
      return result;
    } catch (error) {
      this.sendMessage({
        type: "error",
        payload: {
          action,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  /**
   * Shutdown the plugin gracefully
   */
  async shutdown(): Promise<void> {
    // Stop health check
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Call lifecycle hook
    await this.onShutdown();
  }

  /**
   * Lifecycle hooks to be implemented by plugins
   */
  protected abstract onInitialize(config?: Record<string, any>): Promise<void>;
  protected abstract onExecute(action: string, payload?: any): Promise<any>;
  protected abstract onShutdown(): Promise<void>;

  /**
   * Optional lifecycle hooks
   */
  protected async onInstall?(): Promise<void>;
  protected async onBuild?(): Promise<void>;
  protected async onHealthCheck?(): Promise<boolean>;

  /**
   * Send message to parent process via IPC
   */
  protected sendMessage(message: PluginMessage): void {
    if (process.send) {
      process.send({
        ...message,
        timestamp: message.timestamp || new Date(),
        pluginName: this.manifest.name,
      });
    }
  }

  /**
   * Log a message
   */
  protected log(
    level: "info" | "warn" | "error",
    message: string,
    data?: any
  ): void {
    this.sendMessage({
      type: "log",
      payload: {
        level,
        message,
        data,
      },
    });
  }

  /**
   * Report a metric
   */
  protected reportMetric(
    name: string,
    value: number,
    tags?: Record<string, string>
  ): void {
    this.sendMessage({
      type: "metric",
      payload: {
        name,
        value,
        tags,
      },
    });
  }

  /**
   * Start periodic health checks
   */
  private startHealthCheck(): void {
    const interval = 30000; // 30 seconds

    this.healthCheckInterval = setInterval(async () => {
      try {
        const isHealthy = this.onHealthCheck
          ? await this.onHealthCheck()
          : true;

        this.sendMessage({
          type: "health",
          payload: { healthy: isHealthy },
        });
      } catch (error) {
        this.sendMessage({
          type: "health",
          payload: {
            healthy: false,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }, interval);
  }

  /**
   * Set up process event handlers
   */
  private setupProcessHandlers(): void {
    // Handle graceful shutdown
    process.on("SIGTERM", async () => {
      console.log("Received SIGTERM, shutting down gracefully...");
      await this.shutdown();
      process.exit(0);
    });

    process.on("SIGINT", async () => {
      console.log("Received SIGINT, shutting down gracefully...");
      await this.shutdown();
      process.exit(0);
    });

    // Handle uncaught errors
    process.on("uncaughtException", (error) => {
      console.error("Uncaught exception:", error);
      this.sendMessage({
        type: "error",
        payload: {
          error: error.message,
          stack: error.stack,
        },
      });
      process.exit(1);
    });

    process.on("unhandledRejection", (reason, promise) => {
      console.error("Unhandled rejection at:", promise, "reason:", reason);
      this.sendMessage({
        type: "error",
        payload: {
          error: "Unhandled promise rejection",
          reason: String(reason),
        },
      });
      process.exit(1);
    });
  }

  /**
   * Get plugin context
   */
  protected getContext(): PluginContext | undefined {
    return this.context;
  }

  /**
   * Get organization ID from context
   */
  protected getOrganizationId(): string | undefined {
    return this.context?.organizationId;
  }

  /**
   * Get config value
   */
  protected getConfigValue<T = any>(
    key: string,
    defaultValue?: T
  ): T | undefined {
    return this.context?.config[key] ?? defaultValue;
  }

  /**
   * Get environment variable
   */
  protected getEnvVar(key: string, defaultValue?: string): string | undefined {
    return this.context?.env[key] ?? process.env[key] ?? defaultValue;
  }
}
