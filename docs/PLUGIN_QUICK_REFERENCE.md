# Plugin Development Quick Reference

> **Fast reference for common plugin development tasks**

## Quick Start Checklist

- [ ] Create plugin directory in `plugins/core/` or `plugins/custom/{orgId}/`
- [ ] Create `manifest.json` following schema
- [ ] Create `package.json` with dependencies
- [ ] Create `tsconfig.json` for TypeScript
- [ ] Implement plugin entry point in `src/index.ts`
- [ ] Build plugin: `npm run build`
- [ ] Test in dashboard

---

## Minimal manifest.json

```json
{
  "$schema": "../base/plugin-manifest.schema.json",
  "id": "hay-plugin-myservice",
  "name": "My Service",
  "version": "1.0.0",
  "description": "Integration with My Service",
  "author": "Your Name",
  "type": ["mcp-connector"],
  "entry": "./dist/index.js",
  "enabled": true,
  "category": "integration",
  "capabilities": {
    "mcp": {
      "connection": { "type": "local" },
      "tools": [],
      "transport": "stdio",
      "auth": ["apiKey"],
      "installCommand": "npm install",
      "startCommand": "node mcp/index.js"
    }
  },
  "configSchema": {
    "apiKey": {
      "type": "string",
      "label": "API Key",
      "required": true,
      "encrypted": true,
      "env": "MYSERVICE_API_KEY"
    }
  },
  "permissions": {
    "env": ["MYSERVICE_API_KEY"],
    "scopes": ["org:<orgId>:mcp:invoke"]
  }
}
```

---

## Common Patterns

### Local MCP Server

```json
{
  "capabilities": {
    "mcp": {
      "connection": { "type": "local" },
      "serverPath": "./mcp/index.js",
      "transport": "sse|websocket|http",
      "startCommand": "node mcp/index.js"
    }
  }
}
```

### Remote MCP Server

```json
{
  "capabilities": {
    "mcp": {
      "connection": {
        "type": "remote",
        "url": "https://mcp.service.com"
      },
      "transport": "http"
    }
  }
}
```

### OAuth Authentication

```json
{
  "capabilities": {
    "mcp": {
      "auth": {
        "methods": ["oauth2", "apiKey"],
        "oauth": {
          "authorizationUrl": "https://service.com/oauth/authorize",
          "tokenUrl": "https://service.com/oauth/token",
          "scopes": ["read", "write"],
          "pkce": true,
          "clientIdEnvVar": "SERVICE_CLIENT_ID",
          "clientSecretEnvVar": "SERVICE_CLIENT_SECRET"
        }
      }
    }
  }
}
```

### API Key Authentication

```json
{
  "configSchema": {
    "apiKey": {
      "type": "string",
      "label": "API Key",
      "placeholder": "sk_live_...",
      "required": true,
      "encrypted": true,
      "env": "SERVICE_API_KEY"
    }
  }
}
```

### MCP Tool Definition

```json
{
  "name": "create_resource",
  "label": "Create Resource",
  "description": "Creates a new resource",
  "input_schema": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "description": "Resource name"
      },
      "amount": {
        "type": "number",
        "description": "Amount in cents",
        "minimum": 0
      }
    },
    "required": ["name"]
  }
}
```

---

## API Usage

### Frontend (Dashboard)

```typescript
import { Hay } from '@/utils/api';

// Get all plugins
const plugins = await Hay.plugins.getAll.query();

// Enable plugin
await Hay.plugins.enable.mutate({
  pluginId: 'hay-plugin-myservice',
  configuration: {
    apiKey: 'sk_test_123'
  }
});

// Get configuration
const config = await Hay.plugins.getConfig.query({
  pluginId: 'hay-plugin-myservice'
});

// Update configuration
await Hay.plugins.updateConfig.mutate({
  pluginId: 'hay-plugin-myservice',
  configuration: {
    apiKey: 'new_key'
  }
});

// Invoke tool
const result = await Hay.plugins.invokeTool.mutate({
  pluginId: 'hay-plugin-myservice',
  toolName: 'create_resource',
  arguments: {
    name: 'My Resource',
    amount: 1000
  }
});

// Disable plugin
await Hay.plugins.disable.mutate({
  pluginId: 'hay-plugin-myservice'
});
```

### Backend (Services)

```typescript
// Plugin Manager
import { pluginManagerService } from '@server/services/plugin-manager.service';

const plugin = pluginManagerService.getPlugin('hay-plugin-myservice');
await pluginManagerService.installPlugin('hay-plugin-myservice');
await pluginManagerService.buildPlugin('hay-plugin-myservice');

// Plugin Instance Manager
import { pluginInstanceManagerService } from '@server/services/plugin-instance-manager.service';

await pluginInstanceManagerService.ensureInstanceRunning(orgId, 'hay-plugin-myservice');
await pluginInstanceManagerService.updateActivityTimestamp(orgId, 'hay-plugin-myservice');

// Process Manager
import { processManagerService } from '@server/services/process-manager.service';

await processManagerService.startPlugin(orgId, 'hay-plugin-myservice');
await processManagerService.stopPlugin(orgId, 'hay-plugin-myservice');
const isRunning = processManagerService.isRunning(orgId, 'hay-plugin-myservice');
```

