# Plugin Channel Registration Guide

## Overview

Plugins can register custom communication channels (sources) in the Hey! platform. This allows plugins to handle messages from various platforms like WhatsApp, Instagram, Zendesk, and more.

## Architecture

### Sources Table

Sources are stored in a system-wide `sources` table (not organization-specific). Each source represents a communication channel.

**Core Sources** (cannot be modified):
- `playground` - Test environment for AI conversation testing
- `webchat` - Website chat widget

**Plugin Sources**:
Plugins can register custom sources with IDs in the format: `plugin-name:channel-name` or just `channel-name`.

## Source Model

```typescript
interface Source {
  id: string;                    // Unique identifier (lowercase alphanumeric, dashes, underscores, colons)
  name: string;                  // Display name (e.g., "WhatsApp Business")
  description?: string;           // Channel description
  category: SourceCategory;       // Category enum
  pluginId?: string;             // ID of the plugin that registered this source
  isActive: boolean;              // Whether the source is active
  icon?: string;                  // Icon identifier
  metadata?: Record<string, unknown>; // Plugin-specific configuration
  createdAt: Date;
  updatedAt: Date;
}

enum SourceCategory {
  TEST = 'test',
  MESSAGING = 'messaging',
  SOCIAL = 'social',
  EMAIL = 'email',
  HELPDESK = 'helpdesk',
}
```

## Registration API

### Register a New Source

Use the `sources.register` tRPC endpoint:

```typescript
const source = await trpc.sources.register.mutate({
  id: 'whatsapp',                    // or 'my-plugin:whatsapp'
  name: 'WhatsApp Business',
  description: 'WhatsApp Business API integration',
  category: 'messaging',
  pluginId: 'whatsapp-plugin',
  icon: 'whatsapp',
  metadata: {
    apiVersion: '2.0',
    capabilities: ['text', 'media', 'templates']
  }
});
```

### Source ID Naming Convention

**Simple format**: `channelname` (e.g., `whatsapp`, `telegram`)
- Use for well-known, unique channels

**Namespaced format**: `plugin-name:channel-name` (e.g., `zendesk:support-tickets`)
- Use when multiple plugins might register similar channels
- Recommended for custom or organization-specific channels

**Rules**:
- Lowercase only
- Alphanumeric characters, dashes, underscores, and colons allowed
- Pattern: `/^[a-z0-9_:-]+$/`
- Core sources (`playground`, `webchat`) cannot be registered or modified

## Plugin Integration Examples

### WhatsApp Plugin

```typescript
// In plugin initialization
export async function registerWhatsAppSource(trpc: TRPCClient) {
  const source = await trpc.sources.register.mutate({
    id: 'whatsapp',
    name: 'WhatsApp Business',
    description: 'Send and receive messages via WhatsApp Business API',
    category: 'messaging',
    pluginId: 'whatsapp',
    icon: 'whatsapp',
    metadata: {
      apiVersion: 'v16.0',
      supportedMessageTypes: ['text', 'image', 'document', 'video'],
      webhookUrl: '/webhooks/whatsapp'
    }
  });

  return source;
}

// When creating messages from WhatsApp
await messageService.createAssistantMessageWithTestMode(
  conversation,
  content,
  'whatsapp',  // sourceId
  agent,
  organization,
  metadata
);
```

### Instagram Plugin

```typescript
export async function registerInstagramSource(trpc: TRPCClient) {
  const source = await trpc.sources.register.mutate({
    id: 'instagram',
    name: 'Instagram Direct',
    description: 'Instagram Direct Messages integration',
    category: 'social',
    pluginId: 'instagram',
    icon: 'instagram',
    metadata: {
      platform: 'instagram',
      messageTypes: ['text', 'story-reply', 'story-mention']
    }
  });

  return source;
}
```

### Zendesk Plugin

```typescript
export async function registerZendeskSource(trpc: TRPCClient) {
  const source = await trpc.sources.register.mutate({
    id: 'zendesk:tickets',
    name: 'Zendesk Support Tickets',
    description: 'Respond to Zendesk support tickets with AI',
    category: 'helpdesk',
    pluginId: 'zendesk',
    icon: 'zendesk',
    metadata: {
      ticketFields: ['priority', 'status', 'tags'],
      webhookSecret: process.env.ZENDESK_WEBHOOK_SECRET
    }
  });

  return source;
}
```

## Source Management

