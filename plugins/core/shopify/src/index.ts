import { HayPlugin, startPluginWorker } from '@hay/plugin-sdk';

/**
 * Shopify Plugin
 *
 * Connect your Shopify store to manage products, orders, customers, and e-commerce operations through Shopify\'s GraphQL Admin API
 */
export class ShopifyPlugin extends HayPlugin {
  constructor() {
    super(); // Metadata loaded from package.json automatically
  }

  async onInitialize() {
    console.log('[hay-plugin-shopify] Plugin initialized');

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

if (require.main === module) {
  startPluginWorker(ShopifyPlugin);
}
