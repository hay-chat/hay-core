import { HayPlugin, startPluginWorker } from '@hay/plugin-sdk';

/**
 * Email Plugin
 *
 * Send emails using the platform's email service with configurable recipient lists.
 * This plugin provides MCP tools for health checking and sending emails.
 */
export class EmailPlugin extends HayPlugin {
  constructor() {
    super(); // Metadata loaded from package.json automatically
  }

  /**
   * Initialize plugin - register MCP server with tools
   */
  async onInitialize(): Promise<void> {
    console.log(`[${this.metadata.id}] Registering MCP server...`);

    // Register local MCP server (the existing mcp/index.js)
    await this.sdk.mcp.registerLocalMCP({
      serverPath: './mcp',
      startCommand: 'node index.js',
      installCommand: 'npm install',
      tools: [
        {
          name: 'healthcheck',
          description: 'Check if the email plugin is working correctly and return configuration status',
          input_schema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'send-email',
          description: 'Send an email to configured recipients using the platform\'s email service. The email will be sent from the platform\'s default sender address.',
          input_schema: {
            type: 'object',
            properties: {
              subject: {
                type: 'string',
                description: 'Email subject line',
                minLength: 1,
              },
              body: {
                type: 'string',
                description: 'Email body content (plain text)',
                minLength: 1,
              },
            },
            required: ['subject', 'body'],
          },
        },
      ],
    });

    console.log(`[${this.metadata.id}] MCP server registered successfully`);
  }
}

// Start the plugin worker
if (require.main === module) {
  startPluginWorker(EmailPlugin);
}
