/**
 * Hay Plugin SDK v2 - Runtime MCP API Implementation
 *
 * Implementation of the runtime MCP API for starting local and external MCP servers.
 *
 * @module @hay/plugin-sdk-v2/sdk/mcp-runtime
 */

import { spawn } from "child_process";
import { resolve } from "path";
import type {
  HayMcpRuntimeAPI,
  McpServerInstance,
  McpInitializerContext,
  ExternalMcpOptions,
  StdioMcpOptions,
} from "../types/index.js";
import type { HayConfigRuntimeAPI, HayAuthRuntimeAPI, HayLogger } from "../types/index.js";
import { StdioMcpClient } from "./stdio-mcp-client.js";
import { killProcessGracefully } from "./process-utils.js";

/**
 * Registered MCP server (local or external).
 *
 * @internal
 */
interface RegisteredMcpServer {
  id: string;
  type: "local" | "external";
  instance?: McpServerInstance; // Only for local servers
  options?: ExternalMcpOptions; // Only for external servers
}

/**
 * Runtime MCP API options.
 *
 * @internal
 */
export interface McpRuntimeAPIOptions {
  /**
   * Config runtime API (for MCP initializer context).
   */
  config: HayConfigRuntimeAPI;

  /**
   * Auth runtime API (for MCP initializer context).
   */
  auth: HayAuthRuntimeAPI;

  /**
   * Logger for MCP operations.
   */
  logger: HayLogger;

  /**
   * Absolute path to the plugin directory (for resolving stdio MCP server paths).
   */
  pluginDir: string;

  /**
   * Callback to register MCP server with platform.
   * Platform is responsible for actual MCP integration.
   */
  onMcpServerStarted?: (server: RegisteredMcpServer) => void | Promise<void>;
}

/**
 * Create a Runtime MCP API instance.
 *
 * This API is used in org runtime hooks (onStart) to start local or external MCP servers.
 *
 * @param options - Runtime MCP API options
 * @returns Runtime MCP API implementation
 *
 * @remarks
 * **CONSTRAINT**: This API must NOT be used in onInitialize.
 * Only available in org runtime contexts (onStart, etc.).
 *
 * The implementation tracks running MCP servers and provides automatic cleanup.
 * The platform (runner) is responsible for:
 * - Actually starting/connecting to MCP servers
 * - Stopping servers on worker shutdown
 * - Restarting servers on config changes
 *
 * @internal
 */
