import { spawn, ChildProcess } from "child_process";
import path from "path";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { pluginManagerService } from "./plugin-manager.service";
import { environmentManagerService } from "./environment-manager.service";
import { getUTCNow } from "../utils/date.utils";

interface ProcessInfo {
  process: ChildProcess;
  pluginInstanceId: string;
  organizationId: string;
  pluginName: string;
  startedAt: Date;
  restartAttempts: number;
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
      console.log(`Plugin already running for ${processKey}`);
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
      console.log(`ℹ️  Plugin ${plugin.name} doesn't require a separate process`);
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
        startedAt: getUTCNow(),
        restartAttempts: 0,
      };

      this.processes.set(processKey, processInfo);

      // Update process ID and status
      // Note: exec might not have PID immediately, but we can still track the process
      const pid = childProcess.pid || "managed";
      await pluginInstanceRepository.updateProcessId(instance.id, String(pid));
      await pluginInstanceRepository.updateStatus(instance.id, "running");

      // Set up event handlers AFTER storing process info
      this.setupProcessHandlers(processKey, processInfo);

      console.log(`✅ Started plugin ${plugin.name} for org ${organizationId} (PID: ${pid})`);
    } catch (error) {
      console.error(`❌ [ProcessManager] Failed to start plugin ${plugin.name}:`, error);

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
      console.log(`No running process found for ${processKey}`);
      return;
    }

    // Cancel any restart timer
    const restartTimer = this.restartTimers.get(processKey);
    if (restartTimer) {
      clearTimeout(restartTimer);
      this.restartTimers.delete(processKey);
    }

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

    console.log(`🛑 Stopped plugin ${processInfo.pluginName} for org ${organizationId}`);
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
      console.log(`[${pluginName}:${organizationId}] ${data.toString()}`);
    });

    // Handle stderr
    process.stderr?.on("data", (data) => {
      console.error(`[${pluginName}:${organizationId}] ERROR: ${data.toString()}`);
    });

    // Handle IPC messages
    process.on("message", (message) => {
      this.handlePluginMessage(processKey, message);
    });

    // Handle process exit
    process.on("exit", async (code, signal) => {
      console.log(
        `Plugin ${pluginName} for org ${organizationId} exited with code ${code} and signal ${signal}`,
      );

      this.processes.delete(processKey);

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
      console.error(`Error in plugin ${pluginName} for org ${organizationId}:`, error);

      await pluginInstanceRepository.updateStatus(pluginInstanceId, "error", error.message);
    });
  }

  /**
   * Handle IPC messages from plugins
   */
  private handlePluginMessage(processKey: string, message: unknown): void {
    const processInfo = this.processes.get(processKey);
    if (!processInfo) return;

    console.log(`[IPC from ${processInfo.pluginName}:${processInfo.organizationId}]`, message);

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

    console.log(
      `Scheduling restart for ${processInfo.pluginName} (attempt ${processInfo.restartAttempts}/${this.MAX_RESTART_ATTEMPTS})`,
    );

    const timer = setTimeout(async () => {
      this.restartTimers.delete(processKey);

      try {
        const [organizationId, pluginId] = processKey.split(":");
        await this.startPlugin(organizationId, pluginId);
      } catch (error) {
        console.error(`Failed to restart plugin:`, error);
      }
    }, this.RESTART_DELAY_MS);

    this.restartTimers.set(processKey, timer);
  }

  /**
   * Cross-platform command spawning helper
   */
  private spawnCommand(command: string, cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
    console.log(`Executing command: ${command} in ${cwd}`);

    // Simple command parsing - split on space
    // For complex arguments, the manifest should use simple patterns
    const parts = command.trim().split(/\s+/);
    const executable = parts[0];
    const args = parts.slice(1);

    console.log(`Spawning: ${executable} with args:`, args);

    // Use spawn with args array for better reliability and security
    const childProcess = spawn(executable, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"], // stdin, stdout, stderr pipes for MCP communication
    });

    // Critical: Add error handler immediately to prevent uncaught errors from crashing the app
    childProcess.on("error", (error) => {
      console.error(`[ProcessManager] Failed to spawn command "${command}":`, error);
      // Error will be handled by the 'exit' event handler in setupProcessHandlers
    });

    if (childProcess.pid) {
      console.log(`Started process with PID: ${childProcess.pid}`);
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
                console.warn(`Failed to parse MCP response line: ${line}`, parseError);
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
      console.error(`❌ [ProcessManager] sendToPlugin failed for ${pluginId}:`, error);

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
    console.log("Stopping all plugin processes...");

    const promises = Array.from(this.processes.entries()).map(async ([processKey]) => {
      const [organizationId, pluginId] = processKey.split(":");
      await this.stopPlugin(organizationId, pluginId);
    });

    await Promise.all(promises);
  }
}

export const processManagerService = new ProcessManagerService();
