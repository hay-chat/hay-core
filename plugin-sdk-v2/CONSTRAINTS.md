# Plugin SDK v2 - Critical Constraints

This document outlines the critical constraints that MUST be enforced throughout the SDK implementation.

## 1. NO Core Integration

**This implementation does NOT include any Hay Core integration.**

- No plugin discovery mechanisms
- No worker process management
- No database persistence
- No orchestration layer

The SDK provides the plugin runtime and HTTP server only. Hay Core is responsible for:
- Discovering plugins
- Spawning worker processes
- Managing plugin lifecycle
- Storing plugin configuration
- Routing to plugin HTTP servers

## 2. NO Core Type Dependencies

**The SDK MUST NOT import or reference any code from the Hay Core repository.**

All types and mechanisms must be defined locally inside `plugin-sdk-v2/`. This ensures:
- Clean separation of concerns
- SDK can be extracted to its own repository
- No circular dependencies
- Clear API boundaries

## 3. Strict Hook Separation

**The SDK must enforce separation between descriptor APIs and runtime APIs.**

### Descriptor APIs (onInitialize only)
- `register.config()` - Define config schema
- `register.auth.*()` - Define auth methods
- `register.route()` - Define HTTP routes
- `register.ui()` - Define UI extensions
- `config.field()` - Create field references for auth/other descriptors

### Runtime APIs (onStart, onValidateAuth, onConfigUpdate, onDisable only)
- `config.get()` - Read config values
- `config.getOptional()` - Read optional config values
- `auth.get()` - Read auth credentials
- `mcp.startLocal()` - Start local MCP servers
- `mcp.startExternal()` - Connect to external MCP servers

**Enforcement**: The SDK should use different context types to prevent misuse:
- `HayGlobalContext` provides descriptor APIs
- `HayStartContext` and other runtime contexts provide runtime APIs

## 4. Worker Lifecycle Boundaries

**The runner must NOT call `onEnable()`.**

The `onEnable()` hook (if it exists) is triggered only by Hay Core during plugin installation, not by the worker runner.

The runner only handles these hooks:
- `onInitialize` - Global initialization
- `onStart` - Org runtime start
- `onValidateAuth` - Auth validation
- `onConfigUpdate` - Config change notification
- `onDisable` - Cleanup on disable/uninstall

## 5. Metadata Format Compliance

**The `/metadata` endpoint MUST return this exact format:**

```json
{
  "routes": [
    {
      "method": "POST",
      "path": "/webhook",
      "description": "..."
    }
  ],
  "configSchema": {
    "apiKey": {
      "type": "string",
      "required": false,
      "env": "PLUGIN_API_KEY",
      "sensitive": true,
      "label": "API Key",
      "description": "..."
    }
  },
  "authMethods": [
    {
      "id": "apiKey",
      "type": "apiKey",
      "label": "API Key",
      "configField": "apiKey"
    }
  ],
  "uiExtensions": [
    {
      "slot": "after-settings",
      "component": "components/Settings.vue"
    }
  ],
  "mcp": {
    "local": [
      {
        "id": "main-mcp",
        "description": "..."
      }
    ],
    "external": [
      {
        "id": "external-mcp",
        "url": "https://...",
        "description": "..."
      }
    ]
  }
}
```

This format is what Hay Core expects to read from the plugin worker.

## 6. Environment Variable Security

**Plugins can ONLY access environment variables listed in their manifest.**

The `hay-plugin.env` array in `package.json` is an allowlist:

```json
{
  "hay-plugin": {
    "env": ["SHOPIFY_API_KEY", "SHOPIFY_SECRET"]
  }
}
```

If a config field references an env var (via `env: "SHOPIFY_API_KEY"`), the runner must:
1. Check that the env var is in the manifest allowlist
2. Only then allow `config.get()` to fall back to `process.env`

This prevents plugins from accessing core secrets like `DATABASE_URL`, `OPENAI_API_KEY`, etc.

## 7. Multi-tenant Isolation

**Each organization gets a completely isolated plugin instance.**

- One worker process per (org, plugin) pair
- No shared state between orgs
- Config and auth are org-specific
- MCP servers are started per-org

The runner receives org ID and org-specific config/auth when started by Hay Core.

## Implementation Notes

These constraints should be:
- Documented in code comments
- Enforced via TypeScript types where possible
- Validated at runtime where necessary
- Tested in the test suite

Any violation of these constraints is a critical bug and must be fixed immediately.
