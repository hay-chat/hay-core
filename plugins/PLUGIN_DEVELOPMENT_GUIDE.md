# Hay Plugin Development Guide

Complete guide for creating plugins for the Hay platform using SDK.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Plugin Architecture](#plugin-architecture)
- [SDK Lifecycle](#sdk-v2-lifecycle)
- [Configuration](#configuration)
- [Authentication Patterns](#authentication-patterns)
- [MCP Integration](#mcp-integration)
- [Development Setup](#development-setup)
- [Common Patterns](#common-patterns)
- [Troubleshooting](#troubleshooting)

---

## Overview

Hay plugins extend the platform's functionality using the **Model Context Protocol (MCP)**. Plugins can:

- Connect to external services (Stripe, HubSpot, WooCommerce, etc.)
- Provide AI-accessible tools and resources
- Manage authentication (OAuth2, API Keys)
- Handle configuration per organization

**Key Principles:**
- Plugins use **SDK** with factory pattern (`defineHayPlugin`)
- Each plugin runs per organization with isolated configuration
- Plugins can start local MCP servers (child process) or connect to external MCP servers
- All code must use **ES Modules** (not CommonJS)

---

## Quick Start

### 1. Create Plugin Directory Structure

```bash
plugins/core/my-plugin/
├── src/
│   ├── index.ts                    # Main plugin entry (required)
│   └── my-plugin-mcp-server.ts     # MCP server wrapper (if local)
├── mcp/                             # MCP server code (if local)
│   └── index.js                    # MCP server implementation
├── package.json                     # NPM package config
├── tsconfig.json                    # TypeScript config
└── README.md                        # Plugin documentation
```

### 2. Create `package.json`

```json
{
  "name": "@hay/plugin-my-plugin",
  "version": "1.0.0",
  "description": "Description of what your plugin does",
  "author": "Hay",
  "type": "module",                  // REQUIRED for ES modules
  "main": "dist/index.js",
  "hay-plugin": {
    "entry": "./dist/index.js",
    "displayName": "My Plugin",
    "category": "integration",
    "capabilities": ["mcp"],
    "env": []
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@hay/plugin-sdk": "file:../../../plugin-sdk"
  },
  "devDependencies": {
    "typescript": "^5.3.3",
    "@types/node": "^20.10.0"
  }
}
```

**Critical:** `"type": "module"` is required for ES module support.

### 3. Create `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",              // Must be ES2020/ES2022, NOT CommonJS
    "moduleResolution": "node",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "strict": false,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "mcp"]
}
```

**Critical:** `"module": "ES2020"` (or ES2022) ensures TypeScript compiles to ES modules.

### 4. Create Plugin Entry (`src/index.ts`)

```typescript
import { defineHayPlugin } from '@hay/plugin-sdk';

export default defineHayPlugin((globalCtx) => ({
  name: 'My Plugin',

  /**
   * Global initialization - register config and auth
   */
  onInitialize(ctx) {
    globalCtx.logger.info('Initializing My Plugin');

    // Register configuration fields
    ctx.register.config({
      apiKey: {
        type: 'string',
        label: 'API Key',
        description: 'Your service API key',
        required: true,
        encrypted: true,
      },
    });

    // Register authentication method
    ctx.register.auth.apiKey({
      id: 'my-plugin-apikey',
      label: 'My Plugin API Key',
      configField: 'apiKey',
    });

    globalCtx.logger.info('My Plugin config and auth registered');
  },

  /**
   * Validate authentication credentials
   */
  async onValidateAuth(ctx) {
    ctx.logger.info('Validating My Plugin credentials');

    const apiKey = ctx.config.get<string>('apiKey');
    if (!apiKey) {
      throw new Error('API Key is required');
    }

    // Test API connection
    const response = await fetch('https://api.myservice.com/validate', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      throw new Error('Invalid API key');
    }

    ctx.logger.info('Credentials validated successfully');
    return true;
  },

  /**
   * Org runtime initialization - start MCP server
   */
  async onStart(ctx) {
    ctx.logger.info('Starting My Plugin for org', { orgId: ctx.org.id });

    const apiKey = ctx.config.getOptional<string>('apiKey');
    if (!apiKey) {
      ctx.logger.info('Credentials not configured - MCP tools not available');
      return;
    }

    // Connect to external MCP server
    await ctx.mcp.startExternal({
      id: 'my-plugin-mcp',
      url: 'https://mcp.myservice.com',
      authHeaders: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    ctx.logger.info('My Plugin MCP server connected');
  },

  /**
   * Config update handler
   */
  async onConfigUpdate(ctx) {
    ctx.logger.info('My Plugin config updated');
  },

  /**
   * Disable handler
   */
  async onDisable(ctx) {
    ctx.logger.info('My Plugin disabled for org', { orgId: ctx.org.id });
  },

  /**
   * Enable handler
   */
  async onEnable(ctx) {
    ctx.logger.info('My Plugin enabled');
  },
}));
```

### 5. Build and Test

```bash
# Navigate to plugin directory
cd plugins/core/my-plugin

# Install dependencies
npm install

# Build
npm run build

# Verify output is ES modules (should see import/export, not require/exports)
head -20 dist/index.js
```

---

## Plugin Architecture

### SDK Factory Pattern

Plugins use `defineHayPlugin()` factory function:

```typescript
export default defineHayPlugin((globalCtx) => ({
  name: 'Plugin Name',
  onInitialize(ctx) { /* ... */ },
  onValidateAuth(ctx) { /* ... */ },
  onStart(ctx) { /* ... */ },
  onConfigUpdate(ctx) { /* ... */ },
  onDisable(ctx) { /* ... */ },
  onEnable(ctx) { /* ... */ },
}));
```

**Two Contexts:**
- `globalCtx`: Global logger, shared across all orgs
- `ctx`: Per-hook context with org-specific data, config, auth, logger

---

## SDK Lifecycle

### 1. `onInitialize(ctx)` - Global Setup

**When:** Called once when plugin is loaded by the platform
**Context:** Global context (no org context)
**Purpose:** Register configuration schema and authentication methods

```typescript
onInitialize(ctx) {
  // Register config fields
  ctx.register.config({
    fieldName: {
      type: 'string' | 'number' | 'boolean',
      label: 'User-facing label',
      description: 'Field description',
      required: true | false,
      encrypted: true | false,
      env: 'ENV_VAR_NAME',  // Optional: load from env
    },
  });

  // Register auth method
  ctx.register.auth.apiKey({ /* ... */ });
  // OR
  ctx.register.auth.oauth2({ /* ... */ });
}
```

### 2. `onValidateAuth(ctx)` - Credential Validation

**When:** Called when user configures/updates authentication
**Context:** Org context with config and auth
**Purpose:** Validate credentials by testing API connection

```typescript
async onValidateAuth(ctx) {
  const apiKey = ctx.config.get<string>('apiKey');

  // Test actual API connection
  const response = await fetch('https://api.service.com/validate', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error('Invalid credentials');
  }

  return true;
}
```

### 3. `onStart(ctx)` - Org Runtime Initialization

**When:** Called for each organization when plugin starts
**Context:** Org context with config, auth, MCP capabilities
**Purpose:** Start MCP server (local or external)

```typescript
async onStart(ctx) {
  const apiKey = ctx.config.getOptional<string>('apiKey');
  if (!apiKey) {
    ctx.logger.info('Credentials not configured - skipping MCP startup');
    return;
  }

  // Option A: External MCP server
  await ctx.mcp.startExternal({
    id: 'my-mcp',
    url: 'https://mcp.service.com',
    authHeaders: { 'Authorization': `Bearer ${apiKey}` },
  });

  // Option B: Local MCP server (see Local MCP section)
  await ctx.mcp.startLocal('my-mcp', async (mcpCtx) => {
    const server = new MyMcpServer({ apiKey, logger: mcpCtx.logger });
    await server.start();
    return server;
  });
}
```

### 4. `onConfigUpdate(ctx)` - Config Change Handler

**When:** Called when organization updates plugin configuration
**Context:** Org context with updated config
**Purpose:** Handle config changes (usually requires restart)

```typescript
async onConfigUpdate(ctx) {
  ctx.logger.info('Config updated - changes take effect on restart');
}
```

### 5. `onDisable(ctx)` - Cleanup on Disable

**When:** Called when plugin is disabled for an organization
**Context:** Org context
**Purpose:** Cleanup (MCP servers stopped automatically)

```typescript
async onDisable(ctx) {
  ctx.logger.info('Plugin disabled for org', { orgId: ctx.org.id });
  // MCP servers are stopped automatically
}
```

### 6. `onEnable(ctx)` - Enable Handler

**When:** Called when plugin is enabled (globally)
**Context:** Global context
**Purpose:** Log enable event (plugin restarted per org automatically)

```typescript
async onEnable(ctx) {
  ctx.logger.info('Plugin enabled');
  // onStart will be called for each org automatically
}
```

---

## Configuration

### Defining Config Fields

```typescript
ctx.register.config({
  // String field
  apiKey: {
    type: 'string',
    label: 'API Key',
    description: 'Your service API key',
    required: true,
    encrypted: true,           // Store encrypted in database
    env: 'MY_SERVICE_API_KEY', // Load from environment variable
  },

  // URL field
  baseUrl: {
    type: 'string',
    label: 'Base URL',
    description: 'Service base URL (e.g., https://mystore.com)',
    required: true,
    encrypted: false,
  },

  // Optional field
  username: {
    type: 'string',
    label: 'Username (Optional)',
    description: 'Username for authentication',
    required: false,
    encrypted: false,
  },
});
```

### Reading Config Values

```typescript
// Required field (throws if not set)
const apiKey = ctx.config.get<string>('apiKey');

// Optional field (returns undefined if not set)
const username = ctx.config.getOptional<string>('username');

// With default value
const timeout = ctx.config.getOptional<number>('timeout') || 5000;

// Field reference for OAuth
ctx.register.auth.oauth2({
  clientId: ctx.config.field('clientId'),
  clientSecret: ctx.config.field('clientSecret'),
});
```

---

## Authentication Patterns

### 1. API Key Authentication

**Use case:** Service uses a single API key for authentication

```typescript
onInitialize(ctx) {
  ctx.register.config({
    apiKey: {
      type: 'string',
      label: 'API Key',
      description: 'Service API key',
      required: true,
      encrypted: true,
    },
  });

  ctx.register.auth.apiKey({
    id: 'my-service-apikey',
    label: 'My Service API Key',
    configField: 'apiKey',
  });
}

async onValidateAuth(ctx) {
  const apiKey = ctx.config.get<string>('apiKey');

  // Validate format
  if (!apiKey.startsWith('sk_')) {
    throw new Error('Invalid API key format');
  }

  // Test API
  const response = await fetch('https://api.service.com/validate', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error('Invalid API key');
  }

  return true;
}
```

**Examples:** Stripe, OpenAI, WooCommerce (consumer key/secret)

### 2. OAuth2 Authentication

**Use case:** Service uses OAuth2 with access tokens

```typescript
onInitialize(ctx) {
  ctx.register.config({
    clientId: {
      type: 'string',
      label: 'OAuth Client ID',
      description: 'OAuth client ID from service',
      required: true,
      encrypted: false,
      env: 'MY_SERVICE_CLIENT_ID',
    },
    clientSecret: {
      type: 'string',
      label: 'OAuth Client Secret',
      description: 'OAuth client secret from service',
      required: true,
      encrypted: true,
      env: 'MY_SERVICE_CLIENT_SECRET',
    },
  });

  ctx.register.auth.oauth2({
    id: 'my-service-oauth',
    label: 'My Service OAuth',
    authorizationUrl: 'https://service.com/oauth/authorize',
    tokenUrl: 'https://service.com/oauth/token',
    scopes: ['read', 'write'],
    clientId: ctx.config.field('clientId'),
    clientSecret: ctx.config.field('clientSecret'),
  });
}

async onValidateAuth(ctx) {
  const authState = ctx.auth.get();
  if (!authState) {
    throw new Error('No authentication configured');
  }

  // OAuth validation - check if access token exists
  if (authState.credentials.accessToken) {
    ctx.logger.info('OAuth access token present');
  } else {
    ctx.logger.info('OAuth flow required to get access token');
  }

  return true;
}

async onStart(ctx) {
  const authState = ctx.auth.get();
  if (!authState?.credentials.accessToken) {
    ctx.logger.warn('No access token - MCP connection may fail');
    return;
  }

  await ctx.mcp.startExternal({
    id: 'my-mcp',
    url: 'https://mcp.service.com',
    authHeaders: {
      'Authorization': `Bearer ${authState.credentials.accessToken}`,
    },
  });
}
```

**Examples:** HubSpot, Zendesk, Shopify

### 3. Multiple Credentials (WooCommerce Pattern)

**Use case:** Service requires multiple API credentials

```typescript
onInitialize(ctx) {
  ctx.register.config({
    siteUrl: {
      type: 'string',
      label: 'Site URL',
      description: 'Your site URL (e.g., https://mystore.com)',
      required: true,
      encrypted: false,
    },
    consumerKey: {
      type: 'string',
      label: 'Consumer Key',
      description: 'REST API Consumer Key',
      required: true,
      encrypted: true,
    },
    consumerSecret: {
      type: 'string',
      label: 'Consumer Secret',
      description: 'REST API Consumer Secret',
      required: true,
      encrypted: true,
    },
  });

  // Use primary credential for auth registration
  ctx.register.auth.apiKey({
    id: 'my-service-apikey',
    label: 'My Service API',
    configField: 'consumerKey',
  });
}

async onValidateAuth(ctx) {
  const siteUrl = ctx.config.get<string>('siteUrl');
  const consumerKey = ctx.config.get<string>('consumerKey');
  const consumerSecret = ctx.config.get<string>('consumerSecret');

  // Validate URL format
  try {
    new URL(siteUrl);
  } catch {
    throw new Error('Invalid URL format');
  }

  // Test API with all credentials
  const testUrl = `${siteUrl}/api/validate?key=${consumerKey}&secret=${consumerSecret}`;
  const response = await fetch(testUrl);

  if (!response.ok) {
    throw new Error('Invalid credentials');
  }

  return true;
}
```

**Examples:** WooCommerce, Magento

---

## MCP Integration

### External MCP Server (Recommended)

Connect to a remote MCP server hosted by the service:

```typescript
async onStart(ctx) {
  const apiKey = ctx.config.get<string>('apiKey');

  await ctx.mcp.startExternal({
    id: 'my-mcp',                     // Unique MCP server ID
    url: 'https://mcp.service.com',   // MCP server URL
    authHeaders: {                     // Authentication headers
      'Authorization': `Bearer ${apiKey}`,
    },
  });
}
```

**Examples:** Stripe, HubSpot, Zendesk

### Local MCP Server (Child Process)

Run MCP server as a child process managed by the plugin:

#### Step 1: Create MCP Server Wrapper

```typescript
// src/my-plugin-mcp-server.ts
import { spawn, ChildProcess } from 'child_process';
import { HayLogger } from '@hay/plugin-sdk';

export interface MyMcpServerConfig {
  apiKey: string;
  baseUrl: string;
  logger: HayLogger;
}

export class MyMcpServer {
  name = 'my-service';
  version = '1.0.0';
  private process: ChildProcess | null = null;
  private config: MyMcpServerConfig;

  constructor(config: MyMcpServerConfig) {
    this.config = config;
  }

  /**
   * Start MCP server child process
   */
  async start(): Promise<void> {
    this.config.logger.info('Starting MCP server child process');

    this.process = spawn('node', ['index.js'], {
      cwd: './mcp',  // MCP server directory
      env: {
        ...process.env,
        API_KEY: this.config.apiKey,
        BASE_URL: this.config.baseUrl,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Handle stdout
    this.process.stdout?.on('data', (data) => {
      this.config.logger.debug('MCP stdout:', data.toString());
    });

    // Handle stderr
    this.process.stderr?.on('data', (data) => {
      this.config.logger.error('MCP stderr:', data.toString());
    });

    // Handle process exit
    this.process.on('exit', (code) => {
      this.config.logger.info(`MCP process exited with code ${code}`);
    });

    this.config.logger.info('MCP server started successfully');
  }

  /**
   * Stop MCP server child process
   */
  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    this.config.logger.info('Stopping MCP server');

    return new Promise((resolve) => {
      this.process!.kill('SIGTERM');

      // Force kill after 5 seconds
      const forceKillTimer = setTimeout(() => {
        this.process!.kill('SIGKILL');
        resolve();
      }, 5000);

      this.process!.on('exit', () => {
        clearTimeout(forceKillTimer);
        this.process = null;
        resolve();
      });
    });
  }
}
```

#### Step 2: Use in Plugin

```typescript
// src/index.ts
import { defineHayPlugin } from '@hay/plugin-sdk';
import { MyMcpServer } from './my-plugin-mcp-server.js';

export default defineHayPlugin((globalCtx) => ({
  name: 'My Plugin',

  async onStart(ctx) {
    const apiKey = ctx.config.get<string>('apiKey');
    const baseUrl = ctx.config.get<string>('baseUrl');

    // Start local MCP server
    await ctx.mcp.startLocal('my-mcp', async (mcpCtx) => {
      const server = new MyMcpServer({
        apiKey,
        baseUrl,
        logger: mcpCtx.logger,
      });

      await server.start();
      return server;
    });

    ctx.logger.info('Local MCP server started');
  },
}));
```

**Examples:** Email, WooCommerce, Magento

### In-Process MCP Server (Simple)

Implement MCP server directly in plugin code (no child process):

```typescript
async onStart(ctx) {
  await ctx.mcp.startLocal('my-mcp', async (mcpCtx) => {
    const mcpServer = {
      name: 'my-service',
      version: '1.0.0',

      async listTools() {
        return [
          {
            name: 'my-tool',
            description: 'Tool description',
            input_schema: {
              type: 'object',
              properties: {
                param: { type: 'string', description: 'Parameter' },
              },
              required: ['param'],
            },
          },
        ];
      },

      async callTool(toolName: string, args: any) {
        if (toolName === 'my-tool') {
          // Implement tool logic
          return { result: 'Success' };
        }
        throw new Error(`Unknown tool: ${toolName}`);
      },

      async stop() {
        mcpCtx.logger.info('Stopping MCP server');
      },
    };

    return mcpServer;
  });
}
```

**Examples:** Email plugin

---

## Development Setup

### 1. Install Dependencies

```bash
cd plugins/core/my-plugin
npm install
```

### 2. Build Plugin

```bash
npm run build
```

### 3. Verify ES Module Output

```bash
# Should show import/export, NOT require/exports
head -20 dist/index.js
```

**Correct output (ES modules):**
```javascript
import { defineHayPlugin } from '@hay/plugin-sdk';
import { MyMcpServer } from './my-mcp-server.js';

export default defineHayPlugin((globalCtx) => ({
  name: 'My Plugin',
  // ...
}));
```

**Incorrect output (CommonJS):**
```javascript
const plugin_sdk_v2_1 = require("@hay/plugin-sdk");
exports.default = (0, plugin_sdk_v2_1.defineHayPlugin)((globalCtx) => ({
  // ...
}));
```

If you see `require`/`exports`, check:
- `package.json` has `"type": "module"`
- `tsconfig.json` has `"module": "ES2020"` (not `"CommonJS"`)

### 4. Test Plugin

Plugins are automatically loaded when the platform starts. Monitor logs:

```bash
# Terminal 1: Run server
cd /path/to/hay-core
npm run dev

# Monitor logs for plugin initialization
# Look for: "Initializing My Plugin"
# Look for: "Starting My Plugin for org"
```

---

## Common Patterns

### Pattern 1: Skip MCP if Not Configured

```typescript
async onStart(ctx) {
  const apiKey = ctx.config.getOptional<string>('apiKey');

  if (!apiKey) {
    ctx.logger.info(
      'Credentials not configured - plugin enabled but MCP tools not available. ' +
      'Please configure credentials in plugin settings.'
    );
    return;
  }

  // Start MCP server...
}
```

### Pattern 2: Validate Before Starting MCP

```typescript
async onStart(ctx) {
  const apiKey = ctx.config.get<string>('apiKey');
  const baseUrl = ctx.config.get<string>('baseUrl');

  // Validate URL format
  try {
    new URL(baseUrl);
  } catch {
    throw new Error('Invalid base URL format');
  }

  // Start MCP server...
}
```

### Pattern 3: Environment Variable Loading

```typescript
onInitialize(ctx) {
  ctx.register.config({
    clientId: {
      type: 'string',
      label: 'Client ID',
      required: true,
      encrypted: false,
      env: 'MY_SERVICE_CLIENT_ID',  // Load from env if available
    },
  });
}
```

### Pattern 4: Graceful Error Handling

```typescript
async onValidateAuth(ctx) {
  try {
    const response = await fetch('https://api.service.com/validate', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      ctx.logger.error('API validation failed', { status: response.status, error: errorText });

      if (response.status === 401) {
        throw new Error('Invalid credentials - please check your API key');
      } else if (response.status === 404) {
        throw new Error('API endpoint not found - please verify service URL');
      } else {
        throw new Error(`API request failed with status ${response.status}`);
      }
    }

    return true;
  } catch (error: any) {
    ctx.logger.error('Validation error', { error: error.message });

    // Re-throw validation errors
    if (error.message.includes('credentials') || error.message.includes('API')) {
      throw error;
    }

    // Network errors
    throw new Error(`Failed to connect: ${error.message}`);
  }
}
```

---

## Troubleshooting

### Error: "No 'exports' main defined in package.json"

**Cause:** `@hay/plugin-sdk` not found in node_modules

**Fix:**
```bash
# In plugin directory
npm install

# In root directory (if SDK needs updating)
npm install ./plugin-sdk
```

### Error: "exports is not defined in ES module scope"

**Cause:** TypeScript compiling to CommonJS while package.json declares ES module

**Fix:**
1. Check `package.json` has `"type": "module"`
2. Check `tsconfig.json` has `"module": "ES2020"` (not `"CommonJS"`)
3. Rebuild: `npm run build`
4. Verify output: `head -20 dist/index.js` (should see `import`/`export`)

### Error: "Cannot find module 'child_process'"

**Cause:** Missing Node.js type definitions

**Fix:**
```bash
npm install --save-dev @types/node
```

### Plugin Not Loading

**Check:**
1. Plugin built successfully (`dist/` directory exists)
2. `package.json` has correct `hay-plugin` metadata
3. Server logs show initialization: `"Initializing My Plugin"`
4. No TypeScript compilation errors

### MCP Server Not Starting

**Check:**
1. Credentials configured in plugin settings
2. `onValidateAuth` passed successfully
3. `onStart` logs show MCP startup
4. For local MCP: Check `mcp/` directory exists with server code
5. For external MCP: Check URL is correct and accessible

### Child Process Crashes

**Debug:**
```typescript
this.process.stderr?.on('data', (data) => {
  this.config.logger.error('MCP stderr:', data.toString());
});

this.process.on('exit', (code, signal) => {
  this.config.logger.error('MCP process exited', { code, signal });
});
```

---

## Examples by Use Case

### External MCP Server with API Key
- **Stripe** (`/plugins/core/stripe/src/index.ts`)
- Single API key, external MCP at `https://mcp.stripe.com`

### External MCP Server with OAuth2
- **HubSpot** (`/plugins/core/hubspot/src/index.ts`)
- OAuth2 with multiple scopes, external MCP at `https://mcp.hubspot.com`

### Local MCP Server (Child Process) with API Key
- **WooCommerce** (`/plugins/core/woocommerce/src/index.ts`)
- Multiple credentials, local MCP server as child process
- **Magento** (`/plugins/core/magento/src/index.ts`)
- API token + base URL, external MCP cloned and run locally

### In-Process MCP Server
- **Email** (`/plugins/core/email/src/index.ts`)
- Simple in-process MCP with tool implementations

---

## Best Practices

1. **Always validate credentials in `onValidateAuth`** with actual API test
2. **Use `getOptional()` in `onStart`** and gracefully skip MCP if not configured
3. **Log extensively** using `ctx.logger` for debugging
4. **Handle errors gracefully** with user-friendly error messages
5. **Use encrypted: true** for sensitive fields (API keys, secrets, passwords)
6. **Test ES module output** after build (`head dist/index.js`)
7. **Document your plugin** with clear README and JSDoc comments
8. **Follow existing patterns** - check similar plugins before implementing new patterns
9. **Use TypeScript types** from SDK for better IDE support
10. **Gracefully stop child processes** with SIGTERM followed by SIGKILL timeout

---

## Additional Resources

- **SDK Documentation:** `/plugin-sdk/README.md`
- **Plugin API Reference:** `/docs/PLUGIN_API.md`
- **Plugin Quick Reference:** `/docs/PLUGIN_QUICK_REFERENCE.md`
- **Migration Progress:** `/PLUGIN_SDK_MIGRATION_PROGRESS.md`
- **Example Plugins:** `/plugins/core/` (email, stripe, hubspot, woocommerce, magento)

---

## Getting Help

If you encounter issues:
1. Check this guide's troubleshooting section
2. Review example plugins in `/plugins/core/`
3. Check server logs for error details
4. Verify package.json and tsconfig.json match this guide's templates
5. Test with a minimal plugin first before adding complexity
