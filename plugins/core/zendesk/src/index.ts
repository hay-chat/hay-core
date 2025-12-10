import { HayPlugin, startPluginWorker } from '@hay/plugin-sdk';
import * as tools from './tools.json';

/**
 * Zendesk Plugin
 *
 * Connect your Zendesk account to manage tickets, customers, and support workflows
 */
export class ZendeskPlugin extends HayPlugin {
  constructor() {
    super(); // Metadata loaded from package.json automatically
  }

  /**
   * Initialize plugin
   */
  async onInitialize() {
    console.log('[zendesk] Plugin initialized');
  }

  /**
   * Register MCP server with tools
   */
  protected async registerMCP() {
    await this.sdk.mcp.registerLocalMCP({
      serverPath: './mcp',
      startCommand: 'node index.js',
      installCommand: 'npm install',
      tools: tools as any,
    });
  }
}

// Start the plugin worker if this file is run directly
if (require.main === module) {
  startPluginWorker(ZendeskPlugin);
}
