import { HayPlugin, startPluginWorker } from '@hay/plugin-sdk';

/**
 * Judo in Cloud Plugin
 *
 * Provides MCP tools for interacting with Judo in Cloud services including
 * password resets, email checks, and contact management.
 */
export class JudoInCloudPlugin extends HayPlugin {
  constructor() {
    super({
      id: 'judo-in-cloud',
      name: 'Judo in Cloud',
      version: '1.0.0',
      description: 'Judo in Cloud MCP plugin',
      author: 'Hay',
      category: 'utility',
      capabilities: ['mcp'],
    });
  }

  /**
   * Initialize plugin
   */
  async onInitialize() {
    // Plugin initialized successfully
    console.log('[judo-in-cloud] Plugin initialized');
  }

  /**
   * Register MCP server with tools
   */
  protected async registerMCP() {
    await this.sdk.mcp.registerLocalMCP({
      serverPath: './mcp',
      startCommand: 'node index.js',
      installCommand: 'npm install',
      tools: [
        {
          name: 'healthcheck',
          description: 'Check if the Judo in Cloud plugin is working correctly and return status',
          input_schema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'reset_password',
          description: 'Reset the password for a user',
          input_schema: {
            type: 'object',
            properties: {
              email: {
                type: 'string',
                description: 'Email of the user to reset the password for',
              },
            },
            required: ['email'],
          },
        },
        {
          name: 'contact',
          description: 'Contact the Judo in Cloud team',
          input_schema: {
            type: 'object',
            properties: {
              region: {
                type: 'string',
                description: 'Region of the company to contact',
              },
              subject: {
                type: 'string',
                description: "Needs to be one of the following: 'support', 'sales', 'technical', 'other'",
              },
              company_name: {
                type: 'string',
                description: 'Name of the company to contact',
              },
              email: {
                type: 'string',
                description: 'Email of the user to include in the contact',
              },
              phone: {
                type: 'string',
                description: 'Phone number of the user to include in the contact',
              },
            },
            required: ['name', 'subject'],
          },
        },
        {
          name: 'check_email',
          description: 'Check if an email is registered in the system',
          input_schema: {
            type: 'object',
            properties: {
              email: {
                type: 'string',
                description: 'Email address to check',
              },
            },
            required: ['email'],
          },
        },
      ],
    });
  }
}

// Start the plugin worker if this file is run directly
if (require.main === module) {
  startPluginWorker(JudoInCloudPlugin);
}
