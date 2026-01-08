/**
 * Stdio MCP Client
 *
 * Communicates with stdio-based MCP servers using JSON-RPC protocol.
 * This allows SDK to work with MCP servers that use stdin/stdout
 * instead of HTTP transport.
 */

import { ChildProcess } from 'child_process';
import { createInterface, Interface as ReadlineInterface } from 'readline';
import type { HayLogger } from '../types/index.js';

export interface StdioMcpClientOptions {
  /**
   * The child process running the MCP server
   */
  process: ChildProcess;

  /**
   * Logger instance
   */
  logger: HayLogger;

  /**
   * Request timeout in milliseconds (default: 30000)
   */
  timeout?: number;
}

export interface McpTool {
  name: string;
  description?: string;
  input_schema: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Client for communicating with stdio-based MCP servers
 */
export class StdioMcpClient {
  private process: ChildProcess;
  private logger: HayLogger;
  private timeout: number;
  private requestId = 1;
  private pendingRequests = new Map<number, PendingRequest>();
  private readline: ReadlineInterface | null = null;
  private isReady = false;
  private readyPromise: Promise<void>;
  private readyResolve?: () => void;

  constructor(options: StdioMcpClientOptions) {
    this.process = options.process;
    this.logger = options.logger;
    this.timeout = options.timeout || 30000;

    // Create a promise that resolves when the client is ready
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });

    this.setupIoHandlers();
  }

  /**
   * Setup stdin/stdout handlers for the child process
   */
  private setupIoHandlers(): void {
    if (!this.process.stdout) {
      throw new Error('Child process stdout is not available');
    }

    if (!this.process.stdin) {
      throw new Error('Child process stdin is not available');
    }

    // Create readline interface for stdout
    this.readline = createInterface({
      input: this.process.stdout,
      terminal: false,
    });

    // Handle responses from MCP server
    this.readline.on('line', (line: string) => {
      this.handleResponse(line);
    });

    // Handle stderr output
    if (this.process.stderr) {
      this.process.stderr.on('data', (data: Buffer) => {
        const message = data.toString().trim();
        // Only log non-empty stderr messages
        if (message) {
          this.logger.debug('[Stdio MCP] stderr:', message);
        }
      });
    }

    // Handle process exit
    this.process.on('exit', (code: number | null, signal: string | null) => {
      this.logger.info('[Stdio MCP] Process exited', { code, signal });
      this.cleanup();
    });

    // Handle process errors
    this.process.on('error', (error: Error) => {
      this.logger.error('[Stdio MCP] Process error:', error);
      this.cleanup();
    });

    // Mark as ready
    this.isReady = true;
    if (this.readyResolve) {
      this.readyResolve();
    }

    this.logger.debug('[Stdio MCP] IO handlers setup complete');
  }

  /**
   * Handle a JSON-RPC response from the MCP server
   */
  private handleResponse(line: string): void {
    try {
      const response = JSON.parse(line);

      if (!response.jsonrpc || response.jsonrpc !== '2.0') {
        this.logger.warn('[Stdio MCP] Invalid JSON-RPC version in response:', response);
        return;
      }

      const { id, result, error } = response;

      // Look up the pending request
      const pending = this.pendingRequests.get(id);
      if (!pending) {
        this.logger.warn('[Stdio MCP] Received response for unknown request ID:', id);
        return;
      }

      // Clear the timeout timer
      clearTimeout(pending.timer);
      this.pendingRequests.delete(id);

      // Resolve or reject based on response
      if (error) {
        pending.reject(new Error(error.message || 'MCP request failed'));
      } else {
        pending.resolve(result);
      }
    } catch (err) {
      this.logger.error('[Stdio MCP] Failed to parse response', { error: err, line });
    }
  }

  /**
   * Send a JSON-RPC request to the MCP server
   */
  private async sendRequest(method: string, params: any = {}): Promise<any> {
    // Wait for the client to be ready
    await this.readyPromise;

    if (!this.isReady || !this.process.stdin) {
      throw new Error('Stdio MCP client is not ready');
    }

    return new Promise((resolve, reject) => {
      const id = this.requestId++;
      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      // Setup timeout
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request timeout after ${this.timeout}ms`));
      }, this.timeout);

      // Store the pending request
      this.pendingRequests.set(id, { resolve, reject, timer });

      // Send the request
      const requestLine = JSON.stringify(request);
      this.logger.debug('[Stdio MCP] Sending request:', { method, id });

      try {
        this.process.stdin!.write(requestLine + '\n');
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  /**
   * List all available tools from the MCP server
   */
  async listTools(): Promise<McpTool[]> {
    this.logger.debug('[Stdio MCP] Listing tools');

    try {
      const result = await this.sendRequest('tools/list', {});

      // Handle different response formats
      if (Array.isArray(result)) {
        return result;
      }

      if (result && Array.isArray(result.tools)) {
        return result.tools;
      }

      this.logger.warn('[Stdio MCP] Unexpected listTools response format:', result);
      return [];
    } catch (err) {
      this.logger.error('[Stdio MCP] Failed to list tools:', err);
      throw err;
    }
  }

  /**
   * Call a tool on the MCP server
   */
  async callTool(name: string, args: Record<string, any>): Promise<any> {
    this.logger.debug('[Stdio MCP] Calling tool', { name, args });

    try {
      const result = await this.sendRequest('tools/call', {
        name,
        arguments: args,
      });

      return result;
    } catch (err) {
      this.logger.error('[Stdio MCP] Failed to call tool', { name, error: err });
      throw err;
    }
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    // Reject all pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('MCP process terminated'));
    }
    this.pendingRequests.clear();

    // Close readline
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }

    this.isReady = false;
  }

  /**
   * Stop the client and cleanup
   */
  async stop(): Promise<void> {
    this.logger.debug('[Stdio MCP] Stopping client');
    this.cleanup();

    // The process itself should be managed by the parent
    // (we don't kill it here, that's the wrapper's responsibility)
  }
}
