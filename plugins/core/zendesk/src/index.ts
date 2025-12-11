import { HayPlugin, startPluginWorker } from '@hay/plugin-sdk';

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

    // Register setup instructions UI
    this.registerUIExtension({
      slot: 'after-settings',
      component: 'components/settings/AfterSettings.vue',
    });
  }

  /**
   * Register MCP server
   * Tools will be discovered automatically from the MCP server via listTools()
   */
  protected async registerMCP() {
    await this.sdk.mcp.registerLocalMCP({
      serverPath: './mcp',
      startCommand: 'node index.js',
      installCommand: 'npm install',
    });
  }
}

// Start the plugin worker if this file is run directly
if (require.main === module) {
  startPluginWorker(ZendeskPlugin);
}
