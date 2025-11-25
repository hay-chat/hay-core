import { spawn, ChildProcess } from "child_process";
import path from "path";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { pluginManagerService } from "./plugin-manager.service";
import { environmentManagerService } from "./environment-manager.service";
import { getUTCNow } from "../utils/date.utils";
import { debugLog } from "@server/lib/debug-logger";

interface ProcessInfo {
  process: ChildProcess;
  pluginInstanceId: string;
  organizationId: string;
  pluginName: string;
  pluginId: string;
  startedAt: Date;
  restartAttempts: number;
  installRecoveryAttempted: boolean; // Track if we've already tried installing dependencies
  lastErrorOutput: string; // Store stderr to detect dependency errors
  gracefulShutdown: boolean; // Track if this is an intentional shutdown (don't restart)
}

export class ProcessManagerService {
  private processes: Map<string, ProcessInfo> = new Map();
  private restartTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly MAX_RESTART_ATTEMPTS = 3;
  private readonly RESTART_DELAY_MS = 5000;

  /**
   * Start a plugin process for an organization
   */
  async startPlugin(organizationId: string, pluginId: string): Promise<void> {
    const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);

    if (!instance) {
      throw new Error(`Plugin instance not found for org ${organizationId}`);
    }

    if (!instance.enabled) {
      throw new Error(`Plugin is not enabled for org ${organizationId}`);
    }

    const processKey = this.getProcessKey(organizationId, pluginId);

    // Check if already running
    if (this.processes.has(processKey)) {
      debugLog("process-manager", `Plugin already running for ${processKey}`);
      return;
    }

    const plugin = await pluginManagerService.getPlugin(instance.plugin.pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${instance.plugin.pluginId} not found in registry`);
    }

    // Ensure plugin is installed and built
    if (!plugin.installed) {
      await pluginManagerService.installPlugin(plugin.pluginId);
    }
    if (!plugin.built) {
      await pluginManagerService.buildPlugin(plugin.pluginId);
    }

    const startCommand = pluginManagerService.getStartCommand(plugin.pluginId);
    if (!startCommand) {
      // Some plugins (like channels) don't need a separate process
      // They just serve assets and handle webhooks
      debugLog("process-manager", `Plugin ${plugin.name} doesn't require a separate process`);
      await pluginInstanceRepository.updateStatus(instance.id, "running");
      return;
    }

    // Update status to starting
    await pluginInstanceRepository.updateStatus(instance.id, "starting");

