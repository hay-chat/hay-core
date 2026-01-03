import { spawn, ChildProcess } from 'child_process';
import { HayLogger } from '@hay/plugin-sdk-v2';
import { StdioMcpClient, McpTool } from '@hay/plugin-sdk-v2/sdk/stdio-mcp-client';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface WooCommerceMcpServerConfig {
  siteUrl: string;
  consumerKey: string;
  consumerSecret: string;
  username?: string;
  password?: string;
  logger: HayLogger;
}

/**
 * WooCommerce MCP Server wrapper
 *
 * Manages a child process that runs the WooCommerce MCP server
 * and communicates with it via stdio using JSON-RPC protocol
 */
export class WooCommerceMcpServer {
  name = 'woocommerce';
  version = '1.0.0';

  private config: WooCommerceMcpServerConfig;
  private process: ChildProcess | null = null;
  private stdioClient: StdioMcpClient | null = null;

  constructor(config: WooCommerceMcpServerConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    const { siteUrl, consumerKey, consumerSecret, username, password, logger } = this.config;

    logger.info('[WooCommerce MCP Server] Starting child process');

    // Resolve absolute path to MCP directory
    // __dirname points to /plugins/core/woocommerce/dist (compiled code)
    // MCP server is in /plugins/core/woocommerce/mcp
    const mcpDir = join(__dirname, '..', 'mcp');

    logger.debug('[WooCommerce MCP Server] MCP directory:', mcpDir);

    // Spawn the MCP server process
    this.process = spawn('node', ['index.js'], {
      cwd: mcpDir,
      env: {
        ...process.env,
        WORDPRESS_SITE_URL: siteUrl,
        WOOCOMMERCE_CONSUMER_KEY: consumerKey,
        WOOCOMMERCE_CONSUMER_SECRET: consumerSecret,
        WORDPRESS_USERNAME: username || '',
        WORDPRESS_PASSWORD: password || '',
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
      logger.error('[WooCommerce MCP Server] Process error:', error);
    });

    this.process.on('exit', (code, signal) => {
      logger.info('[WooCommerce MCP Server] Process exited', { code, signal });
    });

    logger.info('[WooCommerce MCP Server] Process started', { pid: this.process.pid });
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

    this.config.logger.info('[WooCommerce MCP Server] Stopping process');

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
        this.config.logger.info('[WooCommerce MCP Server] Process stopped');
        this.process = null;
        resolve();
      });

      // Send SIGTERM to gracefully stop the process
      this.process.kill('SIGTERM');

      // Force kill after 5 seconds if it doesn't stop
      setTimeout(() => {
        if (this.process) {
          this.config.logger.warn('[WooCommerce MCP Server] Force killing process');
          this.process.kill('SIGKILL');
        }
      }, 5000);
    });
  }
}
