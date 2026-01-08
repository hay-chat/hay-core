# Hay Plugin SDK

A TypeScript SDK for building plugins that extend [Hay](https://hay.ai)'s capabilities with support for the [Model Context Protocol (MCP)](https://modelcontextprotocol.io).

## Overview

The Hay Plugin SDK provides:

- **Type-safe plugin development** with full TypeScript support
- **Lifecycle hooks** for initialization, configuration, authentication, and shutdown
- **MCP integration** for connecting AI models with external tools and data sources
- **OAuth2 & API Key authentication** with automatic credential management
- **Dynamic configuration** with environment variable fallback
- **HTTP routes** for custom API endpoints
- **UI extensions** for embedding custom interfaces in the Hay dashboard

## Quick Start

### Installation

```bash
npm install @hay/plugin-sdk
```

### Basic Plugin Example

```typescript
import { defineHayPlugin } from "@hay/plugin-sdk";

export default defineHayPlugin({
  // Global initialization - runs once when plugin loads
  async onInitialize(ctx) {
    ctx.logger.info("Plugin initializing...");

    // Register configuration fields
    ctx.register.config({
      apiKey: ctx.config.field("string", {
        label: "API Key",
        description: "Your service API key",
        required: true,
        secret: true,
      }),
    });

    // Register OAuth2 authentication
    ctx.register.auth.oauth2({
      id: "oauth",
      label: "OAuth Login",
      authorizationUrl: "https://api.example.com/oauth/authorize",
      tokenUrl: "https://api.example.com/oauth/token",
      scopes: ["read", "write"],
    });

    // Register a custom HTTP route
    ctx.register.route("/webhook", "POST", async (req, res) => {
      res.json({ received: true });
    });
  },

  // Organization-specific startup - runs for each org
  async onStart(ctx) {
    ctx.logger.info(`Starting for org: ${ctx.org.id}`);

    // Get configuration values
    const apiKey = ctx.config.get("apiKey");

    // Get authentication credentials
    const auth = ctx.auth.get();
    if (auth) {
      ctx.logger.info(`Authenticated via: ${auth.methodId}`);
    }

    // Start an MCP server
    const mcp = await ctx.mcp.startLocal(async () => {
      const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
      const server = new Server({ name: "my-plugin", version: "1.0.0" }, {});

      // Register MCP tools, resources, prompts here...

      return server;
    });

    ctx.logger.info("MCP server started", { transport: mcp.transport });
  },

  // Validate authentication credentials
  async onValidateAuth(ctx) {
    const auth = ctx.auth.get();
    if (!auth) {
      throw new Error("No authentication configured");
    }

    // Validate credentials with external API
    const isValid = await validateCredentials(auth.credentials);
    if (!isValid) {
      throw new Error("Invalid credentials");
    }
  },

  // Handle configuration updates
  async onConfigUpdate(ctx) {
    const apiKey = ctx.config.get("apiKey");
    ctx.logger.info("Configuration updated");
  },

  // Cleanup on shutdown
  async onDisable(ctx) {
    ctx.logger.info("Plugin shutting down...");
    // MCP servers are automatically stopped
  },
});
```

### Package.json Configuration

Add a `hay-plugin` section to your `package.json`:

```json
{
  "name": "my-hay-plugin",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "hay-plugin": {
    "name": "My Plugin",
    "version": "1.0.0",
    "description": "A plugin that does amazing things",
    "author": "Your Name",
    "capabilities": ["mcp-connector"],
    "environment": {
      "allow": ["MY_SERVICE_API_KEY", "NODE_ENV"]
    }
  }
}
```

## Architecture

### Plugin Lifecycle

1. **onInitialize (Global)** - Runs once when plugin loads
   - Register configuration schema
   - Register authentication methods
   - Register HTTP routes
   - Register UI extensions
   - **Cannot access runtime config or org data**

2. **onStart (Per-Organization)** - Runs for each organization
   - Access configuration values
   - Access authentication credentials
   - Start MCP servers
   - Initialize org-specific resources

3. **onValidateAuth (Per-Organization)** - Triggered when auth credentials change
   - Validate credentials with external services
   - Throw error if invalid

4. **onConfigUpdate (Per-Organization)** - Triggered when config changes
   - React to configuration changes
   - Update internal state

5. **onDisable (Per-Organization)** - Runs when plugin is disabled or worker stops
   - Cleanup resources
   - MCP servers are automatically stopped

### Context Separation

The SDK enforces strict separation between **global** and **organization runtime** contexts:

#### Global Context (onInitialize)

- Used for **registration** and **schema definition**
- Available: `register`, `config.field()`, `logger`
- **Cannot** access runtime config values or org data
- Runs once per plugin load

#### Organization Runtime Context (onStart, onValidateAuth, onConfigUpdate, onDisable)

- Used for **runtime operations**
- Available: `org`, `config.get()`, `auth.get()`, `mcp`, `logger`
- **Cannot** register new config fields or auth methods
- Runs once per organization

## Core APIs

### defineHayPlugin(definition)

Define a plugin with lifecycle hooks.

```typescript
export default defineHayPlugin({
  onInitialize: async (ctx: HayGlobalContext) => {
    /* ... */
  },
  onStart: async (ctx: HayStartContext) => {
    /* ... */
  },
  onValidateAuth: async (ctx: HayAuthValidationContext) => {
    /* ... */
  },
  onConfigUpdate: async (ctx: HayConfigUpdateContext) => {
    /* ... */
  },
  onDisable: async (ctx: HayDisableContext) => {
    /* ... */
  },
});
```

### HayGlobalContext

Available in `onInitialize` hook.

#### register.config(schema)

Register configuration fields:

```typescript
ctx.register.config({
  apiKey: ctx.config.field("string", {
    label: "API Key",
    description: "Your service API key",
    required: true,
    secret: true,
    env: "MY_SERVICE_API_KEY", // Optional env var fallback
  }),
  maxRetries: ctx.config.field("number", {
    label: "Max Retries",
    default: 3,
  }),
  enableFeature: ctx.config.field("boolean", {
    label: "Enable Feature",
    default: false,
  }),
});
```

#### register.auth.apiKey(options)

Register API Key authentication:

```typescript
ctx.register.auth.apiKey({
  id: "api-key",
  label: "API Key",
  fields: {
    apiKey: ctx.config.field("string", {
      label: "API Key",
      required: true,
      secret: true,
    }),
  },
});
```

#### register.auth.oauth2(options)

Register OAuth2 authentication:

```typescript
ctx.register.auth.oauth2({
  id: "oauth",
  label: "OAuth Login",
  authorizationUrl: "https://api.example.com/oauth/authorize",
  tokenUrl: "https://api.example.com/oauth/token",
  scopes: ["read", "write"],
  clientIdEnv: "MY_PLUGIN_CLIENT_ID",
  clientSecretEnv: "MY_PLUGIN_CLIENT_SECRET",
});
```

#### register.route(path, method, handler)

Register a custom HTTP route:

```typescript
ctx.register.route("/webhook", "POST", async (req, res) => {
  const payload = req.body;
  // Handle webhook
  res.json({ success: true });
});
```

#### register.ui(extension)

Register a UI extension:

```typescript
ctx.register.ui({
  id: "settings-panel",
  location: "plugin-settings",
  component: "SettingsPanel.vue",
});
```

### HayStartContext

Available in `onStart`, `onValidateAuth`, `onConfigUpdate`, `onDisable` hooks.

#### org

Access organization information:

```typescript
const orgId = ctx.org.id;
const orgName = ctx.org.name;
```

#### config.get(key)

Get configuration value with org config → env var fallback:

```typescript
const apiKey = ctx.config.get("apiKey"); // string
const maxRetries = ctx.config.get("maxRetries"); // number
```

#### config.getOptional(key)

Get optional configuration value:

```typescript
const webhookUrl = ctx.config.getOptional("webhookUrl"); // string | null
```

#### config.keys()

Get all available config keys:

```typescript
const keys = ctx.config.keys(); // string[]
```

#### auth.get()

Get authentication state:

```typescript
const auth = ctx.auth.get();
if (auth) {
  console.log(auth.methodId); // 'oauth' | 'api-key'
  console.log(auth.credentials); // Record<string, any>
}
```

#### mcp.startLocal(initializer)

Start a local MCP server:

```typescript
const mcp = await ctx.mcp.startLocal(async () => {
  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const server = new Server({ name: "my-plugin", version: "1.0.0" }, { capabilities: {} });

  // Register tools, resources, prompts...
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "get-data",
        description: "Fetch data from service",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }));

  return server;
});
```

#### mcp.startExternal(options)

Connect to an external MCP server:

```typescript
const mcp = await ctx.mcp.startExternal({
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
  env: { PATH: process.env.PATH },
});
```

#### logger

Log messages with context:

```typescript
ctx.logger.debug("Debug message", { key: "value" });
ctx.logger.info("Info message");
ctx.logger.warn("Warning message");
ctx.logger.error("Error message", { error: err });
```

## Configuration System

### Field Types

- `string` - Text values
- `number` - Numeric values
- `boolean` - True/false values
- `json` - JSON objects/arrays

### Field Options

```typescript
ctx.config.field("string", {
  label: "Display Name", // UI label
  description: "Help text", // UI description
  required: true, // Is required?
  secret: true, // Mask in UI?
  default: "default-value", // Default value
  env: "ENV_VAR_NAME", // Env var fallback
  validation: {
    min: 1, // Min value (number)
    max: 100, // Max value (number)
    pattern: "^[a-z]+$", // Regex pattern (string)
    enum: ["opt1", "opt2"], // Allowed values
  },
});
```

### Resolution Pipeline

When accessing config values via `ctx.config.get(key)`:

1. Check organization-specific config (from Hay Core)
2. Fall back to environment variable (if `env` specified)
3. Fall back to `default` value
4. Throw error if `required` and not found

## Authentication System

### API Key Authentication

Simple key-based authentication:

```typescript
ctx.register.auth.apiKey({
  id: "api-key",
  label: "API Key",
  fields: {
    apiKey: ctx.config.field("string", {
      label: "API Key",
      required: true,
      secret: true,
    }),
  },
});
```

Access credentials:

```typescript
const auth = ctx.auth.get();
if (auth?.methodId === "api-key") {
  const apiKey = auth.credentials.apiKey;
}
```

### OAuth2 Authentication

OAuth2 flow with automatic token management:

```typescript
ctx.register.auth.oauth2({
  id: "oauth",
  label: "OAuth Login",
  authorizationUrl: "https://api.example.com/oauth/authorize",
  tokenUrl: "https://api.example.com/oauth/token",
  scopes: ["read", "write"],
  clientIdEnv: "MY_PLUGIN_CLIENT_ID",
  clientSecretEnv: "MY_PLUGIN_CLIENT_SECRET",
});
```

Access credentials:

```typescript
const auth = ctx.auth.get();
if (auth?.methodId === "oauth") {
  const accessToken = auth.credentials.access_token;
  const refreshToken = auth.credentials.refresh_token;
}
```

## MCP Integration

### Local MCP Server

Start an MCP server in the same process:

```typescript
const mcp = await ctx.mcp.startLocal(async () => {
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const server = new Server(
    { name: 'my-plugin', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  // Register tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // Handle tool calls
  });

  return server;
});

console.log(mcp.transport); // 'stdio'
```

### External MCP Server

Connect to an external MCP server process:

```typescript
const mcp = await ctx.mcp.startExternal({
  command: "node",
  args: ["./external-mcp-server.js"],
  env: {
    API_KEY: ctx.config.get("apiKey"),
    PATH: process.env.PATH,
  },
});

console.log(mcp.transport); // 'stdio'
```

## HTTP Routes

Register custom API endpoints:

```typescript
ctx.register.route("/webhook", "POST", async (req, res) => {
  const payload = req.body;

  // Process webhook
  await processWebhook(payload);

  res.json({ success: true });
});

ctx.register.route("/health", "GET", async (req, res) => {
  res.json({ status: "ok" });
});
```

Routes are accessible at:

```
http://localhost:<port>/<path>
```

## UI Extensions

Register Vue components to extend the Hay dashboard:

```typescript
ctx.register.ui({
  id: "custom-settings",
  location: "plugin-settings",
  component: "CustomSettings.vue",
  props: {
    theme: "dark",
  },
});
```

Supported locations:

- `plugin-settings` - Plugin settings page
- `conversation-sidebar` - Conversation sidebar
- `agent-toolbar` - Agent toolbar

## Runner Usage

The runner is used by Hay Core to execute plugins in isolated worker processes.

### Command Line

```bash
node runner/index.js \
  --plugin-path ./examples/stripe \
  --org-id org_123 \
  --port 3100 \
  --mode production
```

### Options

- `--plugin-path` - Path to plugin directory
- `--org-id` - Organization ID
- `--port` - HTTP server port
- `--mode` - `production` or `test` (default: production)

### Environment Variables

#### Production Mode

```bash
# Organization configuration (JSON)
HAY_ORG_CONFIG='{"apiKey":"sk_test_123","maxRetries":5}'

# Organization authentication (JSON)
HAY_ORG_AUTH='{"methodId":"oauth","credentials":{"access_token":"..."}}'
```

#### Test Mode

Uses mock data for standalone testing without Hay Core.

### Metadata Endpoint

The runner exposes a `/metadata` endpoint that returns plugin metadata:

```bash
curl http://localhost:3100/metadata
```

Response:

```json
{
  "configSchema": {
    "apiKey": {
      "type": "string",
      "label": "API Key",
      "required": true,
      "secret": true
    }
  },
  "authMethods": [
    {
      "type": "oauth2",
      "id": "oauth",
      "label": "OAuth Login",
      "authorizationUrl": "https://api.example.com/oauth/authorize",
      "tokenUrl": "https://api.example.com/oauth/token",
      "scopes": ["read", "write"]
    }
  ],
  "routes": [
    { "path": "/webhook", "method": "POST" }
  ],
  "uiExtensions": [...],
  "mcp": {
    "local": [...],
    "external": [...]
  }
}
```

## Development

### Project Structure

```
plugin-sdk/
├── sdk/                    # SDK implementation
│   ├── index.ts           # Main exports
│   ├── factory.ts         # defineHayPlugin()
│   ├── logger.ts          # Logger implementation
│   ├── register.ts        # Registration APIs
│   ├── registry.ts        # Internal registries
│   ├── config-descriptor.ts  # Config field API
│   ├── config-runtime.ts  # Runtime config API
│   ├── auth-runtime.ts    # Runtime auth API
│   └── mcp-runtime.ts     # MCP management
├── runner/                 # Plugin runner
│   ├── index.ts           # Main entry point
│   ├── bootstrap.ts       # CLI argument parsing
│   ├── plugin-loader.ts   # Plugin loading
│   ├── global-context.ts  # Global context creation
│   ├── org-context.ts     # Org runtime context
│   ├── hook-executor.ts   # Hook orchestration
│   └── http-server.ts     # HTTP server setup
├── types/                  # Type definitions
│   ├── context.ts         # Context interfaces
│   ├── hooks.ts           # Hook signatures
│   ├── config.ts          # Config types
│   ├── auth.ts            # Auth types
│   └── manifest.ts        # Manifest types
├── examples/               # Example plugins
│   └── stripe/            # Stripe plugin example
└── README.md              # This file
```

### Building

```bash
cd plugin-sdk
npm install
npm run build
```

### Testing

```bash
npm test
```

### Running Examples

```bash
# Build example
cd examples/stripe
npm install
npm run build

# Run with mock data
cd ../..
node runner/index.js \
  --plugin-path ./examples/stripe \
  --org-id org_test \
  --port 3100 \
  --mode test
```

## Best Practices

### 1. Separate Global and Org Logic

```typescript
// ✅ Good: Register in onInitialize
async onInitialize(ctx) {
  ctx.register.config({
    apiKey: ctx.config.field('string', { required: true }),
  });
}

// ✅ Good: Access runtime values in onStart
async onStart(ctx) {
  const apiKey = ctx.config.get('apiKey');
  await initClient(apiKey);
}

// ❌ Bad: Don't access runtime values in onInitialize
async onInitialize(ctx) {
  const apiKey = ctx.config.get('apiKey'); // Error!
}
```

### 2. Validate Auth Properly

```typescript
async onValidateAuth(ctx) {
  const auth = ctx.auth.get();
  if (!auth) {
    throw new Error('Authentication required');
  }

  // Actually test the credentials
  try {
    await testCredentials(auth.credentials);
  } catch (err) {
    throw new Error(`Invalid credentials: ${err.message}`);
  }
}
```

### 3. Handle Errors Gracefully

```typescript
async onStart(ctx) {
  try {
    const mcp = await ctx.mcp.startLocal(async () => {
      // MCP setup
    });
  } catch (err) {
    ctx.logger.error('Failed to start MCP server', { error: err });
    throw err; // Re-throw to signal failure
  }
}
```

### 4. Use Environment Variables for Secrets

```typescript
// ❌ Bad: Hardcoded secrets
ctx.register.auth.oauth2({
  clientId: "hardcoded-client-id",
  clientSecret: "hardcoded-secret",
});

// ✅ Good: Environment variables
ctx.register.auth.oauth2({
  clientIdEnv: "MY_PLUGIN_CLIENT_ID",
  clientSecretEnv: "MY_PLUGIN_CLIENT_SECRET",
});
```

### 5. Cleanup Resources

```typescript
async onDisable(ctx) {
  ctx.logger.info('Cleaning up...');
  // MCP servers are automatically stopped
  // Close any other resources (connections, timers, etc.)
  await closeConnections();
}
```

## Examples

See [examples/stripe](examples/stripe/) for a complete plugin implementation demonstrating:

- Configuration management
- OAuth2 authentication
- API Key authentication fallback
- MCP server integration
- HTTP route registration
- UI extensions
- Error handling
- Logging

## Troubleshooting

### "Cannot call config.get() in onInitialize"

You're trying to access runtime config values in the global initialization hook. Use `ctx.config.field()` to define the schema in `onInitialize`, then access values with `ctx.config.get()` in `onStart` or other org runtime hooks.

### "Environment variable not allowed"

The environment variable you're trying to access is not in the `environment.allow` list in your `package.json` manifest. Add it to the allowlist:

```json
{
  "hay-plugin": {
    "environment": {
      "allow": ["MY_ENV_VAR"]
    }
  }
}
```

### "MCP server failed to start"

Check the logs for specific errors. Common issues:

- Missing dependencies
- Invalid MCP server initialization
- Port conflicts
- Permission issues

### "Authentication validation failed"

Ensure your `onValidateAuth` hook properly tests credentials with the external service. Don't just check if credentials exist—actually validate them.

## Reference Documentation

- **[docs/PLUGIN_API.md](../../docs/PLUGIN_API.md)** - Complete plugin API documentation
- **[docs/PLUGIN_QUICK_REFERENCE.md](../../docs/PLUGIN_QUICK_REFERENCE.md)** - Quick reference for plugin development

## Contributing

This is an internal SDK for Hay plugins. For questions or issues, contact the Hay team.

## License

Proprietary - © Hay AI
