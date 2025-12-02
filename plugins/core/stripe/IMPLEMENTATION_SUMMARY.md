# Stripe Plugin - Implementation Summary

## Overview

The Stripe plugin for Hay has been successfully implemented with **dual authentication support**: both OAuth 2.0 and API key authentication. This provides flexibility for different deployment scenarios.

## Authentication Architecture

### Priority-Based Authentication System

The plugin implements a smart fallback system:

```
1. Try OAuth first (if tokens available)
   ↓ (if no OAuth)
2. Try API Key (if configured)
   ↓ (if neither)
3. Request fails (no authentication)
```

### Implementation Location

**File**: [`server/services/remote-mcp-client.service.ts`](../../server/services/remote-mcp-client.service.ts)

**Method**: `getAuthHeaders()` - Private method that:
1. Attempts to retrieve OAuth tokens via `oauthAuthStrategy.getHeaders()`
2. Falls back to API key from plugin config if OAuth unavailable
3. Returns `Authorization: Bearer <token>` header with the appropriate credential

**Used by**:
- `connect()` - Initial MCP server connection
- `listTools()` - Fetching available tools
- `callTool()` - Executing tool calls

All three methods use the same authentication logic, ensuring consistent auth behavior.

## Authentication Methods

### Method 1: API Key (Simple, Self-Hosted)

**How it works**:
1. User provides Stripe API key via plugin configuration UI
2. API key is encrypted and stored in `plugin_instances.config.stripeApiKey`
3. When making requests to Stripe's MCP server:
   - Key is decrypted from config
   - Sent as `Authorization: Bearer sk_test_xxx` or `Authorization: Bearer sk_live_xxx`
4. Stripe MCP server validates the key and processes the request

**Advantages**:
- ✅ **Instant setup** - No external approval needed
- ✅ **Simple** - Just paste your API key
- ✅ **Full control** - Use restricted keys to limit permissions
- ✅ **Perfect for self-hosted** - No need to be allowlisted by Stripe

**Setup**: See "Quick Start" in [README.md](README.md)

**Recommended for**:
- Self-hosted Hay installations
- Development and testing
- Personal or team use
- Autonomous agents

### Method 2: OAuth 2.0 (Secure, Managed/Cloud)

**How it works**:
1. User clicks "Connect with OAuth" in plugin settings
2. Hay redirects to Stripe's authorization page
3. User authorizes access on Stripe's consent screen
4. Stripe redirects back with authorization code
5. Hay exchanges code for access token + refresh token
6. Tokens encrypted and stored in `plugin_instances.config._oauth`
7. When making requests:
   - Tokens decrypted
   - Access token checked for expiry (auto-refresh if < 5 min remaining)
   - Sent as `Authorization: Bearer <access_token>`

**Advantages**:
- ✅ **More secure** - Granular permissions, user-based auth
- ✅ **Better UX** - One-click authorization
- ✅ **Revocable** - Users can disconnect anytime
- ✅ **Multi-tenant friendly** - Each org gets their own tokens

**Requirements**:
- Hay's redirect URI must be allowlisted by Stripe
- OAuth client credentials configured in environment variables
- Stripe MCP app authorization

**Setup**: See detailed guide in [OAUTH_SETUP.md](OAUTH_SETUP.md)

**Recommended for**:
- Managed/cloud Hay services
- Multi-user environments
- SaaS products
- When building for marketplace visibility

## Configuration Files

### Plugin Manifest

**File**: [`plugins/stripe/manifest.json`](manifest.json)

**Key sections**:

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
  },
  "configSchema": {
    "stripeApiKey": {
      "type": "string",
      "encrypted": true,
      "required": false
    }
  }
}
```

**Important notes**:
- `auth.methods` lists both `oauth2` and `apiKey`
- `stripeApiKey` in config schema is encrypted automatically
- OAuth config references environment variables for credentials

### Environment Variables

**File**: [`.env.example`](../../.env.example)

**For OAuth** (managed/cloud):
```bash
STRIPE_OAUTH_CLIENT_ID=ca_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
STRIPE_OAUTH_CLIENT_SECRET=sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**For API Key** (self-hosted):
Users configure directly in plugin settings UI - no env vars needed!

## Code Changes Made

### 1. Remote MCP Client Enhancement

**File**: `server/services/remote-mcp-client.service.ts`

**Added**:
- New `getAuthHeaders()` private method implementing priority-based auth
- Imports for `pluginInstanceRepository`, `pluginRegistryRepository`, `decryptConfig`
- Logic to check for API keys in config: `stripeApiKey`, `apiKey`, or `api_key`

