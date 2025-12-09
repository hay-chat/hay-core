# @hay/plugin-sdk

TypeScript SDK for building Hay plugins with process isolation and HTTP communication.

## Overview

The Hay Plugin SDK provides base classes and utilities to create plugins that extend Hay's functionality through various capabilities:

- **Routes**: Register HTTP endpoints for webhooks and external integrations
- **Messages**: Receive and send messages through the Hay platform
- **Customers**: Manage customer data and profiles
- **Sources**: Register as message sources (channels like WhatsApp, Slack, etc.)
- **MCP**: Connect Model Context Protocol servers for AI tools

## Architecture

Plugins run in isolated Node.js processes (one per organization+plugin combination) and communicate with the main Hay application via HTTP. This provides:

- **Security**: Each organization's plugin runs in isolation with scoped environment variables
- **Stability**: Plugin crashes don't affect other organizations or the main application
- **Scalability**: Workers can be distributed across multiple machines
- **Debuggability**: HTTP communication is standard and easy to debug

## Installation

In your plugin directory:

```bash
npm install @hay/plugin-sdk
```

## Quick Start

### 1. Create Plugin Class

```typescript
// src/MyPlugin.ts
import { HayPlugin } from '@hay/plugin-sdk';

export default class MyPlugin extends HayPlugin {
  constructor() {
    super({
      id: 'my-plugin',
      name: 'My Plugin',
      version: '1.0.0',
      description: 'My awesome plugin',
      capabilities: ['routes', 'messages', 'customers'],
      config: {
        apiKey: {
          type: 'string',
          label: 'API Key',
          required: true,
          encrypted: true,
          envVar: 'MY_PLUGIN_API_KEY'
        }
      }
    });
  }

  async onInitialize(): Promise<void> {
    // Register webhook endpoint
    this.registerRoute('POST', '/webhook', this.handleWebhook.bind(this));

    // Register as message source
    await this.sdk.registerSource({
      id: 'my-plugin',
      name: 'My Plugin',
      category: 'messaging'
    });
  }

  private async handleWebhook(req: Request, res: Response): Promise<void> {
    const { from, message } = req.body;

    // Receive message through Hay SDK
    await this.sdk.messages.receive({
      from,
      content: message,
      channel: 'my-plugin',
      metadata: { /* additional data */ }
    });

    res.json({ success: true });
  }
}
```

### 2. Create Entry Point

```typescript
// src/index.ts
import { startPluginWorker } from '@hay/plugin-sdk';
import MyPlugin from './MyPlugin';

startPluginWorker(MyPlugin);
```

### 3. Configure Package

```json
{
  "name": "@hay/plugin-my-plugin",
  "version": "1.0.0",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@hay/plugin-sdk": "workspace:*"
  }
}
```

### 4. Build and Run

```bash
npm run build
npm start
```

## API Reference

### HayPlugin Base Class

#### Constructor Options

```typescript
interface PluginMetadata {
  id: string;                          // Unique plugin identifier
  name: string;                        // Human-readable name
  version: string;                     // Semantic version
  description?: string;                // Plugin description
  author?: string;                     // Plugin author
  category?: string;                   // Plugin category
  icon?: string;                       // Icon identifier
  capabilities: PluginCapabilityType[]; // Required capabilities
  config?: Record<string, ConfigFieldDefinition>; // Configuration schema
}

type PluginCapabilityType = 'routes' | 'messages' | 'customers' | 'sources' | 'mcp';
```

#### Lifecycle Hooks

```typescript
abstract onInitialize(): Promise<void>;  // Required: Called on startup
async onEnable?(): Promise<void>;        // Optional: Called when enabled
async onDisable?(): Promise<void>;       // Optional: Called when disabled
async onConfigUpdate?(newConfig: Record<string, any>): Promise<void>; // Optional: Called on config change
```

#### Route Registration

```typescript
protected registerRoute(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  path: string,
  handler: (req: Request, res: Response, next?: NextFunction) => void | Promise<void>
): void;
```

Example:
```typescript
this.registerRoute('POST', '/webhook', async (req, res) => {
  const data = req.body;
  // Process webhook...
  res.json({ success: true });
});
```

#### Utilities

```typescript
protected config: Record<string, any>;        // Access plugin configuration
protected sdk: PluginSDK;                      // Access Hay SDK
protected log(message: string, ...args): void; // Log with plugin prefix
protected logError(message: string, error?: Error): void; // Log errors
```