---

## File Structure

```
hay-plugin-myservice/
├── manifest.json              # Plugin configuration
├── package.json              # NPM dependencies
├── tsconfig.json             # TypeScript config
├── src/
│   └── index.ts             # Entry point
├── dist/
│   └── index.js             # Compiled output
├── mcp/                     # MCP server
│   ├── index.js
│   └── package.json
└── components/              # Vue components (optional)
    └── settings/
        └── CustomSettings.vue
```

---

## Environment Variables

Configuration fields automatically map to environment variables:

```json
{
  "configSchema": {
    "apiKey": {
      "env": "SERVICE_API_KEY"
    }
  }
}
```

When MCP server starts:
```bash
SERVICE_API_KEY=decrypted_value node mcp/index.js
```

---

## Channel Registration

```typescript
// Register a communication channel
await trpc.sources.register.mutate({
  id: 'whatsapp',
  name: 'WhatsApp Business',
  category: 'messaging',
  pluginId: 'my-plugin',
  metadata: { version: '1.0' }
});

// Create messages with source
import { MessageService } from '@server/services/core/message.service';

const message = await messageService.createAssistantMessageWithTestMode(
  conversation,
  'Hello!',
  'whatsapp',  // sourceId
  agent,
  organization,
  metadata
);
```

---

## UI Extensions

### Add Settings Section

```json
{
  "settingsExtensions": [
    {
      "slot": "after-settings",
      "component": "components/settings/Instructions.vue"
    }
  ]
}
```

### Add Settings Tab

```json
{
  "settingsExtensions": [
    {
      "slot": "tab",
      "component": "components/settings/Advanced.vue",
      "tabName": "Advanced Settings",
      "tabOrder": 1
    }
  ]
}
```

---

## TypeScript Types

```typescript
// Import plugin types
import type { HayPluginManifest } from '@server/types/plugin.types';

// Plugin manifest type
interface HayPluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  type: PluginType[];
  entry: string;
  enabled?: boolean;
  capabilities?: PluginCapabilities;
  configSchema?: Record<string, ConfigField>;
  permissions?: PluginPermissions;
}

// Configuration field type
interface ConfigField {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  encrypted?: boolean;
  env?: string;
  regex?: string;
  default?: any;
}
```

---

## Testing Plugins

### Local Testing

```bash
# Install dependencies
cd plugins/core/my-plugin
npm install

# Build plugin
npm run build

# Test MCP server directly
cd mcp
SERVICE_API_KEY=test_key node index.js
```

### Integration Testing

```bash
# Run server
npm run dev

# Enable plugin in dashboard
# Test tool invocations
# Check logs for errors
```

---

## Common Issues

| Issue | Solution |
|-------|----------|
| Plugin not appearing | Check manifest.json is valid, check console for errors |
| Install failed | Verify installCommand, check network, review logs |
| MCP won't start | Check startCommand, verify env vars, check ports |
| Tool invocation fails | Verify tool name, check input schema, ensure running |
| Config not working | Restart instance, verify env mapping |

---

## Useful Commands

```bash
# Validate manifest against schema
npx ajv validate -s plugins/base/plugin-manifest.schema.json -d plugins/core/my-plugin/manifest.json

# Build plugin
cd plugins/core/my-plugin && npm run build

# Check running processes
ps aux | grep "node mcp"

# View plugin logs
tail -f server/logs/plugins/my-plugin.log

# Install all plugin dependencies
cd plugins/core/my-plugin && npm install && cd mcp && npm install
```

---

## Plugin ID Naming

- Format: `hay-plugin-{service-name}`
- Use lowercase and hyphens
- Match pattern: `/^[a-z0-9-]+$/`
- Examples: `hay-plugin-shopify`, `hay-plugin-stripe`

---

## Version Management

Follow semantic versioning:
- **MAJOR**: Breaking changes (2.0.0)
- **MINOR**: New features (1.1.0)
- **PATCH**: Bug fixes (1.0.1)

---

## Security Checklist

- [ ] Mark sensitive fields as `encrypted: true`
- [ ] Validate all user input
- [ ] Use HTTPS for remote servers
- [ ] Request minimal OAuth scopes
- [ ] Never log secrets
- [ ] Sanitize error messages
- [ ] Implement rate limiting
- [ ] Use secure dependencies

---

## Performance Tips

- Keep tool execution under 5 seconds
- Cache expensive operations
- Optimize MCP server startup time
- Handle concurrent requests
- Monitor memory usage
- Clean up resources on shutdown

---

## Resources

- **Full Documentation**: [docs/PLUGIN_API.md](./PLUGIN_API.md)
- **Generation Guide**: [.claude/PLUGIN_GENERATION_WORKFLOW.md](../.claude/PLUGIN_GENERATION_WORKFLOW.md)
- **Channel Guide**: [docs/PLUGIN_CHANNEL_REGISTRATION.md](./PLUGIN_CHANNEL_REGISTRATION.md)
- **Example Plugins**: `plugins/core/` directory
- **Schema**: `plugins/base/plugin-manifest.schema.json`

---

**Need Help?** Check the full documentation at [docs/PLUGIN_API.md](./PLUGIN_API.md)
