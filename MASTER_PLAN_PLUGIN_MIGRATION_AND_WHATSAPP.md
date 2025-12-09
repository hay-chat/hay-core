# Master Plan: Plugin Migration & WhatsApp Implementation

## Executive Summary

This document outlines the complete plan for:

1. **Migrating all plugins to TypeScript-first architecture** - Remove manifest.json dependency, improve security
2. **Implementing WhatsApp Business Cloud API integration** - First channel plugin with full capabilities
3. **Security hardening** - Fix critical environment variable exposure issues

**Current Status**:

- ✅ Phase 1-5 Complete: SDK created, infrastructure validated
- 🔄 Phase 6 In Progress: MCP support and OAuth implementation
- 🔲 Phase 7-9 Pending: Plugin migration, WhatsApp, documentation

**Timeline**: 4-6 weeks total

- Weeks 1-2: Security + MCP Support + OAuth
- Weeks 3-4: Plugin Migration (7 core plugins)
- Weeks 5-6: WhatsApp Implementation + Documentation

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Phase 1-5: Foundation (COMPLETE)](#phase-1-5-foundation-complete)
3. [Phase 6: Security & MCP Support (IN PROGRESS)](#phase-6-security--mcp-support-in-progress)
4. [Phase 7: Plugin Migration (PENDING)](#phase-7-plugin-migration-pending)
5. [Phase 8: WhatsApp Implementation (PENDING)](#phase-8-whatsapp-implementation-pending)
6. [Phase 9: Documentation (PENDING)](#phase-9-documentation-pending)
7. [Testing Strategy](#testing-strategy)
8. [Risk Management](#risk-management)

---

## Architecture Overview

### Key Architectural Decisions

**TypeScript-First Approach**

- No more `manifest.json` files - all configuration in TypeScript
- Plugin metadata defined in plugin class constructor
- Better type safety, IDE support, and refactoring capabilities

**Process Isolation**

- Each organization + plugin combination runs in separate Node.js process
- Prevents cross-organization data leaks
- Enables per-plugin resource limits and monitoring

**HTTP Communication**

- Plugin workers run Express servers
- Main app communicates via HTTP (Plugin SDK)
- Enables language-agnostic plugin development in future

**Security Model**

- JWT tokens with capability-based access control
- Environment variable allowlisting (no spreading `process.env`)
- Encrypted configuration in database
- Organization-scoped data access

### Communication Flow

```
External Request (e.g., WhatsApp webhook)
  ↓
Main App Express: /v1/plugins/{pluginId}/*
  ↓
Route Proxy (extracts organizationId, starts worker if needed)
  ↓
HTTP → Plugin Worker (localhost:5000-6000)
  ↓
Plugin: HayPlugin.registerRoute() handler
  ↓
Plugin SDK: this.sdk.messages.receive()
  ↓
HTTP → Main App: /v1/plugin-api/messages/receive
  ↓
tRPC Plugin API (JWT auth + capability check)
  ↓
Business Logic: Create customer, conversation, message
```

### Technology Stack

- **Plugin SDK**: TypeScript, Express.js, Fetch API
- **Main App**: Node.js, Express, tRPC, TypeORM, PostgreSQL
- **Authentication**: JWT (jsonwebtoken)
- **MCP**: Model Context Protocol for AI tool integration
- **OAuth**: Standard OAuth 2.0 with PKCE support

---

## Phase 1-5: Foundation (COMPLETE)

These phases are complete and documented in [PLUGIN_ARCHITECTURE_PROGRESS.md](PLUGIN_ARCHITECTURE_PROGRESS.md).

### What Was Built

✅ **Phase 1**: Plugin SDK Package

- `HayPlugin` base class with Express server, lifecycle hooks
- `PluginSDK` HTTP client for communicating with main app
- `startPluginWorker()` process lifecycle management
- Comprehensive TypeScript types

✅ **Phase 2**: Main App Infrastructure

- Worker spawning and management in Plugin Manager
- JWT authentication middleware for Plugin API
- Plugin API tRPC router with endpoints for messages, customers, sources
- Route proxy for webhook forwarding
- Worker cleanup scheduler

✅ **Phase 3**: Database Changes

- Added `channelAgents` to organization settings
- Migration for channel-specific agent assignment
- Helper function for agent selection priority

✅ **Phase 4**: Bug Fixes

- Fixed TypeScript compilation errors
- Fixed context types in middleware
- Fixed return statements in proxy

✅ **Phase 5**: Infrastructure Validation

- Created `simple-http-test` plugin
- Validated worker startup, routing, health checks
- Confirmed process isolation ready
- All tests passed successfully

### Key Files

| File                                        | Purpose                       |
| ------------------------------------------- | ----------------------------- |
| `packages/plugin-sdk/src/HayPlugin.ts`      | Base class for all plugins    |
| `packages/plugin-sdk/src/PluginSDK.ts`      | HTTP client for Plugin API    |
| `server/services/plugin-manager.service.ts` | Worker lifecycle management   |
| `server/routes/v1/plugin-api/index.ts`      | REST endpoints for Plugin API |
| `server/routes/v1/plugins/proxy.ts`         | Route proxy for webhooks      |
| `server/trpc/middleware/plugin-auth.ts`     | JWT authentication            |

---

## Phase 6: Security & MCP Support (IN PROGRESS)

**Status**: Partially complete - MCP registration implemented, OAuth in testing

**Goal**: Harden security and enable MCP plugin migration

### 6.1: Critical Security Hardening (URGENT)

**Problem**: Plugins currently receive ALL environment variables via `...process.env`, exposing sensitive credentials.

**Risk**: Malicious plugins can steal:

- `OPENAI_API_KEY` - Abuse AI API
- `DB_PASSWORD` - Direct database access
- `JWT_SECRET` - Forge authentication tokens
- `STRIPE_SECRET_KEY` - Payment fraud
- `PLUGIN_ENCRYPTION_KEY` - Decrypt all configs

**Solution**: Explicit allowlist-based environment passing

#### Task 6.1.1: Create `buildSafeEnv()` Method

**File**: `server/services/plugin-manager.service.ts`

```typescript
/**
 * Build safe environment for plugin worker
 * SECURITY: Never spread process.env - explicit allowlist only
 */
private buildSafeEnv(params: {
  organizationId: string;
  pluginId: string;
  port?: number;
  apiToken?: string;
  pluginConfig: Record<string, string>;
  capabilities: string[];
}): Record<string, string> {
  const { organizationId, pluginId, port, apiToken, pluginConfig, capabilities } = params;

  // Explicit allowlist - only safe variables
  const safeEnv: Record<string, string> = {
    // Node.js runtime essentials
    NODE_ENV: process.env.NODE_ENV || 'production',
    PATH: process.env.PATH || '',

    // Plugin context
    ORGANIZATION_ID: organizationId,
    PLUGIN_ID: pluginId,
    HAY_CAPABILITIES: capabilities.join(','),
  };

  // Capability-based access
  if (capabilities.includes('routes') || capabilities.includes('messages')) {
    safeEnv.HAY_API_URL = process.env.API_URL || 'http://localhost:3001';
    if (apiToken) safeEnv.HAY_API_TOKEN = apiToken;
  }

  if (port && capabilities.includes('routes')) {
    safeEnv.HAY_WORKER_PORT = port.toString();
  }

  // Plugin-specific config (already scoped by org)
  Object.assign(safeEnv, pluginConfig);

  // NEVER include:
  // - OPENAI_API_KEY, DB_*, JWT_SECRET, STRIPE_SECRET_KEY
  // - SMTP_AUTH_PASS, PLUGIN_ENCRYPTION_KEY
  // - Any OAuth client secrets, Redis credentials

  return safeEnv;
}
```

**Priority**: URGENT - Must be implemented before any plugins go to production

#### Task 6.1.2: Update Plugin Worker Spawning

Replace dangerous `...process.env` spreading:

**Files to update**:

- `server/services/plugin-manager.service.ts:643` - `startPluginWorker()`
- `server/services/plugin-manager.service.ts:353` - `installPlugin()`
- `server/services/plugin-manager.service.ts:393` - `buildPlugin()`

**Change**:

```typescript
// OLD (DANGEROUS):
const env = {
  ...process.env,  // ❌ Exposes all secrets
  HAY_API_URL: ...,
};

// NEW (SAFE):
const env = this.buildSafeEnv({
  organizationId,
  pluginId,
  port,
  apiToken,
  pluginConfig: this.configToEnvVars(instance.config || {}, manifest.configSchema),
  capabilities,
});
```

#### Task 6.1.3: Security Testing

Create `server/tests/services/plugin-manager-security.test.ts`:

```typescript
describe('Plugin Manager Security', () => {
  it('should not expose OPENAI_API_KEY to plugins', () => {
    const env = pluginManager.buildSafeEnv({...});
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it('should not expose DB_PASSWORD to plugins', () => {
    const env = pluginManager.buildSafeEnv({...});
    expect(env.DB_PASSWORD).toBeUndefined();
  });

  it('should not expose JWT_SECRET to plugins', () => {
    const env = pluginManager.buildSafeEnv({...});
    expect(env.JWT_SECRET).toBeUndefined();
  });

  it('should only expose HAY_API_TOKEN if plugin has routes capability', () => {
    const envWithRoutes = pluginManager.buildSafeEnv({ capabilities: ['routes'] });
    expect(envWithRoutes.HAY_API_TOKEN).toBeDefined();

    const envWithoutRoutes = pluginManager.buildSafeEnv({ capabilities: [] });
    expect(envWithoutRoutes.HAY_API_TOKEN).toBeUndefined();
  });
});
```

### 6.2: MCP Support Implementation

**Status**: ✅ REST endpoints implemented, currently in testing

#### What Was Implemented

✅ **MCP Registration Endpoints**

- `POST /v1/plugin-api/mcp/register-local` - Register local MCP server
- `POST /v1/plugin-api/mcp/register-remote` - Register remote MCP server
- Both endpoints save config to `plugin_instances.config.mcpServers`
- Tools registered in MCP registry service

✅ **Plugin SDK Updates**

- Added `sdk.mcp.registerLocalMCP()` method
- Added `sdk.mcp.registerRemoteMCP()` method
- Methods use REST API (not tRPC)

✅ **HayPlugin Base Class Updates**

- Automatically calls `registerMCP()` during initialization
- Initializes `MCPServerManager` for MCP-only plugins
- Skips HTTP server startup for MCP-only plugins

✅ **OAuth Support**

- Generic `PluginOAuthConnection.vue` component
- TypeScript-first OAuth detection via `manifest.ui.auth === "oauth2"`
- JWT tokens with `issuer` and `audience` claims
- OAuth config saved to database during MCP registration

#### MCP Registration Flow

```typescript
// In plugin worker (e.g., HubSpot plugin)
export class HubSpotPlugin extends HayPlugin {
  constructor() {
    super({
      id: 'hay-plugin-hubspot',
      capabilities: ['mcp'],
    });
  }

  protected async registerMCP() {
    await this.sdk.mcp.registerRemoteMCP({
      url: 'https://mcp.hubspot.com',
      transport: 'http',
      auth: {
        type: 'oauth2',
        authorizationUrl: 'https://mcp.hubspot.com/oauth/authorize/user',
        tokenUrl: 'https://mcp.hubspot.com/oauth/v3/token',
        scopes: ['crm.objects.contacts.read', ...],
        clientIdEnvVar: 'HUBSPOT_CLIENT_ID',
        clientSecretEnvVar: 'HUBSPOT_CLIENT_SECRET',
      },
      tools: [...], // MCP tool definitions
    });
  }
}
```

#### Current Testing Status

**Working**:

- ✅ MCP registration endpoints receive requests
- ✅ OAuth config saved to database
- ✅ Tools registered in registry
- ✅ Plugin workers start and call `registerMCP()`
- ✅ JWT authentication works

**In Testing**:

- 🔄 OAuth flow end-to-end (button appears, redirect works)
- 🔄 Token refresh and expiration handling
- 🔄 Tool execution from AI agents

#### Next Steps for MCP

1. Complete OAuth flow testing with HubSpot
2. Test tool execution from AI agents
3. Implement MCP server health checks
4. Add MCP server restart logic on crashes
5. Clean up debug logging

### 6.3: MCP Registry Service

**Purpose**: Central registry for MCP tools across all plugin instances

**File**: `server/services/mcp-registry.service.ts`

**Key Methods**:

```typescript
export class MCPRegistryService {
  // Register tools from a plugin's MCP server
  async registerTools(
    organizationId: string,
    pluginId: string,
    serverId: string,
    tools: MCPToolDefinition[],
  ): Promise<void>;

  // Get all tools for an organization
  async getToolsForOrg(organizationId: string): Promise<MCPTool[]>;

  // Execute a tool (routes to appropriate MCP server)
  async executeTool(
    organizationId: string,
    toolName: string,
    args: Record<string, any>,
  ): Promise<any>;

  // Unregister tools (when plugin disabled)
  async unregisterTools(organizationId: string, pluginId: string): Promise<void>;
}
```

**Storage**: Uses `plugin_instances.config.mcpServers` JSONB field

### Success Criteria for Phase 6

- [ ] `buildSafeEnv()` implemented and tested
- [ ] No plugins can access sensitive environment variables
- [ ] Security tests pass
- [ ] MCP registration endpoints work correctly
- [ ] OAuth flow completes successfully
- [ ] MCP tools callable from AI agents
- [ ] HubSpot and Stripe OAuth tested end-to-end

---

## Phase 7: Plugin Migration (PENDING)

**Goal**: Migrate all 7 core plugins to TypeScript-first architecture

**Estimated Time**: 12-16 hours (2 hours per plugin)

### Plugins to Migrate

| Plugin        | Type | Complexity | OAuth | Status         |
| ------------- | ---- | ---------- | ----- | -------------- |
| Email         | MCP  | Simple     | No    | ✅ Migrated    |
| Attio         | MCP  | Simple     | No    | 🔲 Pending     |
| Judo-in-cloud | MCP  | Simple     | No    | 🔲 Pending     |
| Zendesk       | MCP  | Medium     | No    | 🔲 Pending     |
| Shopify       | MCP  | Medium     | No    | 🔲 Pending     |
| Stripe        | MCP  | High       | Yes   | 🔄 In Progress |
| HubSpot       | MCP  | High       | Yes   | 🔄 In Progress |

### Migration Process (Per Plugin)

#### Step 1: Create TypeScript Structure

```bash
cd plugins/core/{plugin-name}
mkdir -p src
npm install @hay/plugin-sdk
```

#### Step 2: Create Plugin Class

**File**: `src/index.ts`

```typescript
import { HayPlugin, startPluginWorker } from '@hay/plugin-sdk';
import * as tools from './tools.json'; // MCP tool definitions

export class PluginNamePlugin extends HayPlugin {
  constructor() {
    super({
      id: '{plugin-id}',
      name: '{Plugin Name}',
      version: '1.0.0',
      description: '{description}',
      author: 'Hay',
      category: 'integration', // or 'channel', 'utility'
      capabilities: ['mcp'], // Add 'routes', 'messages', 'customers' as needed
    });
  }

  async onInitialize() {
    this.log('Plugin initialized');
  }

  protected async registerMCP() {
    // For local MCP servers
    await this.sdk.mcp.registerLocalMCP({
      serverPath: './mcp',
      startCommand: 'node index.js',
      tools: tools as any,
    });

    // For remote MCP servers
    await this.sdk.mcp.registerRemoteMCP({
      url: 'https://mcp.example.com',
      transport: 'http',
      auth: { type: 'oauth2', ... },
      tools: tools as any,
    });
  }
}

if (require.main === module) {
  startPluginWorker(PluginNamePlugin);
}
```

#### Step 3: Configure Build

**File**: `package.json`

```json
{
  "name": "@hay/plugin-{name}",
  "version": "1.0.0",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@hay/plugin-sdk": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

**File**: `tsconfig.json`

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

#### Step 4: Build and Test

```bash
npm run build
npm start  # Should fail without env vars - expected

# Test via main app (after enabling plugin)
curl "http://localhost:3001/v1/plugins/{plugin-id}/health?organizationId={organizationId}"
```

#### Step 5: Delete Legacy Files

After confirming plugin works:

```bash
rm manifest.json
git add -A
git commit -m "Migrate {plugin-name} to TypeScript-first architecture"
```

### Special Considerations

#### OAuth Plugins (Stripe, HubSpot)

These plugins need OAuth configuration in `registerMCP()`:

```typescript
protected async registerMCP() {
  await this.sdk.mcp.registerRemoteMCP({
    url: 'https://mcp.stripe.com',
    transport: 'http',
    auth: {
      type: 'oauth2',
      authorizationUrl: 'https://mcp.stripe.com/oauth/authorize',
      tokenUrl: 'https://mcp.stripe.com/oauth/token',
      scopes: ['read_write'],
      clientIdEnvVar: 'STRIPE_CLIENT_ID',
      clientSecretEnvVar: 'STRIPE_CLIENT_SECRET',
      pkce: true,
    },
    tools: tools as any,
  });
}
```

**Manifest Update**:

```json
{
  "ui": {
    "auth": "oauth2",
    "settings": true
  },
  "settingsExtensions": [
    {
      "slot": "before-settings",
      "component": "@/components/plugins/PluginOAuthConnection.vue",
      "props": {
        "description": "Securely connect your {Service} account using OAuth"
      }
    }
  ]
}
```

#### MCP-Only Plugins

For plugins with only MCP capability (no HTTP routes):

- No HTTP server will start
- Worker stays alive to maintain MCP connection
- Health checks are skipped
- Relies on MCP server health

### Migration Order

**Phase 7A: Simple MCP Plugins** (Week 3)

1. Attio
2. Judo-in-cloud
3. Zendesk

**Phase 7B: Medium Complexity** (Week 3) 4. Shopify

**Phase 7C: OAuth Plugins** (Week 4) 5. Stripe (complete OAuth testing) 6. HubSpot (complete OAuth testing)

### Success Criteria for Phase 7

- [ ] All 7 core plugins migrated
- [ ] All plugins compile without errors
- [ ] All plugins start successfully
- [ ] All MCP tools still accessible
- [ ] OAuth flows work for Stripe and HubSpot
- [ ] No manifest.json files remain
- [ ] Zero breaking changes for existing functionality

---

## Phase 8: WhatsApp Implementation (PENDING)

**Goal**: Implement WhatsApp Business Cloud API as first full-featured channel plugin

**Estimated Time**: 16-20 hours

**Priority**: After Phase 7 complete

### 8.1: Plugin Structure

```
plugins/core/whatsapp/
├── src/
│   ├── index.ts              # Main plugin class
│   ├── types.ts              # WhatsApp API types
│   ├── whatsapp-client.ts    # WhatsApp API client
│   └── utils.ts              # Helper functions
├── package.json
├── tsconfig.json
└── README.md
```

### 8.2: WhatsApp Plugin Implementation

**File**: `plugins/core/whatsapp/src/index.ts`

```typescript
import { HayPlugin, startPluginWorker } from "@hay/plugin-sdk";
import { WhatsAppClient } from "./whatsapp-client";

export class WhatsAppPlugin extends HayPlugin {
  private whatsappClient?: WhatsAppClient;

  constructor() {
    super({
      id: "whatsapp",
      name: "WhatsApp Business",
      version: "1.0.0",
      description: "Connect WhatsApp Business Cloud API for customer messaging",
      author: "Hay",
      category: "channel",
      capabilities: ["routes", "messages", "customers", "sources"],
      config: {
        accessToken: {
          type: "string",
          label: "Access Token",
          description: "WhatsApp Business API Access Token",
          required: true,
          encrypted: true,
          envVar: "WHATSAPP_ACCESS_TOKEN",
        },
        phoneNumberId: {
          type: "string",
          label: "Phone Number ID",
          description: "WhatsApp Business Phone Number ID",
          required: true,
          envVar: "WHATSAPP_PHONE_NUMBER_ID",
        },
        webhookVerifyToken: {
          type: "string",
          label: "Webhook Verify Token",
          description: "Token for webhook verification",
          required: true,
          encrypted: true,
          envVar: "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
        },
        businessAccountId: {
          type: "string",
          label: "Business Account ID",
          description: "WhatsApp Business Account ID",
          required: true,
          envVar: "WHATSAPP_BUSINESS_ACCOUNT_ID",
        },
      },
    });
  }

  async onInitialize() {
    this.log("Initializing WhatsApp plugin...");

    // Initialize WhatsApp API client
    this.whatsappClient = new WhatsAppClient({
      accessToken: this.config.accessToken,
      phoneNumberId: this.config.phoneNumberId,
    });

    // Register as message source
    await this.sdk.registerSource({
      name: "WhatsApp",
      type: "whatsapp",
      capabilities: {
        sendText: true,
        sendImage: true,
        sendDocument: true,
        receiveText: true,
        receiveImage: true,
        receiveDocument: true,
      },
    });

    // Register webhook routes
    this.registerRoute("GET", "/webhook", this.handleWebhookVerification.bind(this));
    this.registerRoute("POST", "/webhook", this.handleIncomingMessage.bind(this));

    this.log("WhatsApp plugin initialized successfully");
  }

  /**
   * GET /webhook - Webhook verification
   * WhatsApp requires responding with challenge token
   */
  private async handleWebhookVerification(req: any, res: any) {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === this.config.webhookVerifyToken) {
      this.log("Webhook verified successfully");
      res.status(200).send(challenge);
    } else {
      this.logError("Webhook verification failed");
      res.sendStatus(403);
    }
  }

  /**
   * POST /webhook - Incoming messages
   * Handles messages from WhatsApp customers
   */
  private async handleIncomingMessage(req: any, res: any) {
    try {
      const body = req.body;

      // Acknowledge receipt immediately
      res.sendStatus(200);

      // Process webhook payload
      if (body.object !== "whatsapp_business_account") {
        this.log("Ignoring non-WhatsApp webhook");
        return;
      }

      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field !== "messages") continue;

          const value = change.value;
          const messages = value.messages || [];

          for (const message of messages) {
            await this.processIncomingMessage(message, value);
          }
        }
      }
    } catch (error) {
      this.logError("Error handling webhook", error);
    }
  }

  /**
   * Process a single incoming WhatsApp message
   */
  private async processIncomingMessage(message: any, metadata: any) {
    try {
      const phoneNumber = message.from; // WhatsApp phone number
      const messageType = message.type; // text, image, document, etc.

      // Extract message content based on type
      let text = "";
      let mediaUrl = "";

      if (messageType === "text") {
        text = message.text.body;
      } else if (messageType === "image") {
        text = message.image.caption || "[Image]";
        mediaUrl = await this.downloadMedia(message.image.id);
      } else if (messageType === "document") {
        text = message.document.caption || "[Document]";
        mediaUrl = await this.downloadMedia(message.document.id);
      }

      // Get or create customer
      const customerProfile = metadata.contacts?.find((c: any) => c.wa_id === phoneNumber);

      // Use Plugin SDK to handle message
      const result = await this.sdk.messages.receive({
        externalId: phoneNumber,
        channel: "whatsapp",
        text,
        mediaUrl,
        metadata: {
          messageId: message.id,
          timestamp: message.timestamp,
          type: messageType,
        },
        customer: {
          name: customerProfile?.profile?.name || phoneNumber,
          metadata: {
            whatsappProfile: customerProfile?.profile,
          },
        },
      });

      this.log(`Message received from ${phoneNumber}: "${text}"`);
    } catch (error) {
      this.logError("Error processing message", error);
    }
  }

  /**
   * Download media from WhatsApp
   */
  private async downloadMedia(mediaId: string): Promise<string> {
    // Implementation to download and upload to storage
    // Returns permanent URL
    return "";
  }
}

if (require.main === module) {
  startPluginWorker(WhatsAppPlugin);
}
```

### 8.3: WhatsApp API Client

**File**: `plugins/core/whatsapp/src/whatsapp-client.ts`

```typescript
export class WhatsAppClient {
  private baseUrl = "https://graph.facebook.com/v18.0";
  private accessToken: string;
  private phoneNumberId: string;

  constructor(config: { accessToken: string; phoneNumberId: string }) {
    this.accessToken = config.accessToken;
    this.phoneNumberId = config.phoneNumberId;
  }

  /**
   * Send text message with retry logic
   */
  async sendTextMessage(to: string, text: string): Promise<void> {
    const maxRetries = 3;
    const delays = [1000, 2000, 4000]; // Exponential backoff

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.makeRequest("POST", `/${this.phoneNumberId}/messages`, {
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: text },
        });
        return; // Success
      } catch (error) {
        if (attempt === maxRetries - 1) throw error;
        await this.delay(delays[attempt]);
      }
    }
  }

  /**
   * Send image message
   */
  async sendImageMessage(to: string, imageUrl: string, caption?: string): Promise<void> {
    await this.makeRequest("POST", `/${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: {
        link: imageUrl,
        caption,
      },
    });
  }

  /**
   * Make API request to WhatsApp
   */
  private async makeRequest(method: string, path: string, body?: any): Promise<any> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`WhatsApp API error: ${error}`);
    }

    return response.json();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

### 8.4: WhatsApp Embedded Signup

**Goal**: Allow users to connect WhatsApp without manual app creation

**File**: `dashboard/components/plugins/WhatsAppEmbeddedSignup.vue`

```vue
<template>
  <Card>
    <CardHeader>
      <CardTitle>Connect WhatsApp Business</CardTitle>
      <CardDescription>
        Use Facebook's Embedded Signup to connect your WhatsApp Business account
      </CardDescription>
    </CardHeader>
    <CardContent>
      <Button @click="startEmbeddedSignup">
        <Link2 class="mr-2 h-4 w-4" />
        Connect WhatsApp
      </Button>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
const startEmbeddedSignup = () => {
  // Load Facebook SDK
  window.FB.login(
    (response) => {
      if (response.authResponse) {
        // Exchange code for access token
        const code = response.authResponse.code;
        // Send to backend to complete setup
      }
    },
    {
      config_id: "YOUR_CONFIG_ID",
      response_type: "code",
      override_default_response_type: true,
      extras: {
        setup: {
          // ... embedded signup config
        },
      },
    },
  );
};
</script>
```

### 8.5: Database Schema Updates

**Migration**: `AddWhatsAppToSources.ts`

```typescript
export class AddWhatsAppToSources implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // WhatsApp is already a supported channel type
    // Just ensure sources table can handle it
    // No schema changes needed - handled by existing structure
  }
}
```

### 8.6: Testing Strategy

**Unit Tests**:

```bash
# Test WhatsApp client
npm test -- whatsapp-client.test.ts

# Test message parsing
npm test -- whatsapp-parser.test.ts
```

**Integration Tests**:

```bash
# Test webhook verification
curl "http://localhost:3001/v1/plugins/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=TEST&hub.challenge=12345" \
  -H "x-organization-id: {organizationId}"

# Test incoming message
curl -X POST "http://localhost:3001/v1/plugins/whatsapp/webhook" \
  -H "Content-Type: application/json" \
  -H "x-organization-id: {organizationId}" \
  -d @test-webhook-payload.json
```

**End-to-End Tests**:

1. Enable plugin in dashboard
2. Configure access token and phone number ID
3. Set webhook URL in WhatsApp Business dashboard
4. Send test message from WhatsApp
5. Verify message appears in conversation
6. Send reply from dashboard
7. Verify reply received on WhatsApp

### Success Criteria for Phase 8

- [ ] WhatsApp plugin compiles without errors
- [ ] Plugin worker starts successfully
- [ ] Webhook verification passes
- [ ] Incoming text messages create conversations
- [ ] Incoming media messages handled correctly
- [ ] Outgoing messages send successfully
- [ ] Retry logic works on API failures
- [ ] Customer profiles created/updated
- [ ] Channel-specific agent assignment works
- [ ] Embedded signup flow works
- [ ] Documentation complete

---

## Phase 9: Documentation (PENDING)

**Goal**: Update all documentation to reflect TypeScript-first architecture

**Estimated Time**: 8-12 hours

### 9.1: Core Documentation Updates

#### `docs/PLUGIN_API.md`

- Remove manifest.json references
- Add TypeScript-first approach section
- Document HayPlugin base class
- Document PluginSDK methods
- Add capability-based access section
- Add security best practices

#### `docs/PLUGIN_QUICK_REFERENCE.md`

- Replace all manifest.json examples with TypeScript
- Add quick start for channel plugins
- Add quick start for MCP plugins
- Add OAuth plugin examples
- Add common patterns (retry, error handling)

#### `docs/PLUGIN_MIGRATION_GUIDE.md` (NEW)

- Step-by-step migration from manifest.json
- Code examples for all plugin types
- Troubleshooting section
- Breaking changes list
- FAQ

### 9.2: Architecture Documentation

#### `docs/PLUGIN_ARCHITECTURE.md` (NEW)

- Process isolation explanation
- Communication flow diagrams
- Security model
- Worker lifecycle
- Port management
- JWT authentication

### 9.3: Plugin-Specific Documentation

#### `plugins/core/whatsapp/README.md`

- Setup instructions
- Webhook configuration
- Environment variables
- Testing guide
- Troubleshooting

#### Update all plugin READMEs

- Consistent format across all plugins
- Installation instructions
- Configuration options
- Usage examples

### 9.4: Update Project Documentation

#### `CLAUDE.md`

- Update plugin development guidelines
- Reference TypeScript-first approach
- Update examples
- Add security guidelines

#### `.claude/PLUGIN_GENERATION_WORKFLOW.md`

- Update for TypeScript generation
- Update templates
- Remove manifest.json generation

### 9.5: Create Example Plugins

#### `examples/simple-mcp-plugin/`

- Minimal MCP plugin
- Shows basic structure
- Commented code

#### `examples/simple-channel-plugin/`

- Minimal channel plugin with webhooks
- Shows message handling
- Commented code

### Success Criteria for Phase 9

- [ ] All docs updated
- [ ] No manifest.json references remain
- [ ] Migration guide complete
- [ ] Example plugins work
- [ ] Consistent formatting across docs
- [ ] All code examples tested

---

## Testing Strategy

### Security Testing

**Environment Variable Isolation**:

```bash
# Start plugin worker
# Inspect process environment
ps eww <PID>

# Should NOT see: OPENAI_API_KEY, DB_PASSWORD, JWT_SECRET
# Should see: HAY_API_URL, HAY_API_TOKEN (if has routes)
```

**Penetration Testing**:

- Attempt to access other organization's data
- Attempt to call endpoints without capability
- Attempt to forge JWT tokens
- Attempt SQL injection through plugin config

### Functional Testing

**Plugin Lifecycle**:

```typescript
describe("Plugin Lifecycle", () => {
  it("should start worker on first request", async () => {
    const response = await request(app)
      .get("/v1/plugins/whatsapp/health")
      .query({ organizationId: "test-org" });
    expect(response.status).toBe(200);
  });

  it("should reuse existing worker", async () => {
    // First request starts worker
    await request(app).get("/v1/plugins/whatsapp/health");
    // Second request reuses it
    const start = Date.now();
    await request(app).get("/v1/plugins/whatsapp/health");
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(100); // No startup delay
  });

  it("should cleanup idle workers", async () => {
    await request(app).get("/v1/plugins/whatsapp/health");
    await sleep(35 * 60 * 1000); // Wait 35 minutes
    // Worker should be stopped
  });
});
```

**MCP Integration**:

```typescript
describe("MCP Integration", () => {
  it("should register MCP tools", async () => {
    // Enable plugin
    const tools = await mcpRegistry.getToolsForOrg("org-id");
    expect(tools).toContainEqual(
      expect.objectContaining({
        name: "hubspot_get_contact",
      }),
    );
  });

  it("should execute MCP tools", async () => {
    const result = await mcpRegistry.executeTool("org-id", "hubspot_get_contact", {
      contactId: "123",
    });
    expect(result).toHaveProperty("email");
  });
});
```

**WhatsApp Integration**:

```typescript
describe("WhatsApp Plugin", () => {
  it("should verify webhook", async () => {
    const response = await request(app).get("/v1/plugins/whatsapp/webhook").query({
      "hub.mode": "subscribe",
      "hub.verify_token": "test-token",
      "hub.challenge": "12345",
    });
    expect(response.text).toBe("12345");
  });

  it("should create conversation from incoming message", async () => {
    await request(app).post("/v1/plugins/whatsapp/webhook").send(mockWhatsAppPayload);

    const conversation = await conversationRepository.findByCustomerPhone("+1234567890");
    expect(conversation).toBeDefined();
  });

  it("should send outgoing message", async () => {
    const spy = jest.spyOn(whatsappClient, "sendTextMessage");

    await sdk.messages.send({
      conversationId: "conv-id",
      text: "Hello",
    });

    expect(spy).toHaveBeenCalledWith("+1234567890", "Hello");
  });
});
```

### Performance Testing

**Load Testing**:

```bash
# Test 100 concurrent webhooks
ab -n 1000 -c 100 -p webhook-payload.json \
  http://localhost:3001/v1/plugins/whatsapp/webhook

# Measure:
# - Worker startup time
# - Message processing time
# - Memory usage per worker
# - CPU usage per worker
```

**Scalability Testing**:

- Test with 50 organizations simultaneously
- Test with 10 plugins per organization
- Verify port allocation doesn't conflict
- Verify workers don't interfere with each other

### Monitoring

**Metrics to Track**:

- Active worker count
- Worker memory usage
- Worker CPU usage
- Request latency per plugin
- Error rate per plugin
- Worker crash rate
- Worker restart count

**Logging**:

```typescript
logger.info("Worker started", {
  organizationId,
  pluginId,
  port,
  pid: worker.pid,
});

logger.error("Worker crashed", {
  organizationId,
  pluginId,
  exitCode: worker.exitCode,
  signal: worker.signalCode,
});
```

---

## Risk Management

### Technical Risks

| Risk                       | Impact   | Probability | Mitigation                             |
| -------------------------- | -------- | ----------- | -------------------------------------- |
| Environment variable leak  | Critical | Medium      | Implement `buildSafeEnv()` immediately |
| MCP server crashes         | High     | Medium      | Health checks, auto-restart            |
| OAuth token expiration     | Medium   | High        | Implement refresh flow                 |
| Plugin worker memory leaks | High     | Low         | Monitor memory, restart thresholds     |
| Port exhaustion            | High     | Low         | Implement cleanup, expand range        |
| Cross-org data access      | Critical | Low         | Process isolation, capability checks   |

### Migration Risks

| Risk                           | Impact | Probability | Mitigation                             |
| ------------------------------ | ------ | ----------- | -------------------------------------- |
| Breaking existing integrations | High   | Medium      | Migrate gradually, test each plugin    |
| OAuth flows break              | High   | Medium      | Test OAuth end-to-end before migration |
| Tool execution fails           | High   | Low         | Comprehensive MCP testing              |
| Performance regression         | Medium | Low         | Benchmark before/after                 |

### WhatsApp-Specific Risks

| Risk                   | Impact | Probability | Mitigation                           |
| ---------------------- | ------ | ----------- | ------------------------------------ |
| Webhook timeouts       | High   | Medium      | Async processing, quick ACK          |
| Rate limiting          | Medium | High        | Implement retry with backoff         |
| Media download fails   | Medium | Medium      | Fallback to media ID reference       |
| Message delivery fails | High   | Low         | Retry logic, delivery status webhook |

---

## Timeline & Milestones

### Week 1: Security & Foundation

- **Day 1-2**: Implement `buildSafeEnv()` and security tests
- **Day 3-4**: Complete MCP OAuth testing (HubSpot, Stripe)
- **Day 5**: Test MCP tool execution from AI agents

**Milestone**: Security hardened, OAuth working

### Week 2: MCP Completion

- **Day 1-2**: Clean up MCP debug logging
- **Day 3-4**: Implement MCP health checks and restart logic
- **Day 5**: Performance testing and optimization

**Milestone**: MCP support production-ready

### Week 3: Plugin Migration (Part 1)

- **Day 1**: Migrate Attio plugin
- **Day 2**: Migrate Judo-in-cloud plugin
- **Day 3**: Migrate Zendesk plugin
- **Day 4**: Migrate Shopify plugin
- **Day 5**: Testing and bug fixes

**Milestone**: Simple plugins migrated

### Week 4: Plugin Migration (Part 2)

- **Day 1-2**: Complete Stripe OAuth migration
- **Day 3-4**: Complete HubSpot OAuth migration
- **Day 5**: Final testing, remove all manifest.json files

**Milestone**: All plugins migrated, OAuth working

### Week 5: WhatsApp Implementation

- **Day 1**: Create plugin structure, implement client
- **Day 2**: Implement webhook handlers
- **Day 3**: Implement message sending with retry
- **Day 4**: Implement embedded signup UI
- **Day 5**: End-to-end testing

**Milestone**: WhatsApp plugin functional

### Week 6: Documentation & Polish

- **Day 1-2**: Update all core documentation
- **Day 3**: Create migration guide and examples
- **Day 4**: Final testing and bug fixes
- **Day 5**: Code review, security audit, deployment

**Milestone**: Production deployment ready

---

## Success Metrics

### Code Quality

- [ ] Zero TypeScript errors
- [ ] 90%+ test coverage for critical paths
- [ ] All linting rules pass
- [ ] Security audit passed

### Performance

- [ ] Worker startup < 2 seconds
- [ ] Message processing < 100ms
- [ ] Webhook response < 200ms
- [ ] Memory usage < 200MB per worker

### Reliability

- [ ] 99.9% uptime for plugin workers
- [ ] < 0.1% error rate
- [ ] Automatic recovery from crashes
- [ ] Zero data leaks between organizations

### Developer Experience

- [ ] Clear error messages
- [ ] Comprehensive documentation
- [ ] Working examples
- [ ] Migration guide complete

---

## Appendix

### Environment Variables Reference

**Core System** (NEVER exposed to plugins):

```bash
# OpenAI
OPENAI_API_KEY=sk-...

# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=secret
DB_NAME=hay

# Authentication
JWT_SECRET=your-secret
JWT_REFRESH_SECRET=your-refresh-secret

# Encryption
PLUGIN_ENCRYPTION_KEY=your-encryption-key

# Payment
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Email
SMTP_AUTH_PASS=password

# Redis
REDIS_PASSWORD=secret
```

**Safe for Plugins**:

```bash
# Runtime
NODE_ENV=production
PATH=/usr/bin:/bin

# Plugin context
ORGANIZATION_ID=org-123
PLUGIN_ID=whatsapp
HAY_CAPABILITIES=routes,messages

# Plugin SDK (capability-gated)
HAY_API_URL=http://localhost:3001
HAY_API_TOKEN=eyJ... (if has routes/messages)
HAY_WORKER_PORT=5001 (if has routes)

# Plugin-specific (from database)
WHATSAPP_ACCESS_TOKEN=... (encrypted)
WHATSAPP_PHONE_NUMBER_ID=...
```

### Port Allocation Strategy

**Range**: 5000-6000 (1000 ports)

**Allocation**:

1. Check database for existing port
2. If none, find available port in range
3. Verify port not in use (TCP connect)
4. Assign and save to database
5. Spawn worker on that port

**Cleanup**:

- Release port when worker stops
- Mark as available in database
- Reuse ports for new workers

### Useful Commands

**Build all plugins**:

```bash
./scripts/build-plugins.sh
```

**Test plugin locally**:

```bash
cd plugins/core/whatsapp
HAY_API_URL=http://localhost:3001 \
HAY_API_TOKEN=test-token \
HAY_WORKER_PORT=5001 \
npm start
```

**Check worker processes**:

```bash
ps aux | grep "node.*plugin"
```

**Monitor worker logs**:

```bash
tail -f ~/.pm2/logs/*.log
```

---

## Conclusion

This master plan provides a complete roadmap for:

1. ✅ Building TypeScript-first plugin infrastructure (Phases 1-5)
2. 🔄 Hardening security and completing MCP support (Phase 6)
3. 🔲 Migrating all existing plugins (Phase 7)
4. 🔲 Implementing WhatsApp as flagship channel plugin (Phase 8)
5. 🔲 Comprehensive documentation (Phase 9)

**Next Immediate Steps**:

1. Complete Phase 6.1 security hardening (URGENT)
2. Finish Phase 6.2 OAuth testing
3. Begin Phase 7 plugin migration

**Estimated Completion**: 4-6 weeks from start of Phase 6

**Key Success Factors**:

- Security must be hardened before any production use
- Migrate plugins gradually, test each thoroughly
- WhatsApp implementation sets pattern for future channel plugins
- Documentation enables external plugin development

This plan balances security, functionality, and developer experience while maintaining system reliability throughout the migration process.
