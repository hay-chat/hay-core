# Stripe Plugin for Hay

Connect your Stripe account to Hay and manage payments, customers, subscriptions, invoices, and more using AI-powered conversations.

## Overview

The Stripe plugin uses Stripe's Model Context Protocol (MCP) server to provide secure, real-time access to your Stripe account. This plugin supports both OAuth2 and API key authentication.

## Quick Start

**Self-Hosted / Development**: Use API key authentication
1. Get your Stripe API key from the [Stripe Dashboard](https://dashboard.stripe.com/test/apikeys)
2. In Hay, go to **Plugins** → **Stripe** → **Configure**
3. Enter your API key and save
4. Start asking questions: "What's my Stripe balance?"

**Managed/Cloud**: Use OAuth (if configured by your provider)
1. Go to **Plugins** → **Stripe**
2. Click **"Connect with OAuth"**
3. Authorize on Stripe's page
4. Done!

## Features

### Account & Balance
- Get account information
- Retrieve account balance

### Customers
- Create new customers
- List and search customers
- Manage customer details

### Products & Prices
- Create and list products
- Create and manage pricing
- Support for one-time and recurring pricing

### Payments
- List payment intents
- Create payment links
- Process refunds

### Invoices
- Create and finalize invoices
- Add invoice items
- List and filter invoices

### Subscriptions
- List subscriptions
- Create and update subscriptions
- Cancel subscriptions with prorating options

### Coupons & Discounts
- Create coupons (percentage or fixed amount)
- List available coupons

### Disputes
- List disputes by status
- Update dispute evidence
- Submit dispute responses

### Search & Documentation
- Search across all Stripe resources
- Fetch specific resources by ID
- Search Stripe documentation and knowledge base

## Setup Instructions

The Stripe plugin supports two authentication methods. Choose the one that best fits your setup:

### Method 1: API Key Authentication (Recommended for Self-Hosted)

**Best for**: Self-hosted installations, development, testing, autonomous agents

**Pros**:
- ✅ Simple and quick setup
- ✅ No OAuth application approval needed
- ✅ Works immediately
- ✅ Full control over permissions with restricted keys

**Setup**:

1. **Get your Stripe API key**:
   - Log in to your [Stripe Dashboard](https://dashboard.stripe.com)
   - Navigate to **Developers** → **API keys**
   - For **production**: Create a [restricted API key](https://docs.stripe.com/keys#create-restricted-api-secret-key) with only the permissions you need
   - For **testing**: Use your test mode secret key (starts with `sk_test_`)

2. **Configure the plugin**:
   - Start your Hay server
   - Navigate to the **Plugins** page in your dashboard
   - Find the "Stripe" plugin
   - Click **"Configure"** or **"Settings"**
   - Enter your API key in the "Stripe API Key" field
   - Click **"Save"**

3. **Test the connection**:
   - Try a query like: "What's my Stripe account balance?"
   - The plugin should successfully connect and retrieve your data

**Security tip**: Always use [restricted API keys](https://docs.stripe.com/keys#create-restricted-api-secret-key) in production to limit access to only the resources and operations you need.

---

### Method 2: OAuth Authentication (Recommended for Managed/Cloud)

**Best for**: Managed Hay instances, cloud deployments, multi-user environments

**Pros**:
- ✅ More secure with granular permissions
- ✅ User-based authorization
- ✅ Easier revocation
- ✅ Better for multi-tenant setups

**Note**: OAuth requires your Hay installation's redirect URI to be allowlisted by Stripe. This is easier for managed/cloud providers who can get pre-approved, but requires additional setup for self-hosted installations.

**Setup for Managed/Cloud Providers**:

If you're running a managed Hay instance:

> **Note**: OAuth setup for Stripe MCP is currently pending clarification from Stripe. The exact authentication method (traditional OAuth with client credentials vs. Client ID Metadata Document) will be confirmed after allowlisting approval. Check back for updates.

1. **Get allowlisted by Stripe**:
   - Email [mcp@stripe.com](mailto:mcp@stripe.com) with your redirect URI
   - Redirect URI format: `https://yourdomain.com/oauth/callback`
   - Include information about your Hay installation
   - Wait for Stripe's response about their OAuth implementation

2. **Configure OAuth** (if Stripe provides credentials):
   - If Stripe provides `client_id` and `client_secret`, add to your `.env` file:
   ```bash
   STRIPE_OAUTH_CLIENT_ID=ca_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   STRIPE_OAUTH_CLIENT_SECRET=sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
   - If Stripe uses Client ID Metadata Document (CIMD), no credentials needed (implementation pending)

3. **Users connect via OAuth**:
   - Users navigate to the Plugins page
   - Click **"Connect with OAuth"** on the Stripe plugin
   - Authorize on Stripe's consent screen
   - Automatically connected!

**Setup for Self-Hosted** (if you want OAuth):

See the detailed [OAUTH_SETUP.md](OAUTH_SETUP.md) guide. Note that this requires:
- Being allowlisted by Stripe
- Potentially waiting for approval
- Additional configuration

**For most self-hosted users, we recommend using API key authentication instead.**

---

## How Authentication Works

The plugin uses a priority-based authentication system:

1. **OAuth First**: If OAuth tokens are available, they're used automatically
2. **API Key Fallback**: If no OAuth tokens exist, the plugin uses the configured API key
3. **Auto Token Refresh**: OAuth tokens are automatically refreshed 5 minutes before expiry

This means you can:
- Start with API key authentication for quick testing
- Switch to OAuth later without reconfiguration (for managed instances)
- Use API keys in production if OAuth isn't suitable for your setup

## Managing OAuth Access

### View Active Sessions

To view all OAuth-connected MCP client sessions:
1. Navigate to the [Stripe MCP app](https://dashboard.stripe.com/settings/apps/com.stripe.mcp)
2. Click **"Client sessions"** in the right panel

### Revoke Access

To revoke OAuth access for a specific session:
1. Find the session in the client sessions list
2. Click the overflow menu (⋮)
3. Select **"Revoke session"**

Alternatively, you can revoke access from within Hay:
1. Go to the plugins page
2. Find the Stripe plugin
3. Click **"Disconnect"** or **"Revoke OAuth"**

## Usage Examples

Once connected, you can interact with Stripe through natural language in Hay conversations:

- "Create a new customer named John Doe with email john@example.com"
- "List all active subscriptions"
- "What's my account balance?"
- "Create a payment link for the Premium Plan"
- "Show me all customers from the last 30 days"
- "Create a 20% off coupon that lasts forever"
- "List all open invoices"
- "Search for customers with email containing '@gmail.com'"
- "What are the recent payment intents?"
- "Create a refund for charge ch_xxxxx"

## Available Tools

The plugin provides 24+ tools for interacting with Stripe:

| Category | Tools |
|----------|-------|
| **Account** | get_stripe_account_info, retrieve_balance |
| **Customers** | create_customer, list_customers |
| **Products & Prices** | create_product, list_products, create_price, list_prices |
| **Payments** | list_payment_intents, create_payment_link, create_refund |
| **Invoices** | create_invoice, create_invoice_item, finalize_invoice, list_invoices |
| **Subscriptions** | list_subscriptions, update_subscription, cancel_subscription |
| **Coupons** | create_coupon, list_coupons |
| **Disputes** | list_disputes, update_dispute |
| **Search** | search_stripe_resources, fetch_stripe_resources, search_stripe_documentation |

## Security Considerations

1. **OAuth Tokens**: All OAuth tokens are encrypted at rest in the Hay database
2. **Token Refresh**: Tokens are automatically refreshed 5 minutes before expiry
3. **Restricted Keys**: When using API keys, always use restricted keys with minimal permissions
4. **PKCE Flow**: This plugin uses PKCE (Proof Key for Code Exchange) for additional OAuth security
5. **Never Commit Secrets**: Never commit OAuth credentials or API keys to version control

## Troubleshooting

### OAuth Connection Fails

1. Verify your OAuth credentials are correct in `.env`
2. Ensure redirect URIs are properly configured in Stripe
3. Check that the Stripe MCP app is installed in your account
4. Contact [mcp@stripe.com](mailto:mcp@stripe.com) if you need redirect URIs allowlisted

### Token Expired

OAuth tokens are automatically refreshed. If you see token expiry errors:
1. Check that your refresh token is still valid
2. Try disconnecting and reconnecting the plugin
3. Check server logs for token refresh errors

### Tools Not Working

1. Verify the plugin is enabled and connected
2. Check that you have the necessary Stripe permissions
3. Ensure your Stripe account has the required features enabled (e.g., Connect, Billing)

## Resources

- [Stripe API Documentation](https://docs.stripe.com/api)
- [Stripe MCP Documentation](https://docs.stripe.com/mcp)
- [Model Context Protocol Specification](https://modelcontextprotocol.io)
- [Stripe Connect Documentation](https://docs.stripe.com/connect)

## Support

For issues related to:
- **Hay Plugin**: Contact Hay support
- **Stripe API**: Visit [Stripe Support](https://support.stripe.com)
- **Stripe MCP**: Email [mcp@stripe.com](mailto:mcp@stripe.com)

## License

MIT