### Deactivate a Source

```typescript
await trpc.sources.deactivate.mutate({
  id: 'whatsapp'
});
```

**Note**: Core sources (`playground`, `webchat`) cannot be deactivated.

### Activate a Source

```typescript
await trpc.sources.activate.mutate({
  id: 'whatsapp'
});
```

### List All Sources

```typescript
const sources = await trpc.sources.list.query();
```

### Get Sources by Category

```typescript
const messagingSources = await trpc.sources.getByCategory.query({
  category: 'messaging'
});
```

## Test Mode Behavior

### Playground Source

- **Always bypasses approval** regardless of organization or agent test mode settings
- Used for safe testing without affecting real customers
- Messages are immediately sent (delivery_state = 'sent', review_required = false)

### Other Sources (webchat, whatsapp, etc.)

Test mode is determined by:
1. Agent-level `testMode` setting (if set)
2. Falls back to organization-level `testModeDefault` (in settings JSONB)
3. Default: `false` (no test mode)

**When test mode is ON**:
- Messages require approval before sending to customers
- delivery_state = 'queued'
- review_required = true
- Messages only sent after explicit approval

**When test mode is OFF**:
- Messages sent immediately
- delivery_state = 'sent'
- review_required = false

## Plugin Lifecycle

### On Plugin Install

```typescript
export async function onInstall(context: PluginContext) {
  // Register source
  await context.trpc.sources.register.mutate({
    id: 'my-channel',
    name: 'My Channel',
    category: 'messaging',
    pluginId: context.pluginId
  });
}
```

### On Plugin Uninstall

```typescript
export async function onUninstall(context: PluginContext) {
  // Deactivate source (don't delete - preserve message history)
  await context.trpc.sources.deactivate.mutate({
    id: 'my-channel'
  });
}
```

## Message Creation with Sources

When creating messages from your plugin, always specify the sourceId:

```typescript
import { MessageService } from '@/services/core/message.service';
import { DeliveryState } from '@/types/message-feedback.types';

const messageService = new MessageService();

// For bot messages that respect test mode
const message = await messageService.createAssistantMessageWithTestMode(
  conversation,
  'Hello from WhatsApp!',
  'whatsapp',  // sourceId
  agent,
  organization,
  {
    whatsappMessageId: 'wamid.xxxxx',
    phoneNumber: '+1234567890'
  }
);

// Check if message needs approval
if (message.deliveryState === DeliveryState.QUEUED) {
  // Message is queued for approval
  // Don't send to external platform yet
  console.log('Message queued for approval');
} else {
  // Message approved automatically
  // Send to external platform
  await sendToWhatsApp(message);
}
```

## Validation Rules

### Source Registration

- **ID**: Required, must match `/^[a-z0-9_:-]+$/`, cannot be core source
- **Name**: Required, 1-100 characters
- **Category**: Required, must be valid SourceCategory enum value
- **Plugin ID**: Optional but recommended, links source to plugin

### Restrictions

- Cannot register sources with IDs `playground` or `webchat`
- Cannot deactivate core sources
- Cannot modify sources registered by other plugins (future: multi-tenancy)

## Error Handling

```typescript
try {
  await trpc.sources.register.mutate({
    id: 'my-source',
    name: 'My Source',
    category: 'messaging',
    pluginId: 'my-plugin'
  });
} catch (error) {
  if (error.message.includes('already exists')) {
    // Source already registered
    // Option 1: Use existing source
    // Option 2: Reactivate if deactivated
  } else if (error.message.includes('core source')) {
    // Attempted to register protected source
  } else {
    // Other validation errors
  }
}
```

## Best Practices

1. **Use namespaced IDs** for custom channels: `my-plugin:my-channel`
2. **Store plugin-specific config** in the `metadata` field
3. **Deactivate (don't delete)** sources on plugin uninstall to preserve message history
4. **Check delivery_state** before sending messages to external platforms
5. **Use appropriate categories** for better organization and filtering
6. **Provide clear descriptions** for users to understand each channel
7. **Handle test mode properly** - respect queued messages

## Future Enhancements

- Source-specific permissions and access control
- Multi-organization source isolation
- Source capabilities and feature flags
- Webhook configuration per source
- Rate limiting per source
- Analytics and metrics per source

## Support

For questions or issues with source registration:
- Check the tRPC API documentation
- Review existing plugin examples
- Open an issue on the Hey! GitHub repository
