import { HayPlugin, startPluginWorker } from '@hay/plugin-sdk';
import * as tools from './tools.json';

/**
 * WooCommerce Plugin
 *
 * Connect your WooCommerce store to manage products, orders, customers, and e-commerce workflows
 */
export class WooCommercePlugin extends HayPlugin {
  constructor() {
    super(); // Metadata loaded from package.json automatically
  }

  async onInitialize() {
    console.log('[hay-plugin-woocommerce] Plugin initialized');
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
  startPluginWorker(WooCommercePlugin);
}
