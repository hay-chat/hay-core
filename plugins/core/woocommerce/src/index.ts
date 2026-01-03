import { defineHayPlugin } from '@hay/plugin-sdk-v2';
import { WooCommerceMcpServer } from './woocommerce-mcp-server.js';

/**
 * WooCommerce Plugin - SDK V2
 *
 * Connect your WooCommerce store to manage products, orders, customers, and e-commerce workflows
 */
export default defineHayPlugin((globalCtx) => ({
  name: 'WooCommerce',

  /**
   * Global initialization - register config and auth methods
   */
  onInitialize(ctx) {
    globalCtx.logger.info('Initializing WooCommerce plugin');

    // Register configuration fields
    ctx.register.config({
      siteUrl: {
        type: 'string',
        label: 'WordPress Site URL',
        description: 'Your WordPress/WooCommerce site URL (e.g., https://mystore.com)',
        required: true,
        encrypted: false,
      },
      consumerKey: {
        type: 'string',
        label: 'Consumer Key',
        description: 'WooCommerce REST API Consumer Key',
        required: true,
        encrypted: true,
      },
      consumerSecret: {
        type: 'string',
        label: 'Consumer Secret',
        description: 'WooCommerce REST API Consumer Secret',
        required: true,
        encrypted: true,
      },
      username: {
        type: 'string',
        label: 'WordPress Username (Optional)',
        description: 'WordPress admin username for WordPress REST API endpoints',
        required: false,
        encrypted: false,
      },
      password: {
        type: 'string',
        label: 'WordPress Password (Optional)',
        description: 'WordPress admin password for WordPress REST API endpoints',
        required: false,
        encrypted: true,
      },
    });

    // Register API Key authentication (uses consumerKey field as primary auth)
    ctx.register.auth.apiKey({
      id: 'woocommerce-apikey',
      label: 'WooCommerce API Key',
      configField: 'consumerKey',
    });

    globalCtx.logger.info('WooCommerce plugin config and auth methods registered');
  },

  /**
   * Validate authentication credentials
   */
  async onValidateAuth(ctx) {
    ctx.logger.info('Validating WooCommerce credentials');

    const siteUrl = ctx.config.get<string>('siteUrl');
    const consumerKey = ctx.config.get<string>('consumerKey');
    const consumerSecret = ctx.config.get<string>('consumerSecret');

    // Basic validation
    if (!siteUrl || !consumerKey || !consumerSecret) {
      throw new Error('Site URL, consumer key, and consumer secret are required');
    }

    // Validate site URL format
    try {
      new URL(siteUrl);
    } catch {
      throw new Error('Invalid site URL format - must be a valid URL (e.g., https://mystore.com)');
    }

    // Test actual WooCommerce API connection
    try {
      const testUrl = `${siteUrl}/wp-json/wc/v3/system_status?consumer_key=${encodeURIComponent(
        consumerKey
      )}&consumer_secret=${encodeURIComponent(consumerSecret)}`;

      const response = await fetch(testUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        ctx.logger.error('WooCommerce API authentication failed', {
          status: response.status,
          error: errorText,
        });

        if (response.status === 401) {
          throw new Error('Invalid credentials - please check your consumer key and secret');
        } else if (response.status === 404) {
          throw new Error(
            'WooCommerce REST API not found - please verify WooCommerce is installed and the site URL is correct'
          );
        } else {
          throw new Error(`API request failed with status ${response.status}: ${errorText}`);
        }
      }

      ctx.logger.info('WooCommerce credentials validated successfully');
      return true;
    } catch (error: any) {
      ctx.logger.error('Failed to validate WooCommerce credentials', { error: error.message });

      // Re-throw validation errors as-is
      if (
        error.message.includes('credentials') ||
        error.message.includes('not found') ||
        error.message.includes('API request failed')
      ) {
        throw error;
      }

      // Network or other errors
      throw new Error(`Failed to connect to WooCommerce: ${error.message}`);
    }
  },

  /**
   * Org runtime initialization - start local MCP server
   */
  async onStart(ctx) {
    ctx.logger.info('Starting WooCommerce plugin for org', { orgId: ctx.org.id });

    // Check if credentials are configured before starting MCP server
    const siteUrl = ctx.config.getOptional<string>('siteUrl');
    const consumerKey = ctx.config.getOptional<string>('consumerKey');
    const consumerSecret = ctx.config.getOptional<string>('consumerSecret');
    const username = ctx.config.getOptional<string>('username');
    const password = ctx.config.getOptional<string>('password');

    if (!siteUrl || !consumerKey || !consumerSecret) {
      ctx.logger.info(
        'WooCommerce credentials not configured - plugin is enabled but MCP tools are not available. ' +
          'Please configure your WooCommerce credentials in the plugin settings.'
      );
      return;
    }

    try {
      // Start local MCP server with credentials
      await ctx.mcp.startLocal('woocommerce-mcp', async (mcpCtx) => {
        const server = new WooCommerceMcpServer({
          siteUrl,
          consumerKey,
          consumerSecret,
          username,
          password,
          logger: mcpCtx.logger,
        });

        // Start the MCP server child process
        await server.start();

        return server;
      });

      ctx.logger.info('WooCommerce local MCP server started successfully');
    } catch (error) {
      ctx.logger.error('Failed to start WooCommerce MCP server:', error);
      throw error;
    }
  },

  /**
   * Config update handler
   */
  async onConfigUpdate(ctx) {
    ctx.logger.info('WooCommerce plugin config updated');
    // Config changes will take effect on next restart
  },

  /**
   * Disable handler - cleanup
   */
  async onDisable(ctx) {
    ctx.logger.info('WooCommerce plugin disabled for org', { orgId: ctx.org.id });
    // MCP servers are stopped automatically by the SDK
  },

  /**
   * Enable handler
   */
  async onEnable(ctx) {
    ctx.logger.info('WooCommerce plugin enabled');
    // Plugin will be restarted via onStart automatically for each org
  },
}));
