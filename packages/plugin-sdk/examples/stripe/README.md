# Stripe Plugin Example

This is a complete example plugin for the Hay Plugin SDK, demonstrating all features and best practices.

## Purpose

This example serves as:

- **Learning artifact**: Study this code to understand how to build Hay plugins
- **Template**: Copy and modify for your own integrations
- **Reference**: See examples of all SDK APIs and hooks

**Note**: This is NOT production-ready code. It uses mocks instead of real Stripe SDK.

## Features Demonstrated

### ✅ Config Schema

- String, boolean, and sensitive fields
- Environment variable fallbacks
- Required vs optional fields

### ✅ Authentication

- API key auth method
- Auth validation hook with real verification
- Multiple auth method support (OAuth commented as example)

### ✅ HTTP Routes

- Webhook endpoint (POST /webhook)
- Health check endpoint (GET /health)
- Request/response handling

### ✅ UI Extensions

- Settings panel integration
- Dashboard widgets
- Symbolic component references

### ✅ MCP Integration

- Local MCP server startup
- Org-specific initialization
- Automatic cleanup on shutdown

### ✅ All Lifecycle Hooks

- `onInitialize`: Declare static metadata
- `onStart`: Initialize org runtime
- `onValidateAuth`: Verify credentials
- `onConfigUpdate`: React to config changes
- `onDisable`: Cleanup on uninstall

## Project Structure

```
examples/stripe/
├── package.json           # Plugin manifest + build config
├── tsconfig.json          # TypeScript configuration
├── README.md              # This file
└── src/
    ├── index.ts           # Main plugin entry (all hooks)
    ├── stripe-client.ts   # Mock Stripe API client
    └── stripe-mcp-server.ts  # Mock MCP server
```

## Building

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Watch mode (auto-rebuild on changes)
npm run watch

# Clean build output
npm run clean
```

## Running the Plugin

The compiled plugin can be run using the SDK runner:

```bash
# From plugin-sdk root:
node runner/index.js \
  --plugin-path=./examples/stripe \
  --org-id=org_test123 \
  --port=48001 \
  --mode=test
```

### Test Mode

In test mode (`--mode=test`), the plugin uses mock org data:

```json
{
  "org": {
    "id": "org_test123",
    "name": "Test Organization"
  },
  "config": {
    "apiKey": "sk_test_mock123",
    "webhookSecret": "whsec_test456",
    "enableTestMode": true
  }
}
```

Auth state:

```json
{
  "methodId": "apiKey",
  "credentials": {
    "apiKey": "sk_test_mock123"
  }
}
```

### Production Mode

In production mode (`--mode=production`), the plugin loads from environment variables:

```bash
export HAY_ORG_CONFIG='{
  "org": {"id": "org_abc123", "name": "Acme Corp"},
  "config": {"apiKey": "sk_live_xyz789"}
}'

export HAY_ORG_AUTH='{
  "methodId": "apiKey",
  "credentials": {"apiKey": "sk_live_xyz789"}
}'

node runner/index.js \
  --plugin-path=./examples/stripe \
  --org-id=org_abc123 \
  --port=48001 \
  --mode=production
```

## Testing the Plugin

### 1. Check Metadata Endpoint

```bash
curl http://localhost:48001/metadata | jq
```

Expected response:

```json
{
  "configSchema": {
    "apiKey": {
      "type": "string",
      "label": "Stripe API Key",
      "required": false,
      "env": "STRIPE_API_KEY",
      "sensitive": true
    },
    ...
  },
  "authMethods": [
    {
      "type": "apiKey",
      "id": "apiKey",
      "label": "API Key",
      "configField": "apiKey"
    }
  ],
  "uiExtensions": [...],
  "routes": [
    { "method": "POST", "path": "/webhook" },
    { "method": "GET", "path": "/health" }
  ],
  "mcp": {
    "local": [],
    "external": []
  }
}
```

### 2. Test Health Endpoint

```bash
curl http://localhost:48001/health
```

Expected: `{"status":"ok","plugin":"stripe"}`

### 3. Test Webhook Endpoint

```bash
curl -X POST http://localhost:48001/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "id": "evt_test123",
    "type": "payment_intent.succeeded",
    "data": {
      "object": {
        "id": "pi_test456",
        "amount": 5000
      }
    }
  }'
