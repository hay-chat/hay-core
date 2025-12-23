/**
 * HubSpot Plugin
 *
 * Connect your HubSpot CRM to access and manage contacts, companies, deals,
 * tickets, and other CRM objects through HubSpot's Model Context Protocol server.
 */

import { defineHayPlugin } from '../../../../plugin-sdk-v2/sdk/index.js';

export default defineHayPlugin((globalCtx) => ({
  name: 'HubSpot',

  /**
   * Global initialization - register config and auth
   */
  onInitialize(ctx) {
    globalCtx.logger.info('Initializing HubSpot plugin');

    // Register config fields for OAuth client credentials
    ctx.register.config({
      clientId: {
        type: 'string',
        label: 'OAuth Client ID',
        description: 'HubSpot OAuth client ID',
        required: true,
        sensitive: false,
        env: 'HUBSPOT_CLIENT_ID',
      },
      clientSecret: {
        type: 'string',
        label: 'OAuth Client Secret',
        description: 'HubSpot OAuth client secret',
        required: true,
        sensitive: true,
        env: 'HUBSPOT_CLIENT_SECRET',
      },
    });

    // Register OAuth2 authentication method
    ctx.register.auth.oauth2({
      id: 'hubspot-oauth',
      label: 'HubSpot OAuth',
      authorizationUrl: 'https://mcp.hubspot.com/oauth/authorize/user',
      tokenUrl: 'https://mcp.hubspot.com/oauth/v3/token',
      scopes: [
        'crm.objects.tickets.read',
        'crm.objects.deals.read',
        'crm.objects.companies.read',
        'crm.objects.contacts.read',
        'oauth',
        // Optional/additional scopes
        'crm.objects.tickets.write',
        'crm.objects.owners.read',
        'crm.lists.read',
        'crm.objects.products.write',
        'crm.objects.subscriptions.read',
        'crm.objects.emails.write',
        'crm.objects.orders.read',
        'crm.objects.meetings.write',
        'crm.objects.invoices.read',
        'crm.objects.companies.write',
        'crm.objects.tasks.read',
        'crm.objects.notes.write',
        'crm.objects.deals.write',
        'crm.objects.calls.write',
        'crm.objects.line_items.write',
        'crm.objects.contacts.write',
        'crm.objects.line_items.read',
        'crm.objects.calls.read',
        'crm.objects.meetings.read',
        'crm.objects.users.read',
        'crm.objects.carts.read',
        'crm.objects.emails.read',
        'crm.objects.quotes.read',
        'crm.objects.notes.read',
        'crm.objects.products.read',
        'crm.objects.tasks.write',
      ],
      clientId: ctx.config.field('clientId'),
      clientSecret: ctx.config.field('clientSecret'),
    });

    globalCtx.logger.info('HubSpot OAuth authentication registered');
  },

  /**
   * Org runtime initialization - connect to HubSpot MCP server
   */
  async onStart(ctx) {
    ctx.logger.info('Starting HubSpot plugin for org', { orgId: ctx.org.id });

    try {
      // Get auth state
      const authState = ctx.auth.get();
      if (!authState) {
        throw new Error('No authentication configured for HubSpot plugin');
      }

      // Build auth headers
      const authHeaders: Record<string, string> = {};
      if (authState.credentials.accessToken) {
        authHeaders['Authorization'] = `Bearer ${authState.credentials.accessToken}`;
      }

      // Connect to external MCP server
      await ctx.mcp.startExternal({
        id: 'hubspot-mcp',
        url: 'https://mcp.hubspot.com',
        authHeaders,
      });

      ctx.logger.info('HubSpot MCP server connected successfully');
    } catch (error) {
      ctx.logger.error('Failed to connect to HubSpot MCP server:', error);
      throw error;
    }
  },
}));
