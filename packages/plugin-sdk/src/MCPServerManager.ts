import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs/promises';

// ============================================================================
// Types
// ============================================================================

export interface MCPToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, any>;
}

export interface LocalMCPConfig {
  serverId: string;
  serverPath: string;
  startCommand: string;
  installCommand?: string;
  buildCommand?: string;
  tools: MCPToolDefinition[];
  env?: Record<string, string>;
}

export interface RemoteMCPConfig {
  serverId: string;
  url: string;
  transport: 'http' | 'sse' | 'websocket';
  auth?: {
    type: 'bearer' | 'apiKey' | 'oauth2';
    token?: string;
    apiKey?: string;
    // OAuth2 configuration
    authorizationUrl?: string;
    tokenUrl?: string;
    scopes?: string[];
    optionalScopes?: string[];
    pkce?: boolean;
    clientIdEnvVar?: string;
    clientSecretEnvVar?: string;
  };
  tools: MCPToolDefinition[];
}

export interface MCPManagerConfig {
  workingDir: string;
  logger?: Console;
}

interface LocalServerInfo {
  config: LocalMCPConfig;
  process: ChildProcess;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  startedAt?: Date;
  lastHealthCheck?: Date;
  restartCount: number;
  error?: string;
}

interface RemoteServerInfo {
  config: RemoteMCPConfig;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  connectedAt?: Date;
  lastHealthCheck?: Date;
  error?: string;
}

// ============================================================================
// MCP Server Manager
// ============================================================================

/**
 * MCPServerManager
 *
 * Manages MCP (Model Context Protocol) servers for a plugin worker.
 * Handles both local servers (subprocesses) and remote servers (HTTP/SSE).
 *
 * Features:
 * - Spawn and manage local MCP server subprocesses
 * - Connect to remote MCP servers
 * - Health checks and auto-restart
 * - Tool execution routing
 * - Graceful shutdown
 *
 * Example:
 * ```typescript
 * const manager = new MCPServerManager({
 *   workingDir: process.cwd(),
 *   logger: console,
 * });
 *
 * await manager.startLocalServer({
 *   serverId: 'email-mcp',
 *   serverPath: './mcp',
 *   startCommand: 'node index.js',
 *   tools: [...],
 * });
 * ```
 */
export class MCPServerManager extends EventEmitter {
  private localServers: Map<string, LocalServerInfo> = new Map();
  private remoteServers: Map<string, RemoteServerInfo> = new Map();
  private config: MCPManagerConfig;
  private healthCheckInterval?: NodeJS.Timeout;
  private isShuttingDown = false;

  constructor(config: MCPManagerConfig) {
    super();
    this.config = config;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Initialize the MCP manager
   */
  async initialize(): Promise<void> {
    this.log('[MCPManager] Initializing...');

    // Start health check loop (every 30 seconds)
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks().catch((err) => {
        this.log('[MCPManager] Health check error:', err);
      });
    }, 30000);

