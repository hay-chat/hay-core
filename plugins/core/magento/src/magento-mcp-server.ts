import { spawn, ChildProcess } from 'child_process';
import { HayLogger } from '@hay/plugin-sdk-v2';
import { StdioMcpClient, McpTool } from '@hay/plugin-sdk-v2/sdk/stdio-mcp-client';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface MagentoMcpServerConfig {
  baseUrl: string;
  apiToken: string;
  logger: HayLogger;
}

/**
 * Magento MCP Server wrapper
 *
 * Manages a child process that runs the Magento MCP server
 * and communicates with it via stdio using JSON-RPC protocol
 */
export class MagentoMcpServer {
  name = 'magento';
  version = '1.0.0';

  private config: MagentoMcpServerConfig;
  private process: ChildProcess | null = null;
  private stdioClient: StdioMcpClient | null = null;

  constructor(config: MagentoMcpServerConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    const { baseUrl, apiToken, logger } = this.config;

    logger.info('[Magento MCP Server] Starting child process');

    // Resolve absolute path to MCP directory
    // __dirname points to /plugins/core/magento/dist (compiled code)
    // MCP server is in /plugins/core/magento/mcp
    const mcpDir = join(__dirname, '..', 'mcp');

    logger.debug('[Magento MCP Server] MCP directory:', mcpDir);

    // Spawn the MCP server process
    this.process = spawn('node', ['mcp-server.js'], {
      cwd: mcpDir,
      env: {
        ...process.env,
        MAGENTO_BASE_URL: baseUrl,
        MAGENTO_API_TOKEN: apiToken,
      },
      stdio: ['pipe', 'pipe', 'pipe'], // stdin, stdout, stderr
    });

    // Create stdio client for JSON-RPC communication
    this.stdioClient = new StdioMcpClient({
      process: this.process,
      logger: logger,
      timeout: 30000,
    });

    this.process.on('error', (error) => {
      logger.error('[Magento MCP Server] Process error:', error);
    });

    this.process.on('exit', (code, signal) => {
      logger.info('[Magento MCP Server] Process exited', { code, signal });
    });

    logger.info('[Magento MCP Server] Process started', { pid: this.process.pid });
  }

  /**
   * List all available tools from the MCP server
   */
  async listTools(): Promise<McpTool[]> {
    if (!this.stdioClient) {
      throw new Error('MCP server not started');
    }
    return this.stdioClient.listTools();
  }

  /**
   * Call a tool on the MCP server
   */
  async callTool(name: string, args: Record<string, any>): Promise<any> {
    if (!this.stdioClient) {
      throw new Error('MCP server not started');
    }
    return this.stdioClient.callTool(name, args);
  }

  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    this.config.logger.info('[Magento MCP Server] Stopping process');

    // Stop the stdio client first
    if (this.stdioClient) {
      await this.stdioClient.stop();
      this.stdioClient = null;
    }

    return new Promise((resolve) => {
      if (!this.process) {
        resolve();
        return;
      }

      this.process.once('exit', () => {
        this.config.logger.info('[Magento MCP Server] Process stopped');
        this.process = null;
        resolve();
      });

      // Send SIGTERM to gracefully stop the process
      this.process.kill('SIGTERM');

      // Force kill after 5 seconds if it doesn't stop
      setTimeout(() => {
        if (this.process) {
          this.config.logger.warn('[Magento MCP Server] Force killing process');
          this.process.kill('SIGKILL');
        }
      }, 5000);
    });
  }
}
