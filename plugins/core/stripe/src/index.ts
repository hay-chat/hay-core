import { HayPlugin, startPluginWorker } from '@hay/plugin-sdk';
import * as tools from './tools.json';

/**
 * Stripe Plugin
 *
 * Connect your Stripe account to manage payments, customers, subscriptions, and more through Stripe\'s Model Context Protocol server.
 */
export class StripePlugin extends HayPlugin {
  constructor() {
    super(); // Metadata loaded from package.json automatically
  }

  async onInitialize() {
    console.log('[hay-plugin-stripe] Plugin initialized');

    // Register configuration options
    this.registerConfigOption('oauthClientId', {
      type: 'string',
      label: 'OAuth Client ID',
      description: 'Your Stripe OAuth client ID for MCP server authentication',
      required: true,
      encrypted: false,
      env: 'STRIPE_OAUTH_CLIENT_ID'
    });

    this.registerConfigOption('oauthClientSecret', {
      type: 'string',
      label: 'OAuth Client Secret',
      description: 'Your Stripe OAuth client secret for MCP server authentication',
      required: true,
      encrypted: true,
      env: 'STRIPE_OAUTH_CLIENT_SECRET'
    });
  }

  protected async registerMCP() {
    await this.sdk.mcp.registerRemoteMCP({
      url: 'https://mcp.stripe.com',
      transport: 'http',
      auth: {
        type: 'oauth2',
        authorizationUrl: 'https://mcp.stripe.com/oauth/authorize/user',
        tokenUrl: 'https://mcp.stripe.com/oauth/v3/token',
        scopes: ['read_write'],
        pkce: true,
        clientIdEnvVar: 'STRIPE_OAUTH_CLIENT_ID',
        clientSecretEnvVar: 'STRIPE_OAUTH_CLIENT_SECRET',
      },
      tools: tools as any,
    });
  }
}

if (require.main === module) {
  startPluginWorker(StripePlugin);
}