```

Expected: `{"received":true}`

Check logs for:

```
[stripe] Received Stripe webhook
[stripe] Processing Stripe event: payment_intent.succeeded
[stripe] Payment succeeded
```

### 4. Verify MCP Server Startup

Check logs after startup:

```
[stripe] Starting Stripe plugin for org: org_test123
[stripe] Starting Stripe MCP server
[stripe] Stripe MCP server started
[stripe] Stripe MCP server started successfully
```

## Code Walkthrough

### Main Entry (src/index.ts)

The plugin factory returns a `HayPluginDefinition` with all hooks:

```typescript
function createStripePlugin(globalCtx: HayGlobalContext): HayPluginDefinition {
  return {
    name: "Stripe",
    onInitialize() {
      /* ... */
    },
    async onStart(ctx) {
      /* ... */
    },
    async onValidateAuth(ctx) {
      /* ... */
    },
    onConfigUpdate(ctx) {
      /* ... */
    },
    async onDisable(ctx) {
      /* ... */
    },
  };
}
```

### Hook: onInitialize

Declares static plugin metadata:

```typescript
onInitialize() {
  // 1. Define config schema
  register.config({
    apiKey: { type: "string", env: "STRIPE_API_KEY", encrypted: true },
    webhookSecret: { type: "string", env: "STRIPE_WEBHOOK_SECRET" },
  });

  // 2. Register auth methods
  register.auth.apiKey({
    id: "apiKey",
    label: "API Key",
    configField: "apiKey",
  });

  // 3. Register HTTP routes
  register.route("POST", "/webhook", async (req, res) => { /* ... */ });

  // 4. Register UI extensions
  register.ui({
    slot: "plugin-settings",
    component: "components/StripeSettings.vue",
  });
}
```

### Hook: onStart

Initializes org-specific runtime:

```typescript
async onStart(ctx) {
  // 1. Get auth credentials
  const authState = ctx.auth.get();
  const apiKey = authState?.credentials.apiKey;

  // 2. Start MCP server for this org
  await ctx.mcp.startLocal("stripe-mcp", async () => {
    const server = new StripeMcpServer({ apiKey, logger });
    await server.start();
    return server;
  });
}
```

### Hook: onValidateAuth

Validates credentials:

```typescript
async onValidateAuth(ctx): Promise<boolean> {
  const authState = ctx.auth.get();
  const apiKey = authState?.credentials.apiKey;

  const client = new StripeClient({ apiKey });
  return await client.verify(); // true/false
}
```

### Mock Stripe Client (src/stripe-client.ts)

Simulates Stripe API:

```typescript
export class StripeClient {
  async verify(): Promise<boolean> {
    // Mock: Valid if starts with sk_test_ or sk_live_
    return this.apiKey.startsWith("sk_test_") || this.apiKey.startsWith("sk_live_");
  }

  async getAccount() {
    /* ... */
  }
  async listCharges() {
    /* ... */
  }
}
```

### Mock MCP Server (src/stripe-mcp-server.ts)

Implements MCP server lifecycle:

```typescript
export class StripeMcpServer {
  async start() {
    // Initialize MCP protocol
    // Register tools (create_payment_link, list_customers, etc.)
  }

  async stop() {
    // Cleanup
  }

  private getToolNames() {
    return ["stripe_create_payment_link", "stripe_list_customers", "stripe_refund_charge"];
  }
}
```

## Adapting for Production

To turn this into a real Stripe plugin:

1. **Install Stripe SDK**:

   ```bash
   npm install stripe @types/stripe
   ```

2. **Replace mock client**:

   ```typescript
   import Stripe from "stripe";

   const client = new Stripe(apiKey, { apiVersion: "2024-11-20.acacia" });
   await client.balance.retrieve(); // For verification
   ```

3. **Implement webhook verification**:

   ```typescript
   const signature = req.headers["stripe-signature"];
   const event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
   ```

4. **Build real MCP server**:
   - Implement MCP protocol (JSON-RPC)
   - Register actual tools calling Stripe APIs
   - Handle tool invocations from orchestrator

5. **Create Vue components**:
   ```vue
   <!-- components/StripeSettings.vue -->
   <template>
     <div class="stripe-settings">
       <h3>Stripe Configuration</h3>
       <!-- Settings UI -->
     </div>
   </template>
   ```

## Key Concepts

### Config Resolution Pipeline

When you call `config.get("apiKey")`:

1. Check org-specific config (from database)
2. If undefined, check field descriptor for `env` property
3. If `env` is set and whitelisted in manifest, return `process.env[env]`
4. If still undefined, return `undefined` or throw (based on `required`)

### Auth Validation Flow

1. User enters API key in dashboard
2. Dashboard calls plugin worker: `POST /validate-auth`
3. Worker executes `onValidateAuth` hook
4. Plugin tests credentials against Stripe API
5. Returns true/false
6. Dashboard shows "Connected" or "Auth failed"

### MCP Lifecycle

1. `onStart` calls `mcp.startLocal("id", initializer)`
2. Initializer function creates and starts MCP server
3. SDK tracks the server instance
4. On shutdown, SDK calls `server.stop()` automatically
5. `onDisable` can do additional cleanup if needed

### Global vs Org Runtime

**Global (onInitialize)**:

- Runs once per worker process
- No org data available
- Use `register.*` APIs
- Use `config.field()` for references

**Org Runtime (onStart, onValidateAuth, etc.)**:

- Runs per org
- Has org config and auth
- Use `config.get()` to read values
- Use `auth.get()` to read credentials

## Troubleshooting

### Plugin won't load

- Check `package.json` has valid `hay-plugin` block
- Verify `entry` points to compiled JS (not TS source)
- Run `npm run build` to compile TypeScript

### MCP server not starting

- Check logs for errors in `onStart`
- Verify API key is configured (test mode or env vars)
- Ensure `apiKey` starts with `sk_test_` or `sk_live_`

### Auth validation fails

- Check API key format
- See logs for validation details
- Mock client requires `sk_test_*` or `sk_live_*` prefix

### Metadata endpoint returns errors

- Ensure `onInitialize` completed successfully
- Check for errors in register.\* calls
- Verify server started on correct port

## Learning Resources

- **PLUGIN.md**: Full SDK specification
- **PLUGIN_SDK_V2_PLAN.md**: Implementation plan and phases
- **plugin-sdk/sdk/**: SDK implementation source code
- **plugin-sdk/runner/**: Worker process implementation

## License

MIT