    try {
      // Prepare environment variables
      const env = await environmentManagerService.prepareEnvironment(organizationId, instance);

      // Get the actual folder name for this plugin
      const folderName = await pluginManagerService.getPluginFolderName(plugin.pluginId);
      if (!folderName) {
        throw new Error(`Could not find folder for plugin ${plugin.pluginId}`);
      }

      // Parse command and args
      const pluginPath = path.join(process.cwd(), "..", "plugins", folderName);

      let childProcess: ChildProcess;

      // Check if command contains shell operators or needs special handling
      if (startCommand.includes("&&") || startCommand.includes("||")) {
        // For complex shell commands, execute them properly
        // Handle commands like "cd directory && npm run start"
        const commands = startCommand.split("&&").map((cmd) => cmd.trim());
        let finalCwd = pluginPath;
        let finalCommand = startCommand;

        // Check if first command is a cd command
        if (commands[0].startsWith("cd ")) {
          const targetDir = commands[0].substring(3).trim();
          finalCwd = path.join(pluginPath, targetDir);
          // Remove the cd command and join the rest
          finalCommand = commands.slice(1).join(" && ").trim();
        }

        // If there's still a command to run after handling cd
        if (finalCommand) {
          // Use cross-platform execution
          childProcess = this.spawnCommand(finalCommand, finalCwd, env);
        } else {
          throw new Error("No command to execute after directory change");
        }
      } else {
        // Use cross-platform execution for simple commands too
        childProcess = this.spawnCommand(startCommand, pluginPath, env);
      }

      const processInfo: ProcessInfo = {
        process: childProcess,
        pluginInstanceId: instance.id,
        organizationId,
        pluginName: plugin.name,
        pluginId: plugin.pluginId,
        startedAt: getUTCNow(),
        restartAttempts: 0,
        installRecoveryAttempted: false,
        lastErrorOutput: "",
        gracefulShutdown: false,
      };

      this.processes.set(processKey, processInfo);

      // Update process ID and status
      // Note: exec might not have PID immediately, but we can still track the process
      const pid = childProcess.pid || "managed";
      await pluginInstanceRepository.updateProcessId(instance.id, String(pid));
      await pluginInstanceRepository.updateStatus(instance.id, "running");

      // Set up event handlers AFTER storing process info
      this.setupProcessHandlers(processKey, processInfo);

      debugLog("process-manager", `Started plugin ${plugin.name} for org ${organizationId}`, { data: { pid } });
    } catch (error) {
      debugLog("process-manager", `Failed to start plugin ${plugin.name}`, { level: "error", data: error });

      // Update database status
      await pluginInstanceRepository.updateStatus(
        instance.id,
        "error",
        error instanceof Error ? error.message : String(error),
      );

      // Clean up any partial process state
      this.processes.delete(processKey);

      // Re-throw with more context
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to start plugin process: ${errorMessage}`);
    }
  }

  /**
   * Stop a plugin process
   */
  async stopPlugin(organizationId: string, pluginId: string): Promise<void> {
    const processKey = this.getProcessKey(organizationId, pluginId);
    const processInfo = this.processes.get(processKey);

    if (!processInfo) {
      debugLog("process-manager", `No running process found for ${processKey}`);
      return;
    }

    // Cancel any restart timer
    const restartTimer = this.restartTimers.get(processKey);
    if (restartTimer) {
      clearTimeout(restartTimer);
      this.restartTimers.delete(processKey);
    }

    // Mark as graceful shutdown to prevent automatic restart
    processInfo.gracefulShutdown = true;

    // Update status to stopping
    await pluginInstanceRepository.updateStatus(processInfo.pluginInstanceId, "stopping");

    // Gracefully terminate the process
    processInfo.process.kill("SIGTERM");

    // Give it time to gracefully shutdown
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Force kill if still running
    if (!processInfo.process.killed) {
      processInfo.process.kill("SIGKILL");
    }

    // Clean up
    this.processes.delete(processKey);

    // Update status
    await pluginInstanceRepository.updateStatus(processInfo.pluginInstanceId, "stopped");
    await pluginInstanceRepository.updateProcessId(processInfo.pluginInstanceId, null);

    debugLog("process-manager", `Stopped plugin ${processInfo.pluginName} for org ${organizationId}`);
  }

  /**
   * Restart a plugin process
   */
  async restartPlugin(organizationId: string, pluginId: string): Promise<void> {
    await this.stopPlugin(organizationId, pluginId);
    await this.startPlugin(organizationId, pluginId);
  }

  /**
   * Set up process event handlers
   */
  private setupProcessHandlers(processKey: string, processInfo: ProcessInfo): void {
    const { process, pluginInstanceId, pluginName, organizationId } = processInfo;

    // Handle stdout
    process.stdout?.on("data", (data) => {
      debugLog("process-manager", `[${pluginName}:${organizationId}] ${data.toString()}`);
    });

    // Handle stderr - capture errors to detect dependency issues
    process.stderr?.on("data", (data) => {
      const errorOutput = data.toString();
      debugLog("process-manager", `[${pluginName}:${organizationId}] ERROR: ${errorOutput}`, { level: "error" });

      // Store last error output for dependency detection
      processInfo.lastErrorOutput += errorOutput;

      // Keep only last 5000 chars to prevent memory issues
      if (processInfo.lastErrorOutput.length > 5000) {
        processInfo.lastErrorOutput = processInfo.lastErrorOutput.slice(-5000);
      }
    });

    // Handle IPC messages
    process.on("message", (message) => {
      this.handlePluginMessage(processKey, message);
    });

    // Handle process exit
    process.on("exit", async (code, signal) => {
      debugLog(
        "process-manager",
        `Plugin ${pluginName} for org ${organizationId} exited with code ${code} and signal ${signal}`,
      );

      this.processes.delete(processKey);

      // If this was a graceful shutdown, don't restart
      if (processInfo.gracefulShutdown) {
        await pluginInstanceRepository.updateStatus(pluginInstanceId, "stopped");
        await pluginInstanceRepository.updateProcessId(pluginInstanceId, null);
        return;
      }

      // Check if this was a dependency error and we haven't tried recovery yet
      if (
        code !== 0 &&
        this.isDependencyError(processInfo.lastErrorOutput) &&
        !processInfo.installRecoveryAttempted
      ) {
        debugLog("process-manager", `Dependency error detected for ${pluginName}, attempting recovery...`);

        // Attempt recovery by running install command
        const recoverySuccess = await this.attemptDependencyRecovery(processKey, processInfo);

        if (recoverySuccess) {
          // Retry starting the plugin after successful recovery
          debugLog("process-manager", `Retrying plugin ${pluginName} after dependency recovery...`);
          try {
            await this.startPlugin(organizationId, processInfo.pluginId);
            return; // Exit early - plugin restarted successfully
          } catch (error) {
            debugLog(
              "process-manager",
              `Failed to restart ${pluginName} after recovery`,
              { level: "error", data: error instanceof Error ? error.message : String(error) }
            );
            // Fall through to error handling below
          }
        }
      }

      // Normal restart logic for non-dependency errors
      if (code !== 0 && processInfo.restartAttempts < this.MAX_RESTART_ATTEMPTS) {
        // Schedule restart
        await this.scheduleRestart(processKey, processInfo);
      } else {
        // Update status to stopped or error
        await pluginInstanceRepository.updateStatus(
          pluginInstanceId,
          code === 0 ? "stopped" : "error",
          code !== 0 ? `Process exited with code ${code}` : undefined,
        );
        await pluginInstanceRepository.updateProcessId(pluginInstanceId, null);
      }
    });

    // Handle process errors
    process.on("error", async (error) => {
      debugLog("process-manager", `Error in plugin ${pluginName} for org ${organizationId}`, { level: "error", data: error });

      await pluginInstanceRepository.updateStatus(pluginInstanceId, "error", error.message);
    });
  }

  /**
   * Handle IPC messages from plugins
   */
  private handlePluginMessage(processKey: string, message: unknown): void {
    const processInfo = this.processes.get(processKey);
    if (!processInfo) return;

    debugLog("process-manager", `[IPC from ${processInfo.pluginName}:${processInfo.organizationId}]`, { data: message });

    // Handle different message types
    if (typeof message === "object" && message !== null && "type" in message) {
      const msg = message as { type: string; error?: string };
      if (msg.type === "health") {
        pluginInstanceRepository.updateHealthCheck(processInfo.pluginInstanceId);
      } else if (msg.type === "error" && msg.error) {
        pluginInstanceRepository.updateStatus(processInfo.pluginInstanceId, "error", msg.error);
      }
    }
  }

  /**
   * Schedule a process restart
   */
  private async scheduleRestart(processKey: string, processInfo: ProcessInfo): Promise<void> {
    processInfo.restartAttempts++;

    await pluginInstanceRepository.incrementRestartCount(processInfo.pluginInstanceId);

    debugLog(
      "process-manager",
      `Scheduling restart for ${processInfo.pluginName} (attempt ${processInfo.restartAttempts}/${this.MAX_RESTART_ATTEMPTS})`,
    );

    const timer = setTimeout(async () => {
      this.restartTimers.delete(processKey);

      try {
        const [organizationId, pluginId] = processKey.split(":");
        await this.startPlugin(organizationId, pluginId);
      } catch (error) {
        debugLog("process-manager", "Failed to restart plugin", { level: "error", data: error });
      }
    }, this.RESTART_DELAY_MS);

    this.restartTimers.set(processKey, timer);
  }

  /**
   * Cross-platform command spawning helper
   */
  private spawnCommand(command: string, cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
    debugLog("process-manager", `Executing command: ${command} in ${cwd}`);

    // Simple command parsing - split on space
    // For complex arguments, the manifest should use simple patterns
    const parts = command.trim().split(/\s+/);
    const executable = parts[0];
    const args = parts.slice(1);

    debugLog("process-manager", `Spawning: ${executable} with args`, { data: args });

    // Use spawn with args array for better reliability and security
    const childProcess = spawn(executable, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"], // stdin, stdout, stderr pipes for MCP communication
    });

    // Critical: Add error handler immediately to prevent uncaught errors from crashing the app
    childProcess.on("error", (error) => {
      debugLog("process-manager", `Failed to spawn command "${command}"`, { level: "error", data: error });
      // Error will be handled by the 'exit' event handler in setupProcessHandlers
    });

    if (childProcess.pid) {
      debugLog("process-manager", `Started process with PID: ${childProcess.pid}`);
    }

    // Pipe outputs for visibility
    if (childProcess.stdout) {
      childProcess.stdout.pipe(process.stdout);
    }
    if (childProcess.stderr) {
      childProcess.stderr.pipe(process.stderr);
    }

    return childProcess;
  }

  /**
   * Check if error output indicates a dependency/module error
   */
  private isDependencyError(errorOutput: string): boolean {
    const dependencyErrorPatterns = [
      "ERR_MODULE_NOT_FOUND",
      "Cannot find module",
      "Cannot find package",
      "Module not found",
      "ENOENT.*node_modules",
      "Error: Cannot resolve module",
    ];

    return dependencyErrorPatterns.some((pattern) => new RegExp(pattern, "i").test(errorOutput));
  }

  /**
   * Attempt to recover from dependency error by running installCommand
   */
  private async attemptDependencyRecovery(
    processKey: string,
    processInfo: ProcessInfo,
  ): Promise<boolean> {
    // Don't attempt recovery if already tried
    if (processInfo.installRecoveryAttempted) {
      debugLog(
        "process-manager",
        `Dependency recovery already attempted for ${processInfo.pluginName}, skipping`,
        { level: "warn" }
      );
      return false;
    }

    debugLog(
      "process-manager",
      `Detected dependency error for ${processInfo.pluginName}, attempting recovery...`,
    );

    // Mark as attempted to prevent loops
    processInfo.installRecoveryAttempted = true;

    try {
      // Run the plugin's install command
      await pluginManagerService.installPlugin(processInfo.pluginId);

      // Build the plugin if it has a build command
      await pluginManagerService.buildPlugin(processInfo.pluginId);

      debugLog("process-manager", `Dependency recovery completed for ${processInfo.pluginName}`);
      return true;
    } catch (error) {
      debugLog(
        "process-manager",
        `Dependency recovery failed for ${processInfo.pluginName}`,
        { level: "error", data: error instanceof Error ? error.message : String(error) }
      );
      return false;
    }
  }

  /**
   * Get process key for organization and plugin
   */
  private getProcessKey(organizationId: string, pluginId: string): string {
    return `${organizationId}:${pluginId}`;
  }

  /**
   * Get all running processes
   */
  getRunningProcesses(): ProcessInfo[] {
    return Array.from(this.processes.values());
  }

  /**
   * Check if a plugin is running for an organization
   */
  isRunning(organizationId: string, pluginId: string): boolean {
    return this.processes.has(this.getProcessKey(organizationId, pluginId));
  }

  /**
   * Send JSON-RPC message to MCP plugin process via stdin/stdout
   * Automatically starts the plugin if not running
   */
  async sendToPlugin(
    organizationId: string,
    pluginId: string,
    action: string,
    payload?: unknown,
  ): Promise<unknown> {
    try {
      // Ensure plugin is running before sending message
      const { pluginInstanceManagerService } = await import("./plugin-instance-manager.service");
      await pluginInstanceManagerService.ensureInstanceRunning(organizationId, pluginId);

      const processKey = this.getProcessKey(organizationId, pluginId);
      const processInfo = this.processes.get(processKey);

      if (!processInfo) {
        throw new Error(`Plugin process not available after startup attempt`);
      }

      // For MCP communication, we expect the payload to be a JSON-RPC request
      const request = payload as any; // The payload should already be the JSON-RPC request

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          // Clean up handler on timeout
          processInfo.process.stdout?.off("data", responseHandler);
          reject(new Error(`MCP request timeout for ${request.method}`));
        }, 30000); // 30 second timeout

        let responseBuffer = "";

        // Set up one-time response handler for stdout
        const responseHandler = (data: Buffer) => {
          responseBuffer += data.toString();

          // Try to parse complete JSON-RPC responses
          const lines = responseBuffer.split("\n");
          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i].trim();
            if (line) {
              try {
                const response = JSON.parse(line);
                // Check if this is the response to our request
                if (response.id === request.id) {
                  clearTimeout(timeout);
                  processInfo.process.stdout?.off("data", responseHandler);

                  if (response.error) {
                    reject(new Error(`MCP Error: ${response.error.message || response.error}`));
                  } else {
                    resolve(response);
                  }
                  return;
                }
              } catch (parseError) {
                debugLog("process-manager", `Failed to parse MCP response line: ${line}`, { level: "warn", data: parseError });
              }
            }
          }

          // Keep the incomplete line for next data chunk
          responseBuffer = lines[lines.length - 1];
        };

        // Listen for stdout data (MCP responses)
        processInfo.process.stdout?.on("data", responseHandler);

        // Send JSON-RPC request to stdin
        const requestLine = JSON.stringify(request) + "\n";

        if (processInfo.process.stdin) {
          try {
            processInfo.process.stdin.write(requestLine);
          } catch (writeError) {
            clearTimeout(timeout);
            processInfo.process.stdout?.off("data", responseHandler);
            reject(new Error(`Failed to write to plugin stdin: ${writeError}`));
          }
        } else {
          clearTimeout(timeout);
          reject(new Error("Process stdin not available"));
        }
      });
    } catch (error) {
      // Ensure all errors are properly logged and formatted
      debugLog("process-manager", `sendToPlugin failed for ${pluginId}`, { level: "error", data: error });

      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to communicate with plugin: ${String(error)}`);
    }
  }

  /**
   * Stop all running processes (for graceful shutdown)
   */
  async stopAll(): Promise<void> {
    debugLog("process-manager", "Stopping all plugin processes...");

    const promises = Array.from(this.processes.entries()).map(async ([processKey]) => {
      const [organizationId, pluginId] = processKey.split(":");
      await this.stopPlugin(organizationId, pluginId);
    });

    await Promise.all(promises);
  }
}

export const processManagerService = new ProcessManagerService();
