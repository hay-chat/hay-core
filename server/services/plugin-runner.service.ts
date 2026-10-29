import { spawn } from "child_process";
import path from "path";
import { getPortAllocator } from "./port-allocator.service";
import type { WorkerInfo, AuthState, ConfigFieldDescriptor } from "../types/plugin-sdk.types";
import { AppDataSource } from "../database/data-source";
import { PluginRegistry } from "../entities/plugin-registry.entity";
import { PluginInstance } from "../entities/plugin-instance.entity";
import { pluginInstanceRepository } from "../repositories/plugin-instance.repository";
import { fetchAndStoreTools } from "./plugin-tools.service";
import { resolveConfigForWorker } from "@server/lib/config-resolver";
import { configEnvAllowList, isDeniedPluginEnv } from "@server/lib/plugin-env";
import { mintPluginApiToken } from "@server/lib/plugin-api-token";
import { getApiUrl } from "../config/env";
import { oauthService } from "./oauth.service";
import { createLogger } from "@server/lib/logger";
import { redactEmbeddedJsonFields } from "@server/lib/logger/redaction";
import { issueWorkerSecret, revokeWorkerSecret, workerFetch } from "@server/lib/worker-client";
import type { HayPluginManifest } from "../types/plugin.types";

const logger = createLogger("plugin-runner");

/** Default per-plugin worker pool size when the registry entry sets none. */
const DEFAULT_MAX_WORKERS_PER_PLUGIN = 10;

/**
 * V8 heap ceiling for a worker (MB). Workers share core's uid, so this is the
 * main bound on what one plugin can consume.
 * TODO: run workers under a separate uid / cgroup for OS-level isolation.
 */
const WORKER_MAX_OLD_SPACE_MB = 1024;

/**
 * Manifest as persisted in the plugin registry: identical to
 * {@link HayPluginManifest} except `capabilities` is stored as the flat
 * string-array form sourced from package.json `hay-plugin.capabilities`.
 * The registry also mirrors allowed host env vars under `permissions.env`.
 */
type RegistryManifest = Omit<HayPluginManifest, "capabilities"> & {
  capabilities: string[];
};

/**
 * Plugin Runner Service
 *
 * Manages plugin workers using the SDK runner.
 * Handles worker lifecycle, environment injection, and metadata fetching.
 *
 * Key responsibilities:
 * - Spawn workers using SDK runner
 * - Build SDK environment variables (HAY_ORG_CONFIG, HAY_ORG_AUTH, etc.)
 * - Track worker processes per org+plugin
 * - Handle graceful shutdown
 * - Manage org-scoped runtime state transitions
 */
export class PluginRunnerService {
  private workers = new Map<string, WorkerInfo>(); // Key: "orgId:pluginId"
  private pendingStarts = new Set<string>(); // workerKeys spawned but not yet ready
  private portAllocator = getPortAllocator();
  private pluginsDir: string;
  private runnerPath: string;

  constructor() {
    // Use process.cwd() as the root directory (should be the monorepo root or server directory)
    // This is more reliable than __dirname which changes between source and compiled locations
    const rootDir = process.cwd().endsWith("/server")
      ? path.join(process.cwd(), "..")
      : process.cwd();

    // Plugins directory relative to monorepo root
    this.pluginsDir = path.join(rootDir, "plugins");

    // SDK runner path - prefer compiled version for production
    const runnerCompiled = path.join(rootDir, "packages/plugin-sdk/dist/runner/index.js");
    const runnerSource = path.join(rootDir, "packages/plugin-sdk/runner/index.ts");

    // Prefer compiled version if exists, otherwise use ts-node with source (for development)
    const fs = require("fs");
    if (fs.existsSync(runnerCompiled)) {
      this.runnerPath = runnerCompiled;
    } else {
      // Use tsx for development
      this.runnerPath = runnerSource;
    }
  }