### PluginSDK - Messages Capability

```typescript
// Receive incoming message from customer
await this.sdk.messages.receive({
  from: string;           // Customer identifier
  content: string;        // Message content
  channel: string;        // Channel name (e.g., 'whatsapp')
  metadata?: object;      // Additional metadata
});

// Send outgoing message to customer
await this.sdk.messages.send({
  to: string;             // Customer identifier
  content: string;        // Message content
  channel: string;        // Channel name
  conversationId?: string; // Optional: existing conversation
  metadata?: object;      // Additional metadata
});

// Get messages by conversation
const messages = await this.sdk.messages.getByConversation(conversationId);
```

### PluginSDK - Customers Capability

```typescript
// Get customer by ID
const customer = await this.sdk.customers.get(customerId);

// Find customer by external ID
const customer = await this.sdk.customers.findByExternalId(
  externalId,  // e.g., phone number
  channel      // e.g., 'whatsapp'
);

// Create or update customer
const customer = await this.sdk.customers.upsert({
  externalId: string;
  channel: string;
  email?: string;
  phone?: string;
  name?: string;
  metadata?: object;
});
```

### PluginSDK - Sources Capability

```typescript
// Register plugin as message source
await this.sdk.registerSource({
  id: string;
  name: string;
  category: 'messaging' | 'social' | 'email' | 'helpdesk';
  icon?: string;
  metadata?: object;
});
```

### PluginSDK - MCP Capability

```typescript
// Register local MCP server
await this.sdk.mcp.registerLocalMCP({
  serverPath: string;
  startCommand: string;
  installCommand?: string;
  buildCommand?: string;
  tools: MCPToolDefinition[];
});

// Register remote MCP server
await this.sdk.mcp.registerRemoteMCP({
  url: string;
  transport: 'http' | 'sse' | 'websocket';
  auth?: {
    type: 'bearer' | 'apiKey';
    token?: string;
    apiKey?: string;
  };
  tools: MCPToolDefinition[];
});
```

## Configuration Management

Plugin configuration is defined in the metadata and automatically loaded from environment variables:

```typescript
config: {
  apiKey: {
    type: 'string',
    label: 'API Key',
    description: 'Your API key',
    required: true,
    encrypted: true,        // Stored encrypted in database
    envVar: 'MY_API_KEY'    // Maps to environment variable
  },
  timeout: {
    type: 'number',
    label: 'Timeout',
    default: 5000,
    envVar: 'MY_TIMEOUT'
  }
}
```

Access configuration values:

```typescript
const apiKey = this.config.apiKey;    // Automatically type-converted
const timeout = this.config.timeout;
```

## Environment Variables

The SDK requires these environment variables to be set by the plugin manager:

- `HAY_API_URL`: URL of main Hay application (e.g., `http://localhost:3001`)
- `HAY_API_TOKEN`: JWT token for authentication
- `HAY_WORKER_PORT`: Port for worker HTTP server

Plugin-specific configuration is mapped via the `envVar` field in config definitions.

## Examples

### Channel Plugin (WhatsApp)

See [plugins/core/whatsapp](../../plugins/core/whatsapp) for a complete example of a channel plugin with:
- Webhook registration
- Message receiving
- Message sending with retry logic
- Customer management

### MCP Plugin (Email)

See [plugins/core/email](../../plugins/core/email) for an example of an MCP plugin that:
- Registers local MCP server
- Provides tools for email operations
- Integrates with AI agents

## Development

### Building

```bash
npm run build
```

### Type Checking

```bash
npm run typecheck
```

### Watching for Changes

```bash
npm run dev
```

## Architecture Notes

### Process Isolation

Each plugin+organization combination runs in a separate Node.js process:
- Workers are spawned by the plugin manager
- JWT tokens scope API access to specific organization
- Environment variables are scoped per worker
- Workers are kept alive based on plugin type (30min for channels, 5min for MCP)

### HTTP Communication

Plugins communicate with the main application via HTTP:
- **Inbound**: External webhooks → Main app → Plugin worker (via route proxy)
- **Outbound**: Plugin SDK → Main app Plugin API (via HTTP client)

### Security

- JWT tokens with capability-based access control
- All API requests verified against plugin capabilities
- Data scoped to organization ID in token
- Encrypted configuration fields stored securely

## License

UNLICENSED - Internal use only