**Changed**:
- `connect()` - Uses `getAuthHeaders()` instead of inline OAuth logic
- `listTools()` - Uses `getAuthHeaders()` instead of inline OAuth logic
- `callTool()` - Uses `getAuthHeaders()` instead of inline OAuth logic

**Result**: All requests now support both auth methods with automatic fallback.

### 2. Plugin Manifest Updates

**File**: `plugins/stripe/manifest.json`

**Updated**:
- `configSchema.stripeApiKey.description` - Clarifies when to use API key vs OAuth
- `configSchema.stripeApiKey.label` - Removed "Optional" to emphasize it's a primary method

### 3. Documentation Updates

**Files updated**:
- `plugins/stripe/README.md` - Complete rewrite with Quick Start, clear method comparison
- `plugins/stripe/OAUTH_SETUP.md` - Added warning that OAuth is mainly for managed instances
- `.env.example` - Added OAuth credentials with clear comments

## Usage Examples

### Self-Hosted Setup (API Key)

1. Get API key from Stripe Dashboard
2. In Hay: Plugins → Stripe → Configure
3. Paste API key, save
4. Ask: "List my recent customers"

### Managed/Cloud Setup (OAuth)

1. Provider configures OAuth credentials in `.env`
2. User: Plugins → Stripe → "Connect with OAuth"
3. Authorizes on Stripe
4. Ask: "What's my Stripe balance?"

## Testing

To test both authentication methods:

### Test API Key Authentication

1. Configure API key in plugin settings
2. Don't set up OAuth credentials
3. Try tool calls - should use Bearer token with API key

### Test OAuth Authentication

1. Set `STRIPE_OAUTH_CLIENT_ID` and `STRIPE_OAUTH_CLIENT_SECRET`
2. Connect via OAuth flow
3. Try tool calls - should use OAuth access token
4. OAuth takes priority over API key if both exist

### Test Fallback

1. Configure API key
2. Attempt OAuth (it will fail without proper setup)
3. System automatically falls back to API key
4. Check logs to see fallback in action

## Security Considerations

### API Key Security

- ✅ Keys are **encrypted at rest** using the encryption service
- ✅ Keys are **decrypted only when needed** for requests
- ✅ Recommend **restricted keys** to limit permissions
- ✅ Keys never exposed in logs or responses

### OAuth Security

- ✅ **PKCE enabled** for authorization code flow
- ✅ **Tokens encrypted** at rest in database
- ✅ **Auto token refresh** prevents expired token usage
- ✅ **State parameter** prevents CSRF attacks
- ✅ **Nonce validation** in Redis (10-minute TTL)

### Network Security

- ✅ All requests to `https://mcp.stripe.com` over TLS
- ✅ Authorization header only sent over HTTPS
- ✅ No credentials in URL query parameters

## Deployment Recommendations

### For Self-Hosted Users

**Recommended**: Use API key authentication
- Get Stripe API key from dashboard
- Configure in plugin settings
- Start using immediately

**Why not OAuth?**:
- Requires Stripe to allowlist your redirect URI
- May not be approved for individual installations
- Takes time (1-2 business days for approval)
- API key is simpler and equally functional

### For Managed/Cloud Providers

**Recommended**: Set up OAuth
- Contact Stripe to get allowlisted
- Configure OAuth credentials
- Provide one-click OAuth connection to users

**Benefits**:
- Better user experience (one-click auth)
- More secure (user-based permissions)
- Can get listed in Stripe marketplace
- Users can revoke access easily

**Also support**: API key as alternative
- Some users prefer API keys
- Good for testing
- Works for autonomous agents

## Future Improvements

Possible enhancements:

1. **Dynamic Tool Discovery**: Fetch tools from Stripe MCP server instead of hardcoding
2. **Webhook Support**: Listen for Stripe webhooks to update data in real-time
3. **Rate Limiting**: Track and display API rate limit usage
4. **Multi-Account**: Support connecting multiple Stripe accounts per organization
5. **Scoped OAuth**: Request only needed permissions instead of `read_write`

## Support Resources

- **API Key Setup**: See [README.md](README.md) Quick Start section
- **OAuth Setup**: See [OAUTH_SETUP.md](OAUTH_SETUP.md) detailed guide
- **Stripe MCP Docs**: https://docs.stripe.com/mcp
- **Stripe Support**: https://support.stripe.com
- **Stripe MCP Team**: mcp@stripe.com

## Summary

✅ **Both auth methods work**
✅ **Smart fallback system** (OAuth → API Key)
✅ **Simple setup for self-hosted** (just paste API key)
✅ **OAuth ready for managed/cloud** (when allowlisted)
✅ **Secure** (encrypted storage, PKCE, token refresh)
✅ **Well documented** (README, OAuth guide, this summary)

The Stripe plugin is production-ready and provides flexibility for different deployment scenarios!
