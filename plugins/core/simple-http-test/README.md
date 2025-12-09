# Simple HTTP Test Plugin

A minimal test plugin to validate the TypeScript-first plugin architecture infrastructure.

## Purpose

This plugin serves as a validation tool for the core plugin infrastructure, testing:

- **Process Isolation**: Each org+plugin runs in a separate Node.js process
- **Port Allocation**: Dynamic port assignment from 5000-6000 range
- **HTTP Communication**: Workers run Express servers, requests proxied from main app
- **Route Registration**: Plugin SDK route registration API
- **Worker Lifecycle**: On-demand startup, keep-alive, cleanup
- **JWT Authentication**: Token passing and validation
- **Environment Variables**: Config passing to workers

## Architecture

```
External Request
  ↓
Main App: GET /v1/plugins/simple-http-test/ping?organizationId={id}
  ↓
Route Proxy (extracts organizationId, starts/finds worker)
  ↓
HTTP → Worker Process (localhost:5XXX)
  ↓
Plugin: HayPlugin route handler
  ↓
JSON Response
```

## Features

This is a **routes-only** plugin (no MCP, messages, customers, or sources capabilities).

### Registered Routes

1. **GET /health** - Health check (auto-registered by HayPlugin base class)
   - Returns: `{ status: "ok", plugin: "simple-http-test", version: "1.0.0" }`

2. **GET /ping** - Simple ping/pong response
   - Returns: `{ success: true, message: "pong", timestamp, pluginId, pluginVersion }`

3. **POST /echo** - Echo back request body
   - Accepts: Any JSON body
   - Returns: `{ success: true, echo: <body>, timestamp, headers }`

4. **GET /config** - Show plugin configuration (safe fields only)
   - Returns: `{ success: true, metadata, environment }`
   - Redacts sensitive values (tokens, secrets)

5. **GET /headers** - Show request headers
   - Returns: `{ success: true, headers, timestamp }`
   - Redacts authorization header

## Building

```bash
npm install
npm run build
```

## Testing

See [TESTING.md](./TESTING.md) for comprehensive testing instructions.

## Implementation

This plugin demonstrates the **TypeScript-first** approach:

### src/index.ts

```typescript
import { HayPlugin, startPluginWorker } from "@hay/plugin-sdk";

class SimpleHttpTestPlugin extends HayPlugin {
  constructor() {
    super({
      id: "simple-http-test",
      name: "Simple HTTP Test Plugin",
      version: "1.0.0",
      capabilities: ["routes"],
    });
  }

  async onInitialize(): Promise<void> {
    // Register routes
    this.registerRoute("GET", "/ping", this.handlePing);
    this.registerRoute("POST", "/echo", this.handleEcho);
    this.registerRoute("GET", "/config", this.handleConfig);
    this.registerRoute("GET", "/headers", this.handleHeaders);
  }

  private handlePing: RouteHandler = async (req, res) => {
    res.json({ success: true, message: "pong", ... });
  };

  // ... other handlers
}

startPluginWorker(SimpleHttpTestPlugin);
```

### Key Concepts

1. **Extends HayPlugin**: Base class provides Express server, SDK client, lifecycle hooks
2. **Metadata in Constructor**: Plugin ID, name, version, capabilities
3. **onInitialize() Hook**: Called on worker startup, registers routes
4. **RouteHandler Type**: Express-compatible (req, res) => Promise<void>
5. **startPluginWorker()**: Entry point that starts worker process

## Environment Variables

These are automatically provided by the plugin manager:

- `HAY_API_URL` - Main app API URL (e.g., http://localhost:3001)
- `HAY_API_TOKEN` - JWT token for Plugin API authentication
- `PORT` - Assigned port for this worker (5000-6000 range)
- `PLUGIN_ID` - Plugin identifier
- `ORGANIZATION_ID` - Organization ID for this worker instance

## Validation Checklist

- [x] Plugin builds successfully
- [x] TypeScript types are correct
- [x] Manifest.json exists (minimal, for discovery)
- [ ] Worker starts successfully
- [ ] Health check passes
- [ ] All routes respond correctly
- [ ] Environment variables passed
- [ ] Worker cleanup works
- [ ] Process isolation verified

## Next Steps

Once this test plugin validates successfully:

1. **Phase 5 Complete**: Core infrastructure validated
2. **Implement MCP Support**: Add MCP registration endpoints to Plugin API
3. **Migrate Email Plugin**: First real plugin migration
4. **Migrate All Core Plugins**: attio, hubspot, judo, shopify, stripe, zendesk
5. **Implement WhatsApp Plugin**: First channel plugin with full capabilities

## Notes

- Currently uses minimal `manifest.json` for plugin discovery
- Future: Plugin manager should support TypeScript-first plugins without manifest
- This validates **HTTP routes only** - MCP capabilities need separate testing
- Keep-alive timeout: 5 minutes (configurable in constructor)
