/**
 * Zendesk MCP Server - Stdio Process Wrapper
 *
 * Spawns the Zendesk MCP server as a child process and communicates
 * with it using JSON-RPC 2.0 over stdio transport.
 */

import { spawn, type ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Logger interface (matches HayLogger from SDK)
 */
interface Logger {
  debug(message: string, meta?: any): void;
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, meta?: any): void;
}

/**
 * MCP Tool Definition (matches MCP protocol)
 */
interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: any;
}

/**
 * JSON-RPC 2.0 Request
 */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: any;
}

/**
 * JSON-RPC 2.0 Response
 */
interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

/**
 * Zendesk MCP Server Options
 */
export interface ZendeskMcpServerOptions {
  subdomain: string;
  email: string;
  apiToken: string;
  logger: Logger;
}

/**
 * Zendesk MCP Server
 *
 * Spawns the Zendesk MCP server as a child process and provides
 * a simple interface for listing tools and calling them.
 *
 * This implements the McpServerInstance interface expected by the SDK.
 */
export class ZendeskMcpServer {
  private logger: Logger;
  private process: ChildProcess | null = null;
  private isRunning: boolean = false;
  private requestId: number = 0;
  private pendingRequests: Map<
    number | string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  > = new Map();
  private stdoutBuffer: string = '';
  private subdomain: string;
  private email: string;
  private apiToken: string;

  constructor(options: ZendeskMcpServerOptions) {
    this.logger = options.logger;
    this.subdomain = options.subdomain;
    this.email = options.email;
    this.apiToken = options.apiToken;
  }

  /**
   * Start the Zendesk MCP server process
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Zendesk MCP server is already running');
      return;
    }

    this.logger.info('Starting Zendesk MCP server process');

    try {
      // Path to the MCP server entry point
      const mcpServerPath = join(__dirname, '..', 'mcp', 'index.js');

      // Spawn the MCP server as a child process
      this.process = spawn('node', [mcpServerPath], {
        env: {
          ...process.env,
          ZENDESK_SUBDOMAIN: this.subdomain,
          ZENDESK_EMAIL: this.email,
          ZENDESK_API_TOKEN: this.apiToken,
        },
        stdio: ['pipe', 'pipe', 'pipe'], // stdin, stdout, stderr
      });

      // Handle stdout (JSON-RPC responses)
      this.process.stdout?.on('data', (data: Buffer) => {
        this.handleStdout(data);
      });

      // Handle stderr (logs from MCP server)
      this.process.stderr?.on('data', (data: Buffer) => {
        const message = data.toString().trim();
        if (message) {
          this.logger.debug(`[Zendesk MCP stderr] ${message}`);
        }
      });

      // Handle process exit
      this.process.on('exit', (code, signal) => {
        this.logger.warn('Zendesk MCP server process exited', { code, signal });
        this.isRunning = false;
        this.cleanup();
      });

      // Handle process errors
      this.process.on('error', (error) => {
        this.logger.error('Zendesk MCP server process error', { error: error.message });
        this.isRunning = false;
        this.cleanup();
      });

      // Wait for server to be ready (send initialize request)
      await this.initialize();

      this.isRunning = true;
      this.logger.info('Zendesk MCP server started successfully');
    } catch (error) {
      this.logger.error('Failed to start Zendesk MCP server', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.cleanup();
      throw error;
    }
  }

  /**
   * Initialize the MCP server (send initialize request)
   */
  private async initialize(): Promise<void> {
    try {
      const response = await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        clientInfo: {
          name: 'hay-zendesk-plugin',
          version: '2.0.0',
        },
      });

      this.logger.debug('MCP server initialized', { response });
    } catch (error) {
      this.logger.error('Failed to initialize MCP server', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Handle stdout data from MCP server
   */
  private handleStdout(data: Buffer): void {
    // Append to buffer
    this.stdoutBuffer += data.toString();

    // Process complete JSON-RPC messages (one per line)
    const lines = this.stdoutBuffer.split('\n');

    // Keep the last incomplete line in the buffer
    this.stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      try {
        const message = JSON.parse(trimmedLine) as JsonRpcResponse;
        this.handleJsonRpcResponse(message);
      } catch (error) {
        this.logger.warn('Failed to parse JSON-RPC message from stdout', {
          line: trimmedLine,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Handle JSON-RPC response
   */
  private handleJsonRpcResponse(response: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(response.id);

    if (!pending) {
      this.logger.warn('Received response for unknown request', { id: response.id });
      return;
    }

    // Clear timeout
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);

    // Handle error or result
    if (response.error) {
      pending.reject(
        new Error(`JSON-RPC error: ${response.error.message} (code: ${response.error.code})`)
      );
    } else {
      pending.resolve(response.result);
    }
  }

  /**
   * Send JSON-RPC request to MCP server
   */
  private sendRequest(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin) {
        reject(new Error('MCP server process not running'));
        return;
      }

      const id = ++this.requestId;

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      // Set up timeout (30 seconds)
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout for method: ${method}`));
      }, 30000);

      // Store pending request
      this.pendingRequests.set(id, { resolve, reject, timeout });

      // Send request via stdin
      const requestLine = JSON.stringify(request) + '\n';
      this.process.stdin.write(requestLine, (error) => {
        if (error) {
          clearTimeout(timeout);
          this.pendingRequests.delete(id);
          reject(new Error(`Failed to write to stdin: ${error.message}`));
        }
      });
    });
  }

  /**
   * List available tools from the MCP server
   */
  async listTools(): Promise<MCPTool[]> {
    if (!this.isRunning) {
      throw new Error('MCP server is not running');
    }

    try {
      const response = await this.sendRequest('tools/list', {});

      // MCP protocol returns tools in response.tools array
      const tools = response.tools || [];

      this.logger.debug(`Listed ${tools.length} tools from Zendesk MCP server`);

      return tools;
    } catch (error) {
      this.logger.error('Failed to list tools', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Call a tool on the MCP server
   */
  async callTool(toolName: string, args: Record<string, any>): Promise<any> {
    if (!this.isRunning) {
      throw new Error('MCP server is not running');
    }

    try {
      this.logger.debug(`Calling tool: ${toolName}`, { args });

      const response = await this.sendRequest('tools/call', {
        name: toolName,
        arguments: args,
      });

      this.logger.debug(`Tool call successful: ${toolName}`);

      return response;
    } catch (error) {
      this.logger.error(`Failed to call tool: ${toolName}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Stop the MCP server process
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping Zendesk MCP server');

    this.cleanup();

    this.logger.info('Zendesk MCP server stopped');
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    this.isRunning = false;

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('MCP server stopped'));
    }
    this.pendingRequests.clear();

    // Kill the process
    if (this.process) {
      this.process.kill('SIGTERM');

      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.logger.warn('Force killing Zendesk MCP server process');
          this.process.kill('SIGKILL');
        }
      }, 5000);

      this.process = null;
    }
  }
}