    this.log('[MCPManager] Initialized');
  }

  /**
   * Shutdown all MCP servers
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    this.log('[MCPManager] Shutting down...');

    // Stop health checks
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Stop all local servers
    const localStops = Array.from(this.localServers.keys()).map((serverId) =>
      this.stopLocalServer(serverId)
    );

    // Disconnect all remote servers
    const remoteDisconnects = Array.from(this.remoteServers.keys()).map((serverId) =>
      this.disconnectRemoteServer(serverId)
    );

    await Promise.all([...localStops, ...remoteDisconnects]);

    this.log('[MCPManager] Shutdown complete');
  }

  // ==========================================================================
  // Local MCP Servers (subprocess management)
  // ==========================================================================

  /**
   * Start a local MCP server as a subprocess
   */
  async startLocalServer(config: LocalMCPConfig): Promise<void> {
    const { serverId, serverPath, startCommand, installCommand, buildCommand } = config;

    if (this.localServers.has(serverId)) {
      throw new Error(`Local MCP server ${serverId} already running`);
    }

    this.log(`[MCPManager] Starting local server: ${serverId}`);

    // Resolve server path
    const resolvedPath = path.resolve(this.config.workingDir, serverPath);

    // Check if path exists
    try {
      await fs.access(resolvedPath);
    } catch (err) {
      throw new Error(`Server path not found: ${resolvedPath}`);
    }

    // Run install command if specified
    if (installCommand) {
      this.log(`[MCPManager] Running install command for ${serverId}: ${installCommand}`);
      await this.runCommand(resolvedPath, installCommand);
    }

    // Run build command if specified
    if (buildCommand) {
      this.log(`[MCPManager] Running build command for ${serverId}: ${buildCommand}`);
      await this.runCommand(resolvedPath, buildCommand);
    }

    // Parse start command
    const [command, ...args] = startCommand.split(' ');

    // Spawn the MCP server process
    const childProcess = spawn(command, args, {
      cwd: resolvedPath,
      env: {
        ...process.env,
        ...config.env,
      },
      stdio: ['pipe', 'pipe', 'pipe'], // stdin, stdout, stderr
    });

    // Store server info
    const serverInfo: LocalServerInfo = {
      config,
      process: childProcess,
      status: 'starting',
      startedAt: new Date(),
      restartCount: 0,
    };

    this.localServers.set(serverId, serverInfo);

    // Handle process events
    childProcess.on('error', (err) => {
      this.log(`[MCPManager] Server ${serverId} error:`, err);
      serverInfo.status = 'error';
      serverInfo.error = err.message;
      this.emit('server-error', { serverId, error: err });
    });

    childProcess.on('exit', (code, signal) => {
      this.log(`[MCPManager] Server ${serverId} exited (code: ${code}, signal: ${signal})`);
      serverInfo.status = 'stopped';

      // Auto-restart if not shutting down and restart count < 3
      if (!this.isShuttingDown && serverInfo.restartCount < 3) {
        this.log(`[MCPManager] Auto-restarting server ${serverId}...`);
        serverInfo.restartCount++;
        setTimeout(() => {
          this.startLocalServer(config).catch((err) => {
            this.log(`[MCPManager] Failed to restart ${serverId}:`, err);
          });
        }, 5000); // Wait 5 seconds before restart
      }
    });

    // Capture stdout/stderr
    childProcess.stdout?.on('data', (data) => {
      this.log(`[MCPManager:${serverId}] ${data.toString().trim()}`);
    });

    childProcess.stderr?.on('data', (data) => {
      this.log(`[MCPManager:${serverId}:error] ${data.toString().trim()}`);
    });

    // Wait for server to be ready (simple timeout for now)
    await new Promise((resolve) => setTimeout(resolve, 2000));

    serverInfo.status = 'running';
    this.log(`[MCPManager] Server ${serverId} started successfully`);
    this.emit('server-started', { serverId });
  }

  /**
   * Stop a local MCP server
   */
  async stopLocalServer(serverId: string): Promise<void> {
    const serverInfo = this.localServers.get(serverId);

    if (!serverInfo) {
      this.log(`[MCPManager] Server ${serverId} not found`);
      return;
    }

    this.log(`[MCPManager] Stopping server ${serverId}...`);
    serverInfo.status = 'stopping';

    // Send SIGTERM
    serverInfo.process.kill('SIGTERM');

    // Wait 5 seconds, then SIGKILL if still alive
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (serverInfo.process.killed === false) {
          this.log(`[MCPManager] Force killing server ${serverId}...`);
          serverInfo.process.kill('SIGKILL');
        }
        resolve(void 0);
      }, 5000);

      serverInfo.process.on('exit', () => {
        clearTimeout(timeout);
        resolve(void 0);
      });
    });

    this.localServers.delete(serverId);
    this.log(`[MCPManager] Server ${serverId} stopped`);
    this.emit('server-stopped', { serverId });
  }

  // ==========================================================================
  // Remote MCP Servers (HTTP/SSE connection)
  // ==========================================================================

  /**
   * Connect to a remote MCP server
   */
  async connectRemoteServer(config: RemoteMCPConfig): Promise<void> {
    const { serverId, url } = config;

    if (this.remoteServers.has(serverId)) {
      throw new Error(`Remote MCP server ${serverId} already connected`);
    }

    this.log(`[MCPManager] Connecting to remote server: ${serverId} (${url})`);

    // Store server info
    const serverInfo: RemoteServerInfo = {
      config,
      status: 'connecting',
    };

    this.remoteServers.set(serverId, serverInfo);

    // Test connection (simple HTTP ping for now)
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getAuthHeaders(config.auth),
      });

      if (!response.ok) {
        throw new Error(`Connection failed: ${response.status} ${response.statusText}`);
      }

      serverInfo.status = 'connected';
      serverInfo.connectedAt = new Date();
      this.log(`[MCPManager] Connected to remote server ${serverId}`);
      this.emit('server-connected', { serverId });
    } catch (err) {
      serverInfo.status = 'error';
      serverInfo.error = err instanceof Error ? err.message : String(err);
      this.log(`[MCPManager] Failed to connect to ${serverId}:`, err);
      throw err;
    }
  }

  /**
   * Disconnect from a remote MCP server
   */
  async disconnectRemoteServer(serverId: string): Promise<void> {
    const serverInfo = this.remoteServers.get(serverId);

    if (!serverInfo) {
      this.log(`[MCPManager] Remote server ${serverId} not found`);
      return;
    }

    this.log(`[MCPManager] Disconnecting from remote server ${serverId}...`);

    this.remoteServers.delete(serverId);
    this.log(`[MCPManager] Disconnected from remote server ${serverId}`);
    this.emit('server-disconnected', { serverId });
  }

  // ==========================================================================
  // Health Checks
  // ==========================================================================

  /**
   * Perform health checks on all servers
   */
  private async performHealthChecks(): Promise<void> {
    // Check local servers
    for (const [serverId, serverInfo] of this.localServers.entries()) {
      try {
        const isHealthy = await this.checkLocalServerHealth(serverId);
        serverInfo.lastHealthCheck = new Date();

        if (!isHealthy && serverInfo.status === 'running') {
          this.log(`[MCPManager] Server ${serverId} health check failed`);
          serverInfo.status = 'error';
          this.emit('server-unhealthy', { serverId });
        }
      } catch (err) {
        this.log(`[MCPManager] Health check error for ${serverId}:`, err);
      }
    }

    // Check remote servers
    for (const [serverId, serverInfo] of this.remoteServers.entries()) {
      try {
        const isHealthy = await this.checkRemoteServerHealth(serverId);
        serverInfo.lastHealthCheck = new Date();

        if (!isHealthy && serverInfo.status === 'connected') {
          this.log(`[MCPManager] Remote server ${serverId} health check failed`);
          serverInfo.status = 'error';
          this.emit('server-unhealthy', { serverId });
        }
      } catch (err) {
        this.log(`[MCPManager] Health check error for ${serverId}:`, err);
      }
    }
  }

  /**
   * Check health of a local MCP server
   */
  private async checkLocalServerHealth(serverId: string): Promise<boolean> {
    const serverInfo = this.localServers.get(serverId);

    if (!serverInfo) {
      return false;
    }

    // Check if process is still alive
    if (serverInfo.process.killed || serverInfo.process.exitCode !== null) {
      return false;
    }

    return true;
  }

  /**
   * Check health of a remote MCP server
   */
  private async checkRemoteServerHealth(serverId: string): Promise<boolean> {
    const serverInfo = this.remoteServers.get(serverId);

    if (!serverInfo) {
      return false;
    }

    try {
      const response = await fetch(serverInfo.config.url, {
        method: 'GET',
        headers: this.getAuthHeaders(serverInfo.config.auth),
      });

      return response.ok;
    } catch (err) {
      return false;
    }
  }

  // ==========================================================================
  // Status & Info
  // ==========================================================================

  /**
   * Get status of a server
   */
  getServerStatus(serverId: string): string | undefined {
    const localInfo = this.localServers.get(serverId);
    if (localInfo) {
      return localInfo.status;
    }

    const remoteInfo = this.remoteServers.get(serverId);
    if (remoteInfo) {
      return remoteInfo.status;
    }

    return undefined;
  }

  /**
   * Get all registered servers
   */
  getServers(): { local: string[]; remote: string[] } {
    return {
      local: Array.from(this.localServers.keys()),
      remote: Array.from(this.remoteServers.keys()),
    };
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Run a command in a directory
   */
  private async runCommand(cwd: string, command: string): Promise<void> {
    const [cmd, ...args] = command.split(' ');

    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { cwd, stdio: 'inherit' });

      proc.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed with code ${code}: ${command}`));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Get auth headers for remote server
   */
  private getAuthHeaders(
    auth?: RemoteMCPConfig['auth']
  ): Record<string, string> {
    if (!auth) {
      return {};
    }

    if (auth.type === 'bearer' && auth.token) {
      return { Authorization: `Bearer ${auth.token}` };
    }

    if (auth.type === 'apiKey' && auth.apiKey) {
      return { 'X-API-Key': auth.apiKey };
    }

    return {};
  }

  /**
   * Log helper
   */
  private log(...args: any[]): void {
    if (this.config.logger) {
      this.config.logger.log(...args);
    }
  }
}