export function createMcpRuntimeAPI(options: McpRuntimeAPIOptions): HayMcpRuntimeAPI {
  const { config, auth, logger, pluginDir, onMcpServerStarted } = options;

  // Track running MCP servers for this org
  const runningServers = new Map<string, RegisteredMcpServer>();

  return {
    async startLocal(
      id: string,
      initializer: (ctx: McpInitializerContext) => Promise<McpServerInstance> | McpServerInstance,
    ): Promise<void> {
      // Validate inputs
      if (!id || typeof id !== "string") {
        throw new Error("MCP server id must be a non-empty string");
      }

      if (typeof initializer !== "function") {
        throw new Error("MCP server initializer must be a function");
      }

      // Check for duplicate ID
      if (runningServers.has(id)) {
        throw new Error(
          `MCP server with id "${id}" is already running. Use a unique id for each server.`,
        );
      }

      logger.info(`Starting local MCP server: ${id}`);

      try {
        // Create MCP initializer context
        const mcpContext: McpInitializerContext = {
          config,
          auth,
          logger: logger, // Child logger could be created here with [mcp:${id}] tag
        };

        // Call initializer to create MCP server instance
        const instance = await Promise.resolve(initializer(mcpContext));

        // Validate instance
        if (!instance || typeof instance !== "object") {
          throw new Error(
            `MCP server initializer for "${id}" must return an object (McpServerInstance)`,
          );
        }

        // Register server
        const server: RegisteredMcpServer = {
          id,
          type: "local",
          instance,
        };

        runningServers.set(id, server);

        logger.info(`Local MCP server started: ${id}`);
        logger.debug("MCP server instance", { id, hasStop: typeof instance.stop === "function" });

        // Notify platform
        if (onMcpServerStarted) {
          await Promise.resolve(onMcpServerStarted(server));
        }
      } catch (err) {
        logger.error(`Failed to start local MCP server: ${id}`, err);
        throw err;
      }
    },

    async startLocalStdio(options: StdioMcpOptions): Promise<void> {
      // Validate inputs
      if (!options || typeof options !== "object") {
        throw new Error("Stdio MCP options must be an object");
      }

      if (!options.id || typeof options.id !== "string") {
        throw new Error("Stdio MCP server id must be a non-empty string");
      }

      if (!options.command || typeof options.command !== "string") {
        throw new Error("Stdio MCP server command must be a non-empty string");
      }

      if (!Array.isArray(options.args)) {
        throw new Error("Stdio MCP server args must be an array");
      }

      if (!options.cwd || typeof options.cwd !== "string") {
        throw new Error("Stdio MCP server cwd must be a non-empty string");
      }

      const { id, command, args, cwd, env, timeout } = options;

      // Check for duplicate ID
      if (runningServers.has(id)) {
        throw new Error(
          `MCP server with id "${id}" is already running. Use a unique id for each server.`,
        );
      }

      logger.info(`Starting stdio MCP server: ${id}`, { command, args, cwd });

      try {
        // Resolve cwd relative to plugin directory
        const absoluteCwd = resolve(pluginDir, cwd);

        // Merge environment variables
        const processEnv = {
          ...process.env,
          ...env,
        };

        // Use process.execPath for 'node' command to ensure same Node.js binary
        // This prevents PATH issues when plugin workers are spawned in isolated environments
        const resolvedCommand = command === "node" ? process.execPath : command;

        // Spawn the child process
        const childProcess = spawn(resolvedCommand, args, {
          cwd: absoluteCwd,
          env: processEnv,
          stdio: ["pipe", "pipe", "pipe"], // stdin, stdout, stderr
        });

        // Handle process errors during spawn
        childProcess.on("error", (error) => {
          logger.error(`Failed to spawn stdio MCP server process: ${id}`, error);
          // Clean up from runningServers map if process fails
          runningServers.delete(id);
        });

        // Handle process exit to clean up from runningServers map
        childProcess.on("exit", (code, signal) => {
          logger.info(`Stdio MCP server process exited: ${id}`, { code, signal });
          runningServers.delete(id);
        });

        // Create stdio MCP client wrapper
        const client = new StdioMcpClient({
          process: childProcess,
          logger,
          timeout,
        });

        // Create wrapper that implements McpServerInstance
        const instance: McpServerInstance = {
          listTools: async () => {
            return await client.listTools();
          },
          callTool: async (name: string, args?: Record<string, any>) => {
            return await client.callTool(name, args || {});
          },
          stop: async () => {
            logger.debug(`Stopping stdio MCP server: ${id}`);
            await client.stop();
            await killProcessGracefully(childProcess, 5000);
          },
        };

        // Register server
        const server: RegisteredMcpServer = {
          id,
          type: "local",
          instance,
        };

        runningServers.set(id, server);

        logger.info(`Stdio MCP server started: ${id}`);

        // Notify platform
        if (onMcpServerStarted) {
          await Promise.resolve(onMcpServerStarted(server));
        }
      } catch (err) {
        logger.error(`Failed to start stdio MCP server: ${id}`, err);
        throw err;
      }
    },

    async startExternal(options: ExternalMcpOptions): Promise<void> {
      // Validate inputs
      if (!options || typeof options !== "object") {
        throw new Error("External MCP options must be an object");
      }

      if (!options.id || typeof options.id !== "string") {
        throw new Error("External MCP server id must be a non-empty string");
      }

      if (!options.url || typeof options.url !== "string") {
        throw new Error("External MCP server url must be a non-empty string");
      }

      if (options.authHeaders !== undefined) {
        if (typeof options.authHeaders !== "object" || options.authHeaders === null) {
          throw new Error("External MCP server authHeaders must be an object");
        }
      }

      const { id, url } = options;

      // Check for duplicate ID
      if (runningServers.has(id)) {
        throw new Error(
          `MCP server with id "${id}" is already running. Use a unique id for each server.`,
        );
      }

      logger.info(`Starting external MCP server: ${id}`, { url });

      try {
        // Register server
        const server: RegisteredMcpServer = {
          id,
          type: "external",
          options,
        };

        runningServers.set(id, server);

        logger.info(`External MCP server started: ${id}`, { url });

        // Notify platform
        if (onMcpServerStarted) {
          await Promise.resolve(onMcpServerStarted(server));
        }
      } catch (err) {
        logger.error(`Failed to start external MCP server: ${id}`, err);
        throw err;
      }
    },
  };
}

/**
 * Stop all running MCP servers.
 *
 * Calls `stop()` on all local MCP server instances.
 * Used during shutdown or plugin disable.
 *
 * @param servers - Map of running MCP servers
 * @param logger - Logger for shutdown logs
 *
 * @internal
 */
export async function stopAllMcpServers(
  servers: Map<string, RegisteredMcpServer>,
  logger: HayLogger,
): Promise<void> {
  const stopPromises: Promise<void>[] = [];

  for (const [id, server] of servers.entries()) {
    if (server.type === "local" && server.instance?.stop) {
      logger.info(`Stopping MCP server: ${id}`);

      const stopPromise = Promise.resolve(server.instance.stop()).catch((err) => {
        logger.error(`Error stopping MCP server: ${id}`, err);
      });

      stopPromises.push(stopPromise);
    }
  }

  await Promise.all(stopPromises);

  servers.clear();
  logger.debug("All MCP servers stopped");
}
