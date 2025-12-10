import { HayPlugin, startPluginWorker } from '@hay/plugin-sdk';
import * as tools from './tools.json';

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
  }

  protected async registerMCP() {
    await this.sdk.mcp.registerLocalMCP({
      serverPath: './mcp',
      startCommand: 'node index.js',
      installCommand: 'npm install',
      tools: tools as any,
    });
  }
}

if (require.main === module) {
  startPluginWorker(ShopifyPlugin);
}