  /**
   * Start a plugin worker using SDK runner
   *
   * @param orgId Organization ID
   * @param pluginId Plugin ID (package name)
   * @returns Worker information
   */
  async startWorker(orgId: string, pluginId: string): Promise<WorkerInfo> {
    const workerKey = `${orgId}:${pluginId}`;

    // Check if already running
    if (this.workers.has(workerKey)) {
      throw new Error(`Worker already running for ${workerKey}`);
    }

    // Get plugin registry
    const pluginRepo = AppDataSource.getRepository(PluginRegistry);
    const plugin = await pluginRepo.findOne({ where: { pluginId } });
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    // Get plugin instance
    const instanceRepo = AppDataSource.getRepository(PluginInstance);
    const instance = await instanceRepo.findOne({
      where: { organizationId: orgId, pluginId: plugin.id },
    });
    if (!instance || !instance.enabled) {
      throw new Error(`Plugin not enabled for org: ${orgId}`);
    }

    await this.makeRoomInPool(
      pluginId,
      plugin.maxConcurrentInstances || DEFAULT_MAX_WORKERS_PER_PLUGIN,
    );
    this.pendingStarts.add(workerKey);
    try {
      return await this.spawnWorker(orgId, pluginId, plugin, instance);
    } finally {
      this.pendingStarts.delete(workerKey);
    }
  }

  /**
   * Keep each plugin's pool within `maxWorkers`: when it is full, stop the
   * least recently active workers (they restart on demand). Throws when the
   * pool is full of workers that are still starting.
   */
  private async makeRoomInPool(pluginId: string, maxWorkers: number): Promise<void> {
    const running = this.getAllWorkers().filter((worker) => worker.pluginId === pluginId);
    const starting = [...this.pendingStarts].filter((key) => key.endsWith(`:${pluginId}`)).length;
    const excess = running.length + starting - maxWorkers + 1;
    if (excess <= 0) return;
    if (excess > running.length) {
      throw new Error(`Worker pool for ${pluginId} is full`);
    }

    const leastRecent = [...running]
      .sort((a, b) => a.lastActivity.getTime() - b.lastActivity.getTime())
      .slice(0, excess);
    for (const worker of leastRecent) {
      logger.info(
        { pluginId, organizationId: worker.organizationId },
        "Worker pool full, stopping least recently active worker",
      );
      await this.stopWorker(worker.organizationId, pluginId);
    }
  }

  private async spawnWorker(
    orgId: string,
    pluginId: string,
    plugin: PluginRegistry,
    initialInstance: PluginInstance,
  ): Promise<WorkerInfo> {
    const workerKey = `${orgId}:${pluginId}`;
    const instanceRepo = AppDataSource.getRepository(PluginInstance);
    let instance = initialInstance;

    logger.debug(
      {
        pluginId,
        methodId: instance.authState?.methodId,
        hasAccessToken: !!instance.authState?.credentials?.accessToken,
        expiresAt: instance.authState?.credentials?.expiresAt,
      },
      "Auth state before processing",
    );

    // Check if OAuth token needs refresh before starting worker
    if (instance.authMethod === "oauth" && instance.authState?.credentials?.expiresAt) {
      const expiresAt = instance.authState.credentials.expiresAt as number;
      const now = Math.floor(Date.now() / 1000);
      const bufferSeconds = 5 * 60; // 5 minutes buffer

      if (expiresAt - now < bufferSeconds) {
        logger.info({ pluginId }, "OAuth token expired or expiring soon, refreshing");
        try {
          await oauthService.refreshToken(orgId, pluginId);
          // Reload instance to get fresh authState
          const refreshedInstance = await instanceRepo.findOne({
            where: { organizationId: orgId, pluginId: plugin.id },
          });
          if (!refreshedInstance) {
            throw new Error(`Plugin instance not found after token refresh`);
          }
          instance = refreshedInstance;
          logger.info({ pluginId }, "OAuth token refreshed successfully");
          logger.debug(
            {
              pluginId,
              methodId: instance.authState?.methodId,
              hasAccessToken: !!instance.authState?.credentials?.accessToken,
              expiresAt: instance.authState?.credentials?.expiresAt,
            },
            "Refreshed auth state",
          );
        } catch (error) {
          logger.error({ err: error, pluginId }, "OAuth token refresh failed");
          // If token is already expired and refresh failed, throw error
          if (expiresAt - now <= 0) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(
              `OAuth token expired and refresh failed: ${message}. Please re-authenticate.`,
            );
          }
          // If token hasn't expired yet, continue with existing token
          logger.warn(
            { pluginId, expiresInSeconds: expiresAt - now },
            "Continuing with existing token",
          );
        }
      }
    }

