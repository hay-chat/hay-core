import { spawn } from "child_process";
import path from "path";
import { getPortAllocator } from "./port-allocator.service";
import type { WorkerInfo, AuthState, ConfigFieldDescriptor } from "../types/plugin-sdk-v2.types";
import { AppDataSource } from "../database/data-source";
import { PluginRegistry } from "../entities/plugin-registry.entity";
import { PluginInstance } from "../entities/plugin-instance.entity";
import { pluginInstanceRepository } from "../repositories/plugin-instance.repository";
import { fetchAndStoreTools } from "./plugin-tools.service";
import { resolveConfigForWorker } from "@server/lib/config-resolver";
import { getApiUrl } from "../config/env";
import { oauthService } from "./oauth.service";

/**
 * Plugin Runner V2 Service
 *
 * Manages plugin workers using SDK v2 runner.
 * Handles worker lifecycle, environment injection, and metadata fetching.
 *
 * Key responsibilities:
 * - Spawn workers using SDK v2 runner
 * - Build SDK v2 environment variables (HAY_ORG_CONFIG, HAY_ORG_AUTH, etc.)
 * - Track worker processes per org+plugin
 * - Handle graceful shutdown
 * - Manage org-scoped runtime state transitions
 */
export class PluginRunnerV2Service {
  private workers = new Map<string, WorkerInfo>(); // Key: "orgId:pluginId"
  private portAllocator = getPortAllocator();
  private pluginsDir: string;
  private runnerPath: string;

  constructor() {
    // Plugins directory relative to server root
    this.pluginsDir = path.join(__dirname, "../../plugins");

    // SDK v2 runner path (TypeScript source - will use ts-node or compiled version)
    const runnerSource = path.join(__dirname, "../../plugin-sdk-v2/runner/index.ts");
    const runnerCompiled = path.join(__dirname, "../../plugin-sdk-v2/dist/runner/index.js");

    // Prefer compiled version if exists, otherwise use ts-node with source
    const fs = require("fs");
    if (fs.existsSync(runnerCompiled)) {
      this.runnerPath = runnerCompiled;
    } else {
      // Use ts-node for development
      this.runnerPath = runnerSource;
    }
  }

