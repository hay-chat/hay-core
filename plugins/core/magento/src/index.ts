import { HayPlugin, startPluginWorker } from '@hay/plugin-sdk';
import * as tools from './tools.json';

/**
 * Magento Plugin
 *
 * Connect your Magento 2 e-commerce store to manage products, orders, customers, inventory, and analyze sales performance through Magento\'s REST API
 */
export class MagentoPlugin extends HayPlugin {
  constructor() {
    super({
      id: 'hay-plugin-magento',
      name: 'Magento',
      version: '1.0.0',
      description: 'Connect your Magento 2 e-commerce store to manage products, orders, customers, inventory, and analyze sales performance through Magento\'s REST API',
      author: 'Hay',
      category: 'integration',
      capabilities: ['mcp'],
    });
  }

  async onInitialize() {
    console.log('[hay-plugin-magento] Plugin initialized');
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
  startPluginWorker(MagentoPlugin);
}
