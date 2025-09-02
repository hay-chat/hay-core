import { spawn, ChildProcess, execSync, exec } from "child_process";
import path from "path";
import { platform } from "os";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { PluginInstance } from "@server/entities/plugin-instance.entity";
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
  async startPlugin(
    organizationId: string,
    pluginId: string
  ): Promise<void> {
    const instance = await pluginInstanceRepository.findByOrgAndPlugin(
      organizationId,
      pluginId
    );

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
      // Some plugins (like chat-connectors) don't need a separate process
      // They just serve assets and handle webhooks
      console.log(`ℹ️  Plugin ${plugin.name} doesn't require a separate process`);
      await pluginInstanceRepository.updateStatus(instance.id, "running");
      return;
    }

    // Update status to starting
    await pluginInstanceRepository.updateStatus(instance.id, "starting");

    try {
      // Prepare environment variables
      const env = await environmentManagerService.prepareEnvironment(
        organizationId,
        instance
      );

      // Parse command and args
      const pluginPath = path.join(
        process.cwd(),
        "plugins",
        plugin.name.replace("hay-plugin-", "")
      );

      let childProcess: ChildProcess;
      
      // Check if command contains shell operators or needs special handling
      if (startCommand.includes("&&") || startCommand.includes("||")) {
        // For complex shell commands, execute them properly
        // Handle commands like "cd directory && npm run start"
        const commands = startCommand.split("&&").map(cmd => cmd.trim());
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
      await pluginInstanceRepository.updateProcessId(
        instance.id,
        String(pid)
      );
      await pluginInstanceRepository.updateStatus(instance.id, "running");

      // Set up event handlers
      this.setupProcessHandlers(processKey, processInfo);

      console.log(
        `✅ Started plugin ${plugin.name} for org ${organizationId} (PID: ${pid})`
      );
    } catch (error) {
      await pluginInstanceRepository.updateStatus(
        instance.id,
        "error",
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  /**
   * Stop a plugin process
   */
  async stopPlugin(
    organizationId: string,
    pluginId: string
  ): Promise<void> {
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
    await pluginInstanceRepository.updateStatus(
      processInfo.pluginInstanceId,
      "stopping"
    );

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
    await pluginInstanceRepository.updateStatus(
      processInfo.pluginInstanceId,
      "stopped"
    );
    await pluginInstanceRepository.updateProcessId(
      processInfo.pluginInstanceId,
      null
    );

    console.log(`🛑 Stopped plugin ${processInfo.pluginName} for org ${organizationId}`);
  }

  /**
   * Restart a plugin process
   */
  async restartPlugin(
    organizationId: string,
    pluginId: string
  ): Promise<void> {
    await this.stopPlugin(organizationId, pluginId);
    await this.startPlugin(organizationId, pluginId);
  }

  /**
   * Set up process event handlers
   */
  private setupProcessHandlers(
    processKey: string,
    processInfo: ProcessInfo
  ): void {
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
        `Plugin ${pluginName} for org ${organizationId} exited with code ${code} and signal ${signal}`
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
          code !== 0 ? `Process exited with code ${code}` : undefined
        );
        await pluginInstanceRepository.updateProcessId(pluginInstanceId, null);
      }
    });

    // Handle process errors
    process.on("error", async (error) => {
      console.error(
        `Error in plugin ${pluginName} for org ${organizationId}:`,
        error
      );
      
      await pluginInstanceRepository.updateStatus(
        pluginInstanceId,
        "error",
        error.message
      );
    });
  }

  /**
   * Handle IPC messages from plugins
   */
  private handlePluginMessage(processKey: string, message: any): void {
    const processInfo = this.processes.get(processKey);
    if (!processInfo) return;

    console.log(
      `[IPC from ${processInfo.pluginName}:${processInfo.organizationId}]`,
      message
    );

    // Handle different message types
    if (message.type === "health") {
      pluginInstanceRepository.updateHealthCheck(processInfo.pluginInstanceId);
    } else if (message.type === "error") {
      pluginInstanceRepository.updateStatus(
        processInfo.pluginInstanceId,
        "error",
        message.error
      );
    }
  }

  /**
   * Schedule a process restart
   */
  private async scheduleRestart(
    processKey: string,
    processInfo: ProcessInfo
  ): Promise<void> {
    processInfo.restartAttempts++;
    
    await pluginInstanceRepository.incrementRestartCount(
      processInfo.pluginInstanceId
    );
    
    console.log(
      `Scheduling restart for ${processInfo.pluginName} (attempt ${processInfo.restartAttempts}/${this.MAX_RESTART_ATTEMPTS})`
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
    
    // Parse the command to check if it needs shell execution
    const [cmd] = command.split(" ");
    
    // For npm/npx/node commands or complex shell commands, use exec
    // exec properly handles shell scripts and complex commands
    if (cmd === "npm" || cmd === "npx" || cmd === "node" || command.includes("&&") || command.includes("||")) {
      const childProcess = exec(command, {
        cwd,
        env: { ...process.env, ...env }, // Merge environments to preserve PATH
      });
      
      // exec returns a ChildProcess with PID
      // The PID should be available immediately after exec
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
    } else {
      // For simple commands, use spawn which gives us better control
      const args = command.split(" ").slice(1);
      const childProcess = spawn(cmd, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: ["pipe", "pipe", "pipe"],
      });
      
      if (childProcess.pid) {
        console.log(`Started process with PID: ${childProcess.pid}`);
      }
      
      // Pipe outputs
      if (childProcess.stdout) {
        childProcess.stdout.pipe(process.stdout);
      }
      if (childProcess.stderr) {
        childProcess.stderr.pipe(process.stderr);
      }
      
      return childProcess;
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
   * Send message to plugin process
   */
  async sendToPlugin(
    organizationId: string,
    pluginId: string,
    action: string,
    payload?: any
  ): Promise<any> {
    const processKey = this.getProcessKey(organizationId, pluginId);
    const processInfo = this.processes.get(processKey);

    if (!processInfo) {
      throw new Error(`Plugin process not running for ${processKey}`);
    }

    return new Promise((resolve, reject) => {
      const messageId = `${Date.now()}-${Math.random()}`;
      const timeout = setTimeout(() => {
        reject(new Error(`Plugin message timeout for ${action}`));
      }, 30000); // 30 second timeout

      // Set up one-time response handler
      const responseHandler = (message: any) => {
        if (message.responseId === messageId) {
          clearTimeout(timeout);
          processInfo.process.off("message", responseHandler);
          
          if (message.error) {
            reject(new Error(message.error));
          } else {
            resolve(message.result);
          }
        }
      };

      processInfo.process.on("message", responseHandler);

      // Send the message
      processInfo.process.send({
        id: messageId,
        action,
        payload,
      });
    });
  }

  /**
   * Stop all running processes (for graceful shutdown)
   */
  async stopAll(): Promise<void> {
    console.log("Stopping all plugin processes...");
    
    const promises = Array.from(this.processes.entries()).map(
      async ([processKey]) => {
        const [organizationId, pluginId] = processKey.split(":");
        await this.stopPlugin(organizationId, pluginId);
      }
    );

    await Promise.all(promises);
  }
}

export const processManagerService = new ProcessManagerService();