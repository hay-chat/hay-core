# Stripe OAuth Setup Guide

> **⚠️ IMPORTANT**: OAuth setup for Stripe MCP is currently **pending clarification from Stripe**. The exact OAuth implementation method will be confirmed after redirect URI allowlisting approval. This guide will be updated once we receive Stripe's response.
>
> **Note**: This guide is primarily for **managed/cloud Hay providers** who want to offer OAuth-based Stripe integration to their users.
>
> **For self-hosted installations**, we recommend using **API key authentication** instead (see [README.md](README.md) for simple setup). OAuth requires being allowlisted by Stripe, which can take time and may not be approved for individual installations.

This guide walks you through setting up OAuth authentication for the Stripe MCP plugin in Hay.

## Current Status

- ✅ Redirect URI allowlist request sent to Stripe (mcp@stripe.com)
- ⏳ Waiting for Stripe's response about their OAuth implementation approach
- ⏳ May require code changes depending on Stripe's OAuth method (traditional vs. CIMD)

**Possible OAuth Methods**:
1. **Traditional OAuth**: Stripe provides `client_id` and `client_secret` (current implementation supports this)
2. **Client ID Metadata Document (CIMD)**: Modern MCP approach, no credentials needed (requires implementation)

## Overview

The Stripe plugin uses OAuth 2.0 with PKCE (Proof Key for Code Exchange) to securely connect to your Stripe account through Stripe's Model Context Protocol (MCP) server at `https://mcp.stripe.com`.

## When to Use OAuth vs API Key

**Use OAuth when**:
- You're running a managed/cloud Hay service for multiple users
- You want user-based authorization with granular permissions
- You can get your redirect URI allowlisted by Stripe
- You're building a SaaS product

**Use API Key when**:
- You're self-hosting Hay for personal or team use
- You want quick, simple setup without external approval
- You're developing or testing
- You're building autonomous agents

For API key setup, see the main [README.md](README.md).

## Prerequisites

- A Stripe account (test or live mode)
- Admin access to your Stripe Dashboard
- Access to your Hay server's environment variables

## Step 1: Install the Stripe MCP App

The Stripe MCP server uses a Stripe App for OAuth authorization. You need to install this app in your Stripe account.

1. Log in to your [Stripe Dashboard](https://dashboard.stripe.com)

2. Navigate to the Stripe MCP app:
   - Go to [https://dashboard.stripe.com/settings/apps/com.stripe.mcp](https://dashboard.stripe.com/settings/apps/com.stripe.mcp)
   - Or navigate via: **Settings** → **Apps** → Search for "Stripe MCP"

3. Click **Install** if prompted to install the app

## Step 2: Get OAuth Information from Stripe

**⚠️ This step depends on Stripe's response to the allowlist request.**

After Stripe approves your redirect URI, they will provide information about their OAuth implementation:

### Option A: Traditional OAuth (if Stripe provides credentials)

If Stripe provides client credentials:

1. **Receive Credentials**:
   - Stripe will send you a `client_id` (likely starting with `ca_`)
   - Stripe may send you a `client_secret` (secure string - keep private!)

2. **Store Securely**:
   - **Never commit credentials to version control**
   - Store in environment variables
   - Use different credentials for development and production
   - Rotate credentials periodically

### Option B: Client ID Metadata Document (CIMD)

If Stripe supports CIMD (modern MCP approach):

1. **No Credentials Needed**:
   - Hay will use its own URL as the `client_id`
   - No `client_secret` required

2. **Implementation Required**:
   - We'll need to host a metadata JSON endpoint
   - Code changes required in `oauth.service.ts`
   - See TODO comments in the codebase

**We'll update this section after receiving Stripe's response.**

## Step 3: Configure Redirect URIs

OAuth requires configuring allowed redirect URIs where Stripe can send users after authorization.

### Development Environment

Your development redirect URI will be:
```
http://localhost:3001/oauth/callback
```

### Production Environment

Your production redirect URI will be:
```
https://your-domain.com/oauth/callback
```

Replace `your-domain.com` with your actual domain.

### Adding Redirect URIs to Stripe

**Important**: Stripe maintains an allowlist of vetted MCP client redirect URIs to protect users from phishing attacks.

1. **For Standard Localhost Development**:
   - `http://localhost:3001/oauth/callback` should be pre-approved

2. **For Custom Domains**:
   - Email [mcp@stripe.com](mailto:mcp@stripe.com) with your production redirect URI
   - Include:
     - Your domain name
     - The full redirect URI
     - A brief description of your application
     - Your Stripe account ID

3. **Verification**:
   - Wait for confirmation from Stripe that your URI has been allowlisted
   - This usually takes 1-2 business days

## Step 4: Configure Environment Variables (if applicable)

**Only if Stripe provides client credentials (traditional OAuth)**:

Add your OAuth credentials to your Hay server's `.env` file:

```bash
# Stripe MCP Plugin OAuth Configuration (if using traditional OAuth)
STRIPE_OAUTH_CLIENT_ID=ca_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
STRIPE_OAUTH_CLIENT_SECRET=sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**If Stripe uses CIMD**: No environment variables needed. The implementation will use Hay's own URL as the client identifier.

### Variable Naming Convention (Traditional OAuth)

The plugin currently looks for environment variables named:
- `STRIPE_OAUTH_CLIENT_ID` - Your OAuth client ID
- `STRIPE_OAUTH_CLIENT_SECRET` - Your OAuth client secret

> **Note**: These may not be needed if Stripe supports CIMD. We'll update the code and documentation after receiving Stripe's response.

## Step 5: Restart Your Hay Server

After configuring environment variables, restart your Hay server to load the new configuration:

```bash
# If running in development
npm run dev

# If running in production
npm run start
```

## Step 6: Test the OAuth Flow

1. **Access the Hay Dashboard**:
   - Navigate to your Hay dashboard
   - Go to the **Plugins** page

2. **Find the Stripe Plugin**:
   - Locate the "Stripe" plugin in the list
   - Click on it to view details

3. **Initiate OAuth Connection**:
   - Click the **"Connect with OAuth"** button
   - You'll be redirected to Stripe's authorization page

4. **Authorize the Connection**:
   - Review the permissions requested
   - The plugin requests `read_write` scope for full API access
   - Click **"Authorize"** or **"Connect"**

5. **Verify Connection**:
   - You'll be redirected back to Hay
   - The plugin status should now show "Connected"
   - You should see a green checkmark or success indicator

6. **Test with a Query**:
   - Create a new conversation
   - Try a simple query like: "What's my Stripe account balance?"
   - The plugin should successfully retrieve and display your balance

## Troubleshooting

### Error: "OAuth client credentials not configured"

**Cause**: Environment variables are not set or server hasn't been restarted.

**Solution**:
1. Verify `.env` file contains `STRIPE_OAUTH_CLIENT_ID` and `STRIPE_OAUTH_CLIENT_SECRET`
2. Restart your Hay server
3. Check server logs for any configuration errors

### Error: "redirect_uri mismatch"

**Cause**: The redirect URI used in the OAuth flow doesn't match what's configured in Stripe.

**Solution**:
1. Verify your redirect URI is allowlisted with Stripe
2. Check that your `API_DOMAIN` or `BASE_URL` environment variables are correct
3. Contact [mcp@stripe.com](mailto:mcp@stripe.com) to add your URI to the allowlist

### Error: "Invalid client credentials"

**Cause**: Client ID or Secret is incorrect.

**Solution**:
1. Double-check the credentials in your `.env` file
2. Ensure no extra spaces or line breaks
3. Verify credentials in the Stripe Dashboard
4. Try regenerating credentials if available

### OAuth Callback Never Completes

**Cause**: Firewall, network issues, or incorrect URL configuration.

**Solution**:
1. Check browser console for errors
2. Verify your server is accessible at the configured domain
3. Check server logs for callback receipt
4. Ensure no firewall is blocking the callback

### Token Expired Errors

**Cause**: OAuth access token has expired and refresh failed.

**Solution**:
1. Check server logs for token refresh errors
2. Verify refresh token is still valid
3. Try disconnecting and reconnecting the plugin
4. Check that the OAuth token refresh job is running

## Managing OAuth Connections

### Viewing Active Sessions

To view all OAuth-connected sessions:

1. Navigate to [https://dashboard.stripe.com/settings/apps/com.stripe.mcp](https://dashboard.stripe.com/settings/apps/com.stripe.mcp)
2. Click **"Client sessions"** in the right panel
3. You'll see all active MCP client sessions

### Revoking Access

**From Stripe Dashboard**:
1. Go to client sessions (see above)
2. Find the session you want to revoke
3. Click the overflow menu (⋮)
4. Select **"Revoke session"**

**From Hay Dashboard**:
1. Go to the Plugins page
2. Find the Stripe plugin
3. Click **"Disconnect"** or **"Revoke OAuth"**

### Token Lifecycle

- **Access Token**: Valid for 1 hour by default
- **Refresh Token**: Used to obtain new access tokens
- **Auto-Refresh**: Hay automatically refreshes tokens 5 minutes before expiry
- **Storage**: All tokens are encrypted at rest in the database

## Security Best Practices

1. **Use Restricted Keys for Development**:
   - Use test mode credentials during development
   - Never use live mode credentials unnecessarily

2. **Implement Proper Access Controls**:
   - Only grant OAuth access to trusted organizations
   - Regularly audit connected sessions
   - Revoke unused or old sessions

3. **Monitor API Usage**:
   - Check Stripe Dashboard for API usage
   - Set up alerts for unusual activity
   - Review logs regularly

4. **Rotate Credentials**:
   - Rotate OAuth credentials periodically
   - Update all environments when rotating
   - Revoke old credentials after rotation

5. **Environment Separation**:
   - Use separate credentials for dev, staging, and production
   - Never share production credentials across environments

## OAuth Flow Diagram

```
User                  Hay Server           Stripe OAuth          Stripe MCP
  |                       |                      |                    |
  |-- Connect Plugin ---->|                      |                    |
  |                       |                      |                    |
  |                       |-- Authorization ---->|                    |
  |                       |    URL Request       |                    |
  |                       |                      |                    |
  |<----- Redirect -------|                      |                    |
  |  to Stripe OAuth      |                      |                    |
  |                       |                      |                    |
  |------- Login -------->|                      |                    |
  |  & Authorize          |                      |                    |
  |                       |                      |                    |
  |<----- Redirect -------|                      |                    |
  |  with Auth Code       |                      |                    |
  |                       |                      |                    |
  |-- Callback w/ Code -->|                      |                    |
  |                       |                      |                    |
  |                       |-- Exchange Code ---->|                    |
  |                       |    for Tokens        |                    |
  |                       |                      |                    |
  |                       |<-- Access Token -----|                    |
  |                       |    Refresh Token     |                    |
  |                       |                      |                    |
  |                       |-- Store Encrypted -->|                    |
  |                       |    Tokens in DB      |                    |
  |                       |                      |                    |
  |<--- Success Message --|                      |                    |
  |                       |                      |                    |
  |-- Query Plugin ------>|                      |                    |
  |                       |                      |                    |
  |                       |--------- MCP Request w/ OAuth Token ----->|
  |                       |                      |                    |
  |                       |<-------- MCP Response ---------------------|
  |                       |                      |                    |
  |<---- Response --------|                      |                    |
```

## Additional Resources

- [Stripe API Documentation](https://docs.stripe.com/api)
- [Stripe MCP Documentation](https://docs.stripe.com/mcp)
- [OAuth 2.0 Specification](https://oauth.net/2/)
- [PKCE Specification](https://oauth.net/2/pkce/)
- [Model Context Protocol](https://modelcontextprotocol.io)

## Support

For issues related to:
- **Hay Plugin Configuration**: Check Hay server logs and documentation
- **Stripe API Access**: Visit [Stripe Support](https://support.stripe.com)
- **Stripe MCP OAuth**: Email [mcp@stripe.com](mailto:mcp@stripe.com)
- **OAuth Flow Issues**: Check both Hay and Stripe logs

## Appendix: Environment Variables Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `STRIPE_OAUTH_CLIENT_ID` | Conditional* | OAuth client ID from Stripe (if using traditional OAuth) | `ca_xxxxx...` |
| `STRIPE_OAUTH_CLIENT_SECRET` | Conditional* | OAuth client secret from Stripe (if using traditional OAuth) | `sk_xxxxx...` |
| `OAUTH_REDIRECT_URI` | No | Custom OAuth redirect URI (optional) | `https://custom.domain.com/oauth/callback` |
| `API_DOMAIN` | Recommended | Your API domain (used for redirect URI) | `localhost:3001` or `api.yourdomain.com` |

\* **Conditional**: Only required if Stripe provides client credentials (traditional OAuth). Not needed if Stripe supports CIMD.

## Appendix: Plugin Manifest OAuth Configuration

For reference, here's the OAuth configuration from the plugin manifest:

```json
{
  "capabilities": {
    "mcp": {
      "connection": {
        "type": "remote",
        "url": "https://mcp.stripe.com"
      },
      "auth": {
        "methods": ["oauth2", "apiKey"],
        "oauth": {
          "authorizationUrl": "https://connect.stripe.com/oauth/authorize",
          "tokenUrl": "https://connect.stripe.com/oauth/token",
          "scopes": ["read_write"],
          "pkce": true,
          "clientIdEnvVar": "STRIPE_OAUTH_CLIENT_ID",
          "clientSecretEnvVar": "STRIPE_OAUTH_CLIENT_SECRET"
        }
      }
    }
  }
}
```

This configuration:
- Uses Stripe Connect's OAuth endpoints
- Requests `read_write` scope for full API access
- Enables PKCE for additional security
- Specifies environment variable names for credentials
- Supports both OAuth and API key authentication methods
