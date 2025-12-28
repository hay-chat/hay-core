import { defineHayPlugin } from '@hay/plugin-sdk-v2';
import { ZendeskMcpServer } from './zendesk-mcp-server.js';

/**
 * Zendesk Plugin - SDK V2
 *
 * Connect your Zendesk account to manage tickets, customers, and support workflows
 */
export default defineHayPlugin((globalCtx) => ({
  name: 'Zendesk',

  /**
   * Global initialization - register config, auth, and UI
   */
  onInitialize(ctx) {
    globalCtx.logger.info('Initializing Zendesk plugin');

    // Register config schema for API token authentication
    ctx.register.config({
      subdomain: {
        type: 'string',
        label: 'Zendesk Subdomain',
        description: 'Your Zendesk subdomain (e.g., "mycompany" from mycompany.zendesk.com)',
        required: true,
        encrypted: false,
      },
      email: {
        type: 'string',
        label: 'Admin Email',
        description: 'Email address of the Zendesk admin user',
        required: true,
        encrypted: false,
      },
      apiToken: {
        type: 'string',
        label: 'API Token',
        description: 'Zendesk API token (generated in Admin Center → APIs → API Tokens)',
        required: true,
        encrypted: true, // Encrypt sensitive token
      },
    });

    // Register API key authentication (uses apiToken field)
    ctx.register.auth.apiKey({
      id: 'apiToken',
      label: 'Zendesk API Token',
      configField: 'apiToken',
    });

    // Register UI page for setup tutorial
    ctx.register.ui.page({
      id: 'setup-guide',
      title: 'Setup Guide',
      component: './components/settings/AfterSettings.vue',
      slot: 'after-settings',
      icon: 'book',
    });

    globalCtx.logger.info('Zendesk plugin config, auth, and UI registered');
  },

  /**
   * Validate authentication credentials
   */
  async onValidateAuth(ctx) {
    ctx.logger.info('Validating Zendesk credentials');

    const subdomain = ctx.config.get<string>('subdomain');
    const email = ctx.config.get<string>('email');
    const apiToken = ctx.config.get<string>('apiToken');

    // Basic validation
    if (!subdomain || !email || !apiToken) {
      throw new Error('Subdomain, email, and API token are required');
    }

    // Validate email format
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      throw new Error('Invalid email format');
    }

    // Validate subdomain format (alphanumeric and hyphens only)
    const subdomainRegex = /^[a-zA-Z0-9-]+$/;
    if (!subdomainRegex.test(subdomain)) {
      throw new Error('Invalid subdomain format (use alphanumeric and hyphens only)');
    }

    // Test actual API connection
    try {
      const authString = Buffer.from(`${email}/token:${apiToken}`).toString('base64');
      const response = await fetch(`https://${subdomain}.zendesk.com/api/v2/users/me.json`, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        ctx.logger.error('Zendesk API authentication failed', {
          status: response.status,
          error: errorText
        });

        if (response.status === 401) {
          throw new Error('Invalid credentials - please check your email and API token');
        } else if (response.status === 404) {
          throw new Error('Invalid subdomain - please check your Zendesk subdomain');
        } else {
          throw new Error(`API request failed with status ${response.status}: ${errorText}`);
        }
      }

      const data = await response.json();
      ctx.logger.info('Zendesk credentials validated successfully', {
        user: data.user?.email
      });

      return true;
    } catch (error: any) {
      ctx.logger.error('Failed to validate Zendesk credentials', { error: error.message });

      // Re-throw validation errors as-is
      if (error.message.includes('credentials') || error.message.includes('subdomain') || error.message.includes('API request failed')) {
        throw error;
      }

      // Network or other errors
      throw new Error(`Failed to connect to Zendesk: ${error.message}`);
    }
  },

  /**
   * Org runtime initialization - start MCP server
   */
  async onStart(ctx) {
    ctx.logger.info('Starting Zendesk plugin for org', { orgId: ctx.org.id });

    // Check if credentials are configured before starting MCP server
    const subdomain = ctx.config.getOptional<string>('subdomain');
    const email = ctx.config.getOptional<string>('email');
    const apiToken = ctx.config.getOptional<string>('apiToken');

    if (!subdomain || !email || !apiToken) {
      ctx.logger.info(
        'Zendesk credentials not configured - plugin is enabled but MCP tools are not available. ' +
        'Please configure your Zendesk credentials in the plugin settings.'
      );
      // Exit early - worker will run but MCP won't be available
      // This is expected behavior: plugin is enabled but waiting for configuration
      return;
    }

    ctx.logger.info('Zendesk config loaded', { subdomain, email });

    // Start the Zendesk MCP server as a local process
    await ctx.mcp.startLocal('zendesk-mcp', async (mcpCtx) => {
      const server = new ZendeskMcpServer({
        subdomain,
        email,
        apiToken,
        logger: mcpCtx.logger,
      });

      // Start the MCP server process
      await server.start();

      return server;
    });

    ctx.logger.info('Zendesk MCP server started successfully');
  },

  /**
   * Config update handler
   */
  async onConfigUpdate(ctx) {
    ctx.logger.info('Zendesk plugin config updated - requesting restart to apply changes');
    // Request restart to apply new config and potentially start/stop MCP server
    await ctx.requestRestart();
  },

  /**
   * Disable handler - cleanup
   */
  async onDisable(ctx) {
    ctx.logger.info('Zendesk plugin disabled for org', { orgId: ctx.org.id });
    // MCP servers are stopped automatically by the SDK
  },

  /**
   * Enable handler - called by core when plugin is enabled
   */
  async onEnable(ctx) {
    ctx.logger.info('Zendesk plugin enabled');
    // Plugin will be restarted via onStart automatically for each org
  },
}));
