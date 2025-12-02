# Stripe MCP OAuth - Pending Implementation

## Current Status

- ✅ Redirect URI allowlist request sent to Stripe (mcp@stripe.com)
- ⏳ Waiting for Stripe's response about their OAuth implementation
- ⏳ Current manifest.json has placeholder OAuth config that may need updating

## Current Implementation Issues

### 1. OAuth Endpoints in manifest.json

The current `manifest.json` uses Stripe Connect OAuth endpoints:
```json
"authorizationUrl": "https://connect.stripe.com/oauth/authorize",
"tokenUrl": "https://connect.stripe.com/oauth/token"
```

**Problem**: These are for Stripe Connect (platforms connecting to merchant accounts), NOT for MCP OAuth.

**Correct endpoints** (pending Stripe confirmation):
- Authorization URL: Likely provided by Stripe MCP server or via OAuth discovery
- Token URL: Likely provided by Stripe MCP server or via OAuth discovery
- May use standard MCP OAuth flow with PKCE

### 2. Client Credentials

Current config expects:
- `STRIPE_OAUTH_CLIENT_ID` (from env var)
- `STRIPE_OAUTH_CLIENT_SECRET` (from env var)

**Possible outcomes after Stripe responds**:

#### Option A: Traditional OAuth
Stripe provides `client_id` and `client_secret` → No code changes needed, just update env vars

#### Option B: Client ID Metadata Document (CIMD)
Stripe supports CIMD → Need to implement:
1. Remove credential requirements for Stripe plugin
2. Host metadata JSON at `/.well-known/oauth-client` or similar
3. Use Hay's URL as `client_id`
4. Update `oauth.service.ts` to support CIMD flow

## Files to Update When Stripe Responds

### If Traditional OAuth (with credentials):
- [ ] Update `manifest.json` with correct authorization/token URLs
- [ ] Add credentials to `.env` file
- [ ] Test OAuth flow

### If CIMD (no credentials):
- [ ] Implement CIMD support in `server/services/oauth.service.ts`
- [ ] Create metadata endpoint (Express route)
- [ ] Remove credential check for Stripe in `oauth.service.ts` (see TODO comment)
- [ ] Update `manifest.json` to remove `clientIdEnvVar` and `clientSecretEnvVar`
- [ ] Update documentation to remove credential references
- [ ] Test CIMD OAuth flow

## Reference Links

- [MCP OAuth Specification](https://modelcontextprotocol.io/specification/draft/basic/authorization)
- [Client ID Metadata Document](https://oauth.net/2/client-id-metadata-document/)
- [Stripe MCP Docs](https://docs.stripe.com/mcp)
- TODO comments in `server/services/oauth.service.ts:67-74`

## Next Steps

1. Wait for Stripe's email response
2. Determine which OAuth method they support
3. Follow the appropriate checklist above
4. Update all documentation (README.md, OAUTH_SETUP.md, .env.example)
5. Test thoroughly in development
6. Deploy to production
