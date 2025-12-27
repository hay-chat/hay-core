/**
 * Email Plugin - SDK v2
 *
 * Send emails using the platform's email service with configurable recipient lists.
 * This plugin provides MCP tools for health checking and sending emails.
 *
 * @see PLUGIN.md for SDK v2 architecture
 */

import { defineHayPlugin } from '@hay/plugin-sdk-v2';

/**
 * MCP Tool Definition
 */
interface MCPTool {
  name: string;
  description: string;
  input_schema: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

/**
 * Email Plugin Definition (SDK v2)
 *
 * This plugin demonstrates:
 * - Config registration (email recipients)
 * - Local MCP server integration
 * - Tool discovery and execution
 */
export default defineHayPlugin((globalCtx) => {
  return {
    name: 'Email',

    /**
     * Global initialization - register config schema and capabilities
     */
    onInitialize(ctx) {
      globalCtx.logger.info('Initializing Email plugin');

      // Register config schema
      ctx.register.config({
        recipients: {
          type: 'string',
          label: 'Email Recipients',
          description: 'Comma-separated list of email addresses to send to',
          required: true,
          encrypted: false,
        },
      });

      globalCtx.logger.info('Email plugin config schema registered');
    },

    /**
     * Org runtime initialization - start MCP server
     */
    async onStart(ctx) {
      ctx.logger.info('Starting Email plugin for org', { orgId: ctx.org.id });

      // Get recipients from config (with fallback to default for testing)
      const recipients = ctx.config.getOptional<string>('recipients') || 'test@example.com';

      // Parse and validate recipients
      const recipientList = recipients
        .split(',')
        .map((email) => email.trim())
        .filter((email) => email.length > 0);

      if (recipientList.length === 0) {
        throw new Error('No valid recipients configured');
      }

      // Validate email format
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      const invalidEmails = recipientList.filter((email) => !emailRegex.test(email));

      if (invalidEmails.length > 0) {
        throw new Error(`Invalid email addresses: ${invalidEmails.join(', ')}`);
      }

      ctx.logger.info(`Email plugin configured with ${recipientList.length} recipient(s)`, {
        recipients: recipientList,
      });

      // Start local MCP server
      await ctx.mcp.startLocal('email-mcp', async (mcpCtx) => {
        // Create MCP server instance with tool methods
        const mcpServer: any = {
          /**
           * List available tools
           */
          async listTools(): Promise<MCPTool[]> {
            return [
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
                description: "Send an email to configured recipients using the platform's email service",
                input_schema: {
                  type: 'object',
                  properties: {
                    subject: {
                      type: 'string',
                      description: 'Email subject line',
                    },
                    body: {
                      type: 'string',
                      description: 'Email body content (plain text)',
                    },
                  },
                  required: ['subject', 'body'],
                },
              },
            ];
          },

          /**
           * Call a tool
           */
          async callTool(toolName: string, args: Record<string, any>): Promise<any> {
            mcpCtx.logger.info(`Calling tool: ${toolName}`, { args });

            if (toolName === 'healthcheck') {
              return {
                status: 'healthy',
                plugin: 'email',
                version: '2.0.0',
                organizationId: ctx.org.id,
                recipients: recipientList,
                recipientCount: recipientList.length,
                message: 'Email plugin is running and ready to send emails',
              };
            }

            if (toolName === 'send-email') {
              const { subject, body } = args;

              if (!subject || !body) {
                throw new Error('Subject and body are required');
              }

              mcpCtx.logger.info('Sending email', {
                subject,
                recipientCount: recipientList.length,
              });

              // Mock email send (in production, this would call Platform API)
              const result = {
                success: true,
                message: `Email sent successfully to ${recipientList.length} recipient(s): ${recipientList.join(', ')}`,
                messageId: `mock-${Date.now()}`,
                recipients: recipientList,
                timestamp: new Date().toISOString(),
                subject,
                bodyPreview: body.substring(0, 50) + (body.length > 50 ? '...' : ''),
              };

              mcpCtx.logger.info('Email sent successfully', result);

              return result;
            }

            throw new Error(`Unknown tool: ${toolName}`);
          },

          /**
           * Stop the MCP server (cleanup)
           */
          async stop() {
            ctx.logger.info('Stopping email MCP server');
            // No cleanup needed for this simple implementation
          },
        };

        return mcpServer;
      });

      ctx.logger.info('Email MCP server started successfully');
    },

    /**
     * Config update handler
     */
    async onConfigUpdate(ctx) {
      ctx.logger.info('Email plugin config updated');
      // Note: For email plugin, config changes (recipients) will take effect on restart
    },

    /**
     * Disable handler - cleanup
     */
    async onDisable(ctx) {
      ctx.logger.info('Email plugin disabled for org', { orgId: ctx.org.id });
      // MCP servers are stopped automatically by the SDK
    },

    /**
     * Enable handler - called by core when plugin is enabled
     * Note: This is a CORE-ONLY hook, receives global context (not org context)
     */
    async onEnable(ctx) {
      ctx.logger.info('Email plugin enabled');
      // Plugin will be restarted via onStart automatically for each org
    },
  };
});