    // Update runtime state to "starting"
    await instanceRepo.update(instance.id, {
      runtimeState: "starting",
      lastStartedAt: new Date(),
      lastError: undefined,
    });

    try {
      // Allocate port
      const port = await this.portAllocator.allocate();
      const workerSecret = issueWorkerSecret(port);
      const releasePort = () => {
        revokeWorkerSecret(port, workerSecret);
        this.portAllocator.release(port);
      };

      // Build environment variables
      // SDK expects org config in this format: { org: { id }, config: {...} }
      // Use config resolver to merge DB config + .env fallback + auth credentials
      const configSchema = (plugin.metadata?.configSchema || {}) as Record<
        string,
        ConfigFieldDescriptor
      >;
      const resolvedConfig = resolveConfigForWorker(
        instance.config,
        instance.authState,
        configSchema,
        configEnvAllowList(plugin),
      );

      const orgConfig = {
        org: {
          id: orgId,
        },
        config: resolvedConfig,
      };

      const manifest = plugin.manifest as RegistryManifest;
      const env = this.buildSDKEnv({
        orgId,
        pluginId,
        port,
        workerSecret,
        orgConfig,
        orgAuth: instance.authState || null,
        capabilities: manifest.capabilities || [],
        allowedEnvVars: manifest.permissions?.env || [],
      });

      // Plugin path - if already absolute, use as-is; otherwise join with pluginsDir
      const pluginPath = path.isAbsolute(plugin.pluginPath)
        ? plugin.pluginPath
        : path.join(this.pluginsDir, plugin.pluginPath);

      // Spawn SDK runner
      const useNode = this.runnerPath.endsWith(".ts");
      const command = useNode ? "npx" : "node";
      const args = useNode
        ? [
            "tsx",
            this.runnerPath,
            `--plugin-path=${pluginPath}`,
            `--org-id=${orgId}`,
            `--port=${port}`,
            `--mode=production`,
          ]
        : [
            this.runnerPath,
            `--plugin-path=${pluginPath}`,
            `--org-id=${orgId}`,
            `--port=${port}`,
            `--mode=production`,
          ];

      const workerProcess = spawn(command, args, {
        env,
        stdio: ["ignore", "pipe", "pipe"],
        cwd: path.dirname(this.runnerPath),
      });

      // Track if spawn error occurred to prevent further processing
      let spawnError: Error | null = null;

      // Handle spawn errors (e.g., command not found)
      // This prevents ENOENT errors from crashing the server
      workerProcess.on("error", (error) => {
        logger.error({ err: error, pluginId, orgId }, "Spawn error");
        spawnError = error;
        releasePort();
        this.workers.delete(workerKey);
      });

      // Log worker output through the redacting logger (string patterns are
      // redacted by the logger itself; embedded JSON fields here).
      workerProcess.stdout?.on("data", (data) => {
        logger.info({ pluginId, orgId }, redactEmbeddedJsonFields(data.toString().trim()));
      });

      workerProcess.stderr?.on("data", (data) => {
        logger.error({ pluginId, orgId }, redactEmbeddedJsonFields(data.toString().trim()));
      });

      // Handle process exit
      workerProcess.on("exit", async (code, signal) => {
        logger.info({ pluginId, orgId, code, signal }, "Process exited");
        releasePort();
        this.workers.delete(workerKey);

        // Update runtime state
        await instanceRepo.update(instance.id, {
          runtimeState: code === 0 ? "stopped" : "error",
          lastError: code !== 0 ? `Process exited with code ${code}` : undefined,
          lastStoppedAt: new Date(),
        });
        // Update health status - unhealthy if exited with error, unknown if stopped normally
        await pluginInstanceRepository.updateHealthCheck(
          instance.id,
          code === 0 ? "unknown" : "unhealthy",
        );
      });

      // Give a moment for spawn error to propagate (ENOENT fires asynchronously)
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (spawnError) {
        throw new Error(`Failed to spawn worker process: ${(spawnError as Error).message}`);
      }

      // Wait for /metadata endpoint to be ready (not /health)
      await this.waitForMetadataEndpoint(port, { maxAttempts: 20, interval: 500 });

      // Update runtime state to "ready"
      await instanceRepo.update(instance.id, {
        runtimeState: "ready",
        running: true,
        processId: workerProcess.pid?.toString(),
      });
      // Mark as healthy when worker successfully starts
      await pluginInstanceRepository.updateHealthCheck(instance.id, "healthy");

      // Store worker info
      const workerInfo: WorkerInfo = {
        process: workerProcess,
        port,
        releasePort,
        startedAt: new Date(),
        lastActivity: new Date(),
        organizationId: orgId,
        pluginId,
        instanceId: instance.id,
      };

      this.workers.set(workerKey, workerInfo);

      logger.info({ workerKey, port }, "Worker started successfully");

      // Discover and cache MCP tools (non-blocking)
      fetchAndStoreTools(port, orgId, pluginId).catch((error) => {
        logger.error({ err: error, pluginId, orgId }, "Tool discovery failed");
      });

      return workerInfo;
    } catch (error) {
      // Update runtime state to "error"
      await instanceRepo.update(instance.id, {
        runtimeState: "error",
        lastError: error instanceof Error ? error.message : String(error),
        running: false,
      });
      // Mark as unhealthy when worker fails to start
      await pluginInstanceRepository.updateHealthCheck(instance.id, "unhealthy");

      throw error;
    }
  }

  /**
   * Stop a plugin worker gracefully
   *
   * @param orgId Organization ID
   * @param pluginId Plugin ID
   */
  async stopWorker(orgId: string, pluginId: string): Promise<void> {
    const workerKey = `${orgId}:${pluginId}`;
    const worker = this.workers.get(workerKey);

    if (!worker) {
      logger.debug({ workerKey }, "Worker not found");
      return;
    }

    try {
      // Call /disable endpoint if worker is running
      try {
        const response = await workerFetch(worker.port, "/disable", {
          method: "POST",
          signal: AbortSignal.timeout(5000),
        });
        logger.debug({ workerKey, status: response.status }, "Called /disable endpoint");
      } catch (err) {
        logger.warn({ err, workerKey }, "Failed to call /disable endpoint");
      }

      // Send SIGTERM for graceful shutdown
      worker.process.kill("SIGTERM");

      // Wait up to 5 seconds for graceful shutdown
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          // Force kill if not stopped
          worker.process.kill("SIGKILL");
          resolve();
        }, 5000);

        worker.process.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      // Release port
      worker.releasePort();

      // Remove from workers map
      this.workers.delete(workerKey);

      // Update database
      const instanceRepo = AppDataSource.getRepository(PluginInstance);
      await instanceRepo.update(worker.instanceId, {
        runtimeState: "stopped",
        running: false,
        lastStoppedAt: new Date(),
      });

      logger.info({ workerKey }, "Worker stopped");
    } catch (error) {
      logger.error({ err: error, workerKey }, "Failed to stop worker");
      throw error;
    }
  }

  /**
   * Check if worker is running
   */
  isRunning(orgId: string, pluginId: string): boolean {
    return this.workers.has(`${orgId}:${pluginId}`);
  }

  /**
   * Get worker info
   */
  getWorker(orgId: string, pluginId: string): WorkerInfo | undefined {
    return this.workers.get(`${orgId}:${pluginId}`);
  }

  /**
   * Get all running workers
   */
  getAllWorkers(): WorkerInfo[] {
    return Array.from(this.workers.values());
  }

  /**
   * Stop all workers (used during shutdown)
   */
  async stopAllWorkers(): Promise<void> {
    const stopPromises = Array.from(this.workers.keys()).map(async (workerKey) => {
      const [orgId, pluginId] = workerKey.split(":");
      await this.stopWorker(orgId, pluginId);
    });

    await Promise.all(stopPromises);
  }

  /**
   * Build SDK environment variables
   */
  private buildSDKEnv(params: {
    orgId: string;
    pluginId: string;
    port: number;
    workerSecret: string;
    orgConfig: { org: { id: string }; config: Record<string, unknown> };
    orgAuth: AuthState | null;
    capabilities: string[];
    allowedEnvVars: string[];
  }): Record<string, string> {
    const {
      orgId,
      pluginId,
      port,
      workerSecret,
      orgConfig,
      orgAuth,
      capabilities,
      allowedEnvVars,
    } = params;

    // Base environment
    const env: Record<string, string> = {
      NODE_ENV: process.env.NODE_ENV || "production",
      PATH: process.env.PATH || "",

      // SDK contract
      HAY_ORG_ID: orgId,
      HAY_PLUGIN_ID: pluginId,
      HAY_WORKER_PORT: port.toString(),
      HAY_WORKER_SECRET: workerSecret,
      NODE_OPTIONS: `--max-old-space-size=${WORKER_MAX_OLD_SPACE_MB}`,
      HAY_ORG_CONFIG: JSON.stringify(orgConfig),
      HAY_ORG_AUTH: JSON.stringify(orgAuth || {}),
    };

    // Add API access so the plugin worker can call the main server's plugin-api
    env.HAY_API_URL = process.env.HAY_API_URL || getApiUrl();
    env.HAY_API_TOKEN = this.generatePluginJWT(orgId, pluginId, capabilities);

    // Add allowed environment variables from host
    for (const envVar of allowedEnvVars) {
      if (isDeniedPluginEnv(envVar)) {
        logger.warn({ pluginId, envVar }, "Plugin requested denied environment variable");
        continue;
      }
      if (process.env[envVar]) {
        env[envVar] = process.env[envVar]!;
      }
    }

    return env;
  }

  /**
   * Generate a JWT token for plugin workers to call the main server's plugin-api.
   * Token is scoped to a specific org + plugin and includes granted capabilities.
   */
  private generatePluginJWT(orgId: string, pluginId: string, capabilities: string[]): string {
    return mintPluginApiToken(orgId, pluginId, capabilities);
  }

  /**
   * Wait for /metadata endpoint to be ready
   */
  private async waitForMetadataEndpoint(
    port: number,
    options: { maxAttempts: number; interval: number },
  ): Promise<void> {
    const { maxAttempts, interval } = options;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await workerFetch(port, "/metadata", {
          signal: AbortSignal.timeout(2000),
        });

        if (response.ok) {
          logger.debug({ port, attempt }, "Metadata endpoint ready");
          return;
        }
      } catch (err) {
        // Ignore errors, will retry
      }

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, interval));
      }
    }

    throw new Error(
      `Worker failed to start: /metadata endpoint not available after ${maxAttempts} attempts (port ${port})`,
    );
  }
}

// Singleton instance
let runnerService: PluginRunnerService | null = null;

/**
 * Get or create the singleton PluginRunnerService instance
 */
export function getPluginRunnerService(): PluginRunnerService {
  if (!runnerService) {
    runnerService = new PluginRunnerService();
  }
  return runnerService;
}