  /**
   * Start a plugin worker using SDK v2 runner
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
    let instance = await instanceRepo.findOne({
      where: { organizationId: orgId, pluginId: plugin.id },
    });
    if (!instance || !instance.enabled) {
      throw new Error(`Plugin not enabled for org: ${orgId}`);
    }

    // Debug: Log authState before any processing
    console.log(`[PluginRunner] authState for ${pluginId}:`, {
      methodId: instance.authState?.methodId,
      hasAccessToken: !!instance.authState?.credentials?.accessToken,
      accessTokenPreview: instance.authState?.credentials?.accessToken
        ? String(instance.authState.credentials.accessToken).substring(0, 30) + "..."
        : "NONE",
      expiresAt: instance.authState?.credentials?.expiresAt,
    });

    // Check if OAuth token needs refresh before starting worker
    if (instance.authMethod === "oauth" && instance.authState?.credentials?.expiresAt) {
      const expiresAt = instance.authState.credentials.expiresAt as number;
      const now = Math.floor(Date.now() / 1000);
      const bufferSeconds = 5 * 60; // 5 minutes buffer

      if (expiresAt - now < bufferSeconds) {
        console.log(
          `[PluginRunner] OAuth token expired or expiring soon for ${pluginId}, refreshing...`,
        );
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
          console.log(`[PluginRunner] OAuth token refreshed successfully for ${pluginId}`);
          // Debug: Log refreshed authState
          console.log(`[PluginRunner] Refreshed authState for ${pluginId}:`, {
            methodId: instance.authState?.methodId,
            hasAccessToken: !!instance.authState?.credentials?.accessToken,
            accessTokenPreview: instance.authState?.credentials?.accessToken
              ? String(instance.authState.credentials.accessToken).substring(0, 30) + "..."
              : "NONE",
            expiresAt: instance.authState?.credentials?.expiresAt,
          });
        } catch (error: any) {
          console.error(
            `[PluginRunner] OAuth token refresh failed for ${pluginId}:`,
            error.message,
          );
          // If token is already expired and refresh failed, throw error
          if (expiresAt - now <= 0) {
            throw new Error(
              `OAuth token expired and refresh failed: ${error.message}. Please re-authenticate.`,
            );
          }
          // If token hasn't expired yet, continue with existing token
          console.warn(
            `[PluginRunner] Continuing with existing token (expires in ${expiresAt - now}s)`,
          );
        }
      }
    }

    // Update runtime state to "starting"
    await instanceRepo.update(instance.id, {
      runtimeState: "starting",
      lastStartedAt: new Date(),
      lastError: undefined,
    } as any);

    try {
      // Allocate port
      const port = await this.portAllocator.allocate();

      // Build environment variables
      // SDK v2 expects org config in this format: { org: { id }, config: {...} }
      // Use config resolver to merge DB config + .env fallback + auth credentials
      const configSchema = (plugin.metadata?.configSchema || {}) as Record<
        string,
        ConfigFieldDescriptor
      >;
      const resolvedConfig = resolveConfigForWorker(
        instance.config,
        instance.authState,
        configSchema,
      );

      const orgConfig = {
        org: {
          id: orgId,
        },
        config: resolvedConfig,
      };

      const env = this.buildSDKv2Env({
        orgId,
        pluginId,
        port,
        orgConfig,
        orgAuth: instance.authState || null,
        capabilities: (plugin.manifest as any).capabilities || [],
        allowedEnvVars: (plugin.manifest as any).env || [],
      });

      // Plugin path - if already absolute, use as-is; otherwise join with pluginsDir
      const pluginPath = path.isAbsolute(plugin.pluginPath)
        ? plugin.pluginPath
        : path.join(this.pluginsDir, plugin.pluginPath);

      // Spawn SDK v2 runner
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

      // Log output for debugging
      workerProcess.stdout?.on("data", (data) => {
        console.log(`[${pluginId}:${orgId}] ${data.toString().trim()}`);
      });

      workerProcess.stderr?.on("data", (data) => {
        console.error(`[${pluginId}:${orgId}] ERROR: ${data.toString().trim()}`);
      });

      // Handle process exit
      workerProcess.on("exit", async (code, signal) => {
        console.log(`[${pluginId}:${orgId}] Process exited with code ${code}, signal ${signal}`);
        this.portAllocator.release(port);
        this.workers.delete(workerKey);

        // Update runtime state
        await instanceRepo.update(instance.id, {
          runtimeState: code === 0 ? "stopped" : "error",
          lastError: code !== 0 ? `Process exited with code ${code}` : undefined,
          lastStoppedAt: new Date(),
        } as any);
        // Update health status - unhealthy if exited with error, unknown if stopped normally
        await pluginInstanceRepository.updateHealthCheck(
          instance.id,
          code === 0 ? "unknown" : "unhealthy",
        );
      });

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
        startedAt: new Date(),
        lastActivity: new Date(),
        organizationId: orgId,
        pluginId,
        instanceId: instance.id,
        sdkVersion: "v2",
      };

      this.workers.set(workerKey, workerInfo);

      console.log(`✅ Worker started successfully: ${workerKey} on port ${port}`);

      // Discover and cache MCP tools (non-blocking)
      fetchAndStoreTools(port, orgId, pluginId).catch((error) => {
        console.error(`Tool discovery failed for ${pluginId}:${orgId}:`, error);
      });

      return workerInfo;
    } catch (error: any) {
      // Update runtime state to "error"
      await instanceRepo.update(instance.id, {
        runtimeState: "error",
        lastError: error.message,
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
      console.log(`Worker not found: ${workerKey}`);
      return;
    }

    try {
      // Call /disable endpoint if worker is running
      try {
        const response = await fetch(`http://localhost:${worker.port}/disable`, {
          method: "POST",
          signal: AbortSignal.timeout(5000),
        });
        console.log(`Called /disable for ${workerKey}: ${response.status}`);
      } catch (err) {
        console.warn(`Failed to call /disable for ${workerKey}:`, err);
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
      this.portAllocator.release(worker.port);

      // Remove from workers map
      this.workers.delete(workerKey);

      // Update database
      const instanceRepo = AppDataSource.getRepository(PluginInstance);
      await instanceRepo.update(worker.instanceId, {
        runtimeState: "stopped",
        running: false,
        lastStoppedAt: new Date(),
      });

      console.log(`✅ Worker stopped: ${workerKey}`);
    } catch (error: any) {
      console.error(`Failed to stop worker ${workerKey}:`, error);
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
   * Build SDK v2 environment variables
   */
  private buildSDKv2Env(params: {
    orgId: string;
    pluginId: string;
    port: number;
    orgConfig: Record<string, any>;
    orgAuth: AuthState | null;
    capabilities: string[];
    allowedEnvVars: string[];
  }): Record<string, string> {
    const { orgId, pluginId, port, orgConfig, orgAuth, capabilities, allowedEnvVars } = params;

    // Base environment
    const env: Record<string, string> = {
      NODE_ENV: process.env.NODE_ENV || "production",
      PATH: process.env.PATH || "",

      // SDK v2 contract
      HAY_ORG_ID: orgId,
      HAY_PLUGIN_ID: pluginId,
      HAY_WORKER_PORT: port.toString(),
      HAY_ORG_CONFIG: JSON.stringify(orgConfig),
      HAY_ORG_AUTH: JSON.stringify(orgAuth || {}),
    };

    // Add API access if needed
    if (capabilities.includes("routes") || capabilities.includes("mcp")) {
      env.HAY_API_URL = process.env.HAY_API_URL || getApiUrl();
      // TODO: Generate plugin JWT token
      // env.HAY_API_TOKEN = this.generatePluginJWT(orgId, pluginId, capabilities);
    }

    // Add allowed environment variables from host
    for (const envVar of allowedEnvVars) {
      if (process.env[envVar]) {
        env[envVar] = process.env[envVar]!;
      }
    }

    return env;
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
        const response = await fetch(`http://localhost:${port}/metadata`, {
          signal: AbortSignal.timeout(2000),
        });

        if (response.ok) {
          console.log(`✅ /metadata endpoint ready on port ${port} (attempt ${attempt})`);
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
let runnerService: PluginRunnerV2Service | null = null;

/**
 * Get or create the singleton PluginRunnerV2Service instance
 */
export function getPluginRunnerV2Service(): PluginRunnerV2Service {
  if (!runnerService) {
    runnerService = new PluginRunnerV2Service();
  }
  return runnerService;
}
