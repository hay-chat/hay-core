import { HayPlugin, startPluginWorker } from '@hay/plugin-sdk';
import tools from './tools.json';

/**
 * HubSpot Plugin
 *
 * Connect your HubSpot CRM to access and manage contacts, companies, deals, tickets, and other CRM objects
 */
export class HubSpotPlugin extends HayPlugin {
  constructor() {
    super(); // Metadata loaded from package.json automatically
  }

  async onInitialize() {
    console.log('[hay-plugin-hubspot] Plugin initialized');
  }

  protected async registerMCP() {
    console.log('[HubSpot Plugin] registerMCP() called - starting MCP registration');

    try {
      console.log('[HubSpot Plugin] Calling this.sdk.mcp.registerRemoteMCP...');

      await this.sdk.mcp.registerRemoteMCP({
        url: 'https://mcp.hubspot.com',
        transport: 'http',
        auth: {
          type: 'oauth2',
          authorizationUrl: 'https://mcp.hubspot.com/oauth/authorize/user',
          tokenUrl: 'https://mcp.hubspot.com/oauth/v3/token',
          scopes: [
            'crm.objects.tickets.read',
            'crm.objects.deals.read',
            'crm.objects.companies.read',
            'crm.objects.contacts.read',
            'oauth',
          ],
          optionalScopes: [
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
          pkce: true,
          clientIdEnvVar: 'HUBSPOT_CLIENT_ID',
          clientSecretEnvVar: 'HUBSPOT_CLIENT_SECRET',
        },
        tools: tools as any,
      });

      console.log('[HubSpot Plugin] ✅ MCP registration successful!');
    } catch (error) {
      console.error('[HubSpot Plugin] ❌ MCP registration failed:', error);
      throw error;
    }
  }
}

if (require.main === module) {
  startPluginWorker(HubSpotPlugin);
}
