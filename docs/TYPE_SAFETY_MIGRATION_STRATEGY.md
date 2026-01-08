# Type Safety Migration Strategy - Core Systems

**Generated**: 2025-12-25
**Scope**: Orchestrator, Plugin System, WebSocket, OAuth
**Total Issues Found**: 44 instances across 25 unique type problems

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Migration Phases](#migration-phases)
3. [Phase 1: Foundation Types](#phase-1-foundation-types-week-1)
4. [Phase 2: Critical Cross-Module Boundaries](#phase-2-critical-cross-module-boundaries-week-2)
5. [Phase 3: High Priority Internal Types](#phase-3-high-priority-internal-types-week-3-4)
6. [Phase 4: Medium Priority Cleanup](#phase-4-medium-priority-cleanup-week-5)
7. [Testing Strategy](#testing-strategy)
8. [Rollback Plan](#rollback-plan)
9. [Success Metrics](#success-metrics)

---

## Overview

### Problem Statement

The core systems contain 44 instances of type safety issues:
- **3 Critical** - Cross-module boundary types causing unsafe casts
- **9 High** - Reused internal types lacking structure
- **13 Medium** - Implementation details with weak typing

### Goals

1. **Eliminate all `as any` casts** in core systems
2. **Add type safety at module boundaries** to catch integration bugs at compile time
3. **Improve developer experience** with better autocomplete and error messages
4. **Maintain backward compatibility** - no runtime behavior changes

### Non-Goals

- ❌ Refactoring business logic
- ❌ Changing API contracts
- ❌ Performance optimization
- ❌ Adding new features

---

## Migration Phases

```
Phase 1: Foundation Types (Week 1)
   ↓
Phase 2: Critical Cross-Module (Week 2)
   ↓
Phase 3: High Priority Internal (Week 3-4)
   ↓
Phase 4: Medium Priority Cleanup (Week 5)
   ↓
Validation & Documentation (Week 6)
```

---

## Phase 1: Foundation Types (Week 1)

**Goal**: Create new type definition files without breaking existing code.

### Step 1.1: Create Base Type Files

Create these new files with shared type definitions:

#### File: `server/types/mcp.types.ts`

```typescript
/**
 * MCP (Model Context Protocol) Type Definitions
 * Shared types for MCP client interfaces and tool execution
 */

import type { JSONSchema7 } from 'json-schema';

// Tool Arguments - recursive structure for nested objects
export type MCPToolArgumentValue =
  | string
  | number
  | boolean
  | null
  | MCPToolArgumentValue[]
  | { [key: string]: MCPToolArgumentValue };

export interface MCPToolArguments {
  [key: string]: MCPToolArgumentValue;
}

// Tool Schema
export interface MCPToolSchema {
  name: string;
  description: string;
  input_schema: JSONSchema7;
}

// Tool Content Types
export type MCPContentItem =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; uri: string; mimeType?: string };

// Tool Result
export interface MCPCallResult {
  content?: MCPContentItem[];
  isError?: boolean;
  errorMessage?: string;
  metadata?: {
    executionTime?: number;
    [key: string]: string | number | boolean | undefined;
  };
}

// Tool Definition
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: JSONSchema7;
}
```

**Dependencies**: `npm install --save-dev @types/json-schema` (if not already installed)

#### File: `server/types/websocket.types.ts`

```typescript
/**
 * WebSocket Type Definitions
 * Type-safe WebSocket message handling
 */

// Client Metadata
export interface WebSocketClientMetadata {
  userAgent?: string;
  ipAddress?: string;
  connectionId?: string;
  customData?: Record<string, string | number | boolean>;
}

// Event Types
export type WebSocketEventType =
  | 'identify'
  | 'chat'
  | 'typing'
  | 'loadHistory'
  | 'subscribe'
  | 'error'
  | 'messageUpdate'
  | 'conversationUpdate'
  | 'agentTyping'
  | 'conversationStatusChange';

// Base Message
export interface BaseWebSocketMessage {
  type: WebSocketEventType;
  timestamp?: number;
}

// Specific Message Types
export interface IdentifyMessage extends BaseWebSocketMessage {
  type: 'identify';
  customerId: string;
  conversationId?: string;
  metadata?: WebSocketClientMetadata;
}

export interface ChatMessage extends BaseWebSocketMessage {
  type: 'chat';
  content: string;
  proof?: string;
  method?: string;
  url?: string;
  conversationId?: string;
}

export interface TypingMessage extends BaseWebSocketMessage {
  type: 'typing';
  isTyping: boolean;
}

export interface LoadHistoryMessage extends BaseWebSocketMessage {
  type: 'loadHistory';
  limit?: number;
  offset?: number;
}

export interface SubscribeMessage extends BaseWebSocketMessage {
  type: 'subscribe';
  events?: string[];
}

export interface ErrorMessage extends BaseWebSocketMessage {
  type: 'error';
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// Union Type for all messages
export type WebSocketMessage =
  | IdentifyMessage
  | ChatMessage
  | TypingMessage
  | LoadHistoryMessage
  | SubscribeMessage
  | ErrorMessage;

// Client Interface
export interface WebSocketClient {
  ws: WebSocket;
  organizationId: string;
  customerId: string;
  conversationId?: string;
  pluginId?: string;
  authenticated: boolean;
  metadata: WebSocketClientMetadata;
}
```

#### File: `server/types/organization.types.ts`

```typescript
/**
 * Organization Type Definitions
 * Organization settings and configuration
 */

export interface OrganizationFeatures {
  autoClose?: boolean;
  humanHandoff?: boolean;
  sentimentAnalysis?: boolean;
  multilingual?: boolean;
  voiceMessages?: boolean;
  fileUploads?: boolean;
}

export interface OrganizationGuardrails {
  companyInterest?: boolean;
  factGrounding?: boolean;
  confidenceThreshold?: number;
  recheckOnLowConfidence?: boolean;
}

export interface OrganizationAIConfig {
  defaultModel?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

export interface OrganizationBranding {
  primaryColor?: string;
  secondaryColor?: string;
  logo?: string;
  favicon?: string;
  customCSS?: string;
}

export interface OrganizationSettings {
  // AI Configuration
  ai?: OrganizationAIConfig;

  // Features
  features?: OrganizationFeatures;

  // Guardrails
  guardrails?: OrganizationGuardrails;

  // Branding
  branding?: OrganizationBranding;

  // Plugin-specific settings
  pluginSettings?: Record<string, Record<string, string | number | boolean>>;

  // Allow additional settings for extensibility
  [key: string]: unknown;
}
```

#### File: `server/types/plugin-config.types.ts`

```typescript
/**
 * Plugin Configuration Type Definitions
 * Shared types for plugin instance configuration
 */

// Config Value Types
export type PluginConfigValue =
  | string
  | number
  | boolean
  | null
  | PluginConfigValue[]
  | { [key: string]: PluginConfigValue };

// OAuth Token Data
export interface OAuthTokenData {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  token_type?: string;
  scope?: string;
}

// OAuth Configuration
export interface OAuthConfig {
  tokens: OAuthTokenData;
  connected_at: number;
  provider: string;
  scopes?: string[];
}

// Plugin Instance Configuration
export interface PluginInstanceConfig {
  // OAuth data if present (encrypted)
  _oauth?: OAuthConfig;

  // Plugin-specific config (validated against schema)
  [key: string]: PluginConfigValue;
}

// Credential Types
export type CredentialValue = string | number | boolean | null;

export interface PluginCredentials {
  [key: string]: CredentialValue;
}
```

### Step 1.2: Update `tsconfig.json` (if needed)

Ensure path aliases are configured:

```json
{
  "compilerOptions": {
    "paths": {
      "@server/types/*": ["server/types/*"]
    }
  }
}
```

### Step 1.3: Validation

```bash
# Verify types compile
npm run typecheck

# Should pass with no errors (we haven't changed any implementation yet)
```

**Deliverable**: 4 new type files committed, builds successfully.

---

## Phase 2: Critical Cross-Module Boundaries (Week 2)

**Goal**: Fix the 3 critical type issues that cross module boundaries.

### Step 2.1: Fix Orchestration Status Type

**Files to modify**: 2
**Risk**: Medium (database entity change, but JSONB field)
**Impact**: Eliminates 5+ unsafe casts

#### Change 1: Update Conversation Entity

**File**: `server/database/entities/conversation.entity.ts`

```diff
+ import type { ConversationContext } from '@server/orchestrator/types';

  @Entity("conversations")
  export class Conversation {
    // ... other fields

    @Column({ type: "jsonb", nullable: true })
-   orchestration_status!: Record<string, unknown> | null;
+   orchestration_status!: ConversationContext | null;

    // ... rest of entity
  }
```

#### Change 2: Update Orchestrator Types

**File**: `server/orchestrator/types.ts`

```diff
+ import type { MessageIntent, MessageSentiment } from '@server/database/entities/message.entity';
+
+ // Perception Result
+ export interface PerceptionResult {
+   intent: MessageIntent;
+   sentiment: MessageSentiment;
+   entities?: Array<{
+     type: string;
+     value: string;
+     confidence: number;
+   }>;
+   language?: string;
+ }
+
+ // Tool Execution Types
+ export type ToolArgumentValue =
+   | string
+   | number
+   | boolean
+   | null
+   | ToolArgumentValue[]
+   | { [key: string]: ToolArgumentValue };
+
+ export interface ToolArguments {
+   [key: string]: ToolArgumentValue;
+ }
+
+ export interface ToolResult {
+   success: boolean;
+   data?: Record<string, ToolArgumentValue>;
+   error?: string;
+ }
+
+ export interface ToolExecution {
+   turn: number;
+   name: string;
+   input: ToolArguments;
+   ok: boolean;
+   result?: ToolResult;
+   errorClass?: string;
+   latencyMs: number;
+   idempotencyKey: string;
+ }

  export interface ConversationContext {
    version: "v1";
    lastTurn: number;
    activePlaybook?: PlaybookState;
-   perception?: unknown;
+   perception?: PerceptionResult;
    rag?: RagPack | null;
    processingState?: ProcessingState;
-   toolLog: Array<{
-     turn: number;
-     name: string;
-     input: unknown;
-     ok: boolean;
-     result?: unknown;
-     errorClass?: string;
-     latencyMs: number;
-     idempotencyKey: string;
-   }>;
+   toolLog: ToolExecution[];
    guardrailLog?: GuardrailLogEntry[];
-   confidenceLog?: Array<any>; // Legacy, kept for backward compatibility
  }
```

#### Change 3: Remove Unsafe Casts

**File**: `server/orchestrator/run.ts`

```diff
  // Line 70
- (conversation.orchestration_status as unknown as ConversationContext) || {
+ conversation.orchestration_status || {

  // Line 85, 89
- orchestration_status: orchestrationStatus as any,
+ orchestration_status: orchestrationStatus,

  // Line 164
- const orchestrationStatus = (conversation.orchestration_status as any) || {};
+ const orchestrationStatus = conversation.orchestration_status || {};

  // Line 172
- const logEntry: any = {
+ const logEntry: ToolExecution = {
    turn: conversation.orchestration_status?.lastTurn || 0,
    name: toolName,
-   input: args,
+   input: args as ToolArguments,
    ok: success,
    result: success ? result : undefined,
    errorClass: success ? undefined : error?.constructor?.name || 'Error',
    latencyMs,
    idempotencyKey,
  };

  // Line 525, 527
- orchestration_status: initialContext as any,
+ orchestration_status: initialContext,
```

**File**: `server/orchestrator/execution.layer.ts`

```diff
  // Line 505
- const retrievedDocs: Array<{ document: any; similarity: number }> = [];
+ const retrievedDocs: DocumentWithSimilarity[] = [];

  // Line 507
- const orchestrationStatus = conversation.orchestration_status as any;
+ const orchestrationStatus = conversation.orchestration_status;
```

#### Step 2.1 Testing

```bash
# Run type check
npm run typecheck

# Run orchestrator tests
cd server && npm run test -- orchestrator

# Run conversation tests
cd server && npm run test -- conversation.service
```

**Expected Result**: All tests pass, no new TypeScript errors.

### Step 2.2: Fix WebSocket Message Types

**Files to modify**: 1
**Risk**: Low (internal service change)
**Impact**: Type-safe WebSocket event handling

**File**: `server/services/websocket.service.ts`

```diff
+ import type {
+   WebSocketClient,
+   WebSocketMessage,
+   WebSocketClientMetadata,
+   IdentifyMessage,
+   ChatMessage,
+   TypingMessage,
+   LoadHistoryMessage,
+   SubscribeMessage,
+ } from '@server/types/websocket.types';

- interface WebSocketClient {
-   ws: WebSocket;
-   organizationId: string;
-   customerId: string;
-   conversationId?: string;
-   pluginId?: string;
-   authenticated: boolean;
-   metadata: Record<string, unknown>;
- }
-
- interface WebSocketMessage {
-   type: string;
-   [key: string]: unknown;
- }
-
- interface IdentifyMessage extends WebSocketMessage {
-   customerId: string;
-   conversationId?: string;
-   metadata?: Record<string, unknown>;
- }
-
- // ... other message interfaces

  export class WebSocketService {
    private clients = new Map<string, WebSocketClient>();

    // Update method signatures
-   sendToClient(clientId: string, message: Record<string, unknown>): boolean {
+   sendToClient(clientId: string, message: WebSocketMessage): boolean {

-   sendToConversation(conversationId: string, message: Record<string, unknown>): number {
+   sendToConversation(conversationId: string, message: WebSocketMessage): number {

-   sendToOrganization(organizationId: string, message: Record<string, unknown>): number {
+   sendToOrganization(organizationId: string, message: WebSocketMessage): number {

    // ... rest of implementation
  }
```

#### Step 2.2 Testing

```bash
# Type check
npm run typecheck

# WebSocket tests
cd server && npm run test -- websocket.service
```

### Step 2.3: Fix Plugin Manifest Types

**Files to modify**: 2
**Risk**: Low (validation improvement)
**Impact**: Type-safe plugin loading

**File**: `server/services/plugin-manager.service.ts`

```diff
  import type { HayPluginManifest } from '@server/types/plugin.types';

  // Line 195-226
  private async discoverPlugins(): Promise<void> {
-   const manifest: any = {
+   const manifest: HayPluginManifest = {
      id: pluginId,
      name: packageJson.name,
      description: packageJson.description || '',
      version: packageJson.version,
-     type: sdkV2Manifest.capabilities.includes('mcp')
-       ? ['mcp-connector']
-       : ['system'],
+     type: this.inferPluginType(sdkV2Manifest.capabilities),
      entry: sdkV2Manifest.entry,
      autoActivate: sdkV2Manifest.capabilities.includes('autoActivate'),
+     // TypeScript will now enforce all required fields
    };

    // Store in registry
    await pluginRegistryRepository.upsert({
      pluginId,
      name: manifest.name,
      version: manifest.version,
-     manifest: manifest as any,
+     manifest,
      status: PluginStatus.ACTIVE,
      organizationId: null, // Core plugin
    });
  }

+ private inferPluginType(
+   capabilities: string[]
+ ): HayPluginManifest['type'] {
+   const types: HayPluginManifest['type'] = [];
+
+   if (capabilities.includes('mcp')) types.push('mcp-connector');
+   if (capabilities.includes('channel')) types.push('channel');
+   if (capabilities.includes('retriever')) types.push('retriever');
+
+   return types.length > 0 ? types : ['system'];
+ }

  // Line 712
- const manifest = plugin.manifest as any;
+ const manifest = plugin.manifest;

  // Line 1200
- const manifest = plugin.manifest as any;
+ const manifest = plugin.manifest;
```

#### Step 2.3 Testing

```bash
# Type check
npm run typecheck

# Plugin manager tests
cd server && npm run test -- plugin-manager.service
```

### Phase 2 Deliverable

✅ All 3 critical cross-module type issues resolved
✅ No `as any` casts at module boundaries
✅ All tests passing
✅ TypeScript strict mode compliance

---

## Phase 3: High Priority Internal Types (Week 3-4)

**Goal**: Fix the 9 high-priority internal types that are reused across files.

### Step 3.1: MCP Tool Definitions (Day 1-2)

#### File: `server/services/mcp-client.interface.ts`

```diff
+ import type {
+   MCPTool,
+   MCPCallResult,
+   MCPToolArguments
+ } from '@server/types/mcp.types';

- export interface MCPTool {
-   inputSchema: Record<string, unknown>;
- }
-
- export interface MCPContent {
-   content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
-   [key: string]: unknown;
- }

  export interface MCPClient {
    listTools(): Promise<MCPTool[]>;
-   callTool(name: string, args: Record<string, unknown>): Promise<MCPCallResult>;
+   callTool(name: string, args: MCPToolArguments): Promise<MCPCallResult>;
  }
```

#### File: `server/services/plugin-tools.service.ts`

```diff
+ import type { MCPToolSchema } from '@server/types/mcp.types';

- input_schema: Record<string, any>;
+ input_schema: JSONSchema7;
```

#### File: `server/types/plugin.types.ts`

```diff
+ import type { JSONSchema7 } from 'json-schema';

  export interface MCPToolDefinition {
    name: string;
    description: string;
-   input_schema: Record<string, any>;
+   input_schema: JSONSchema7;
  }
```

**Testing**:
```bash
npm run typecheck
cd server && npm run test -- mcp
```

### Step 3.2: Plugin Router Registry (Day 2-3)

#### File: `server/services/plugin-router-registry.service.ts`

```diff
+ import type { Router } from 'express';

  export class PluginRouterRegistryService {
-   private pluginRouters: Map<string, any> = new Map();
-   private mergedRouter: any = null;
+   private pluginRouters: Map<string, Router> = new Map();
+   private mergedRouter: Router | null = null;

-   registerRouter(pluginId: string, pluginRouter: any): void {
+   registerRouter(pluginId: string, pluginRouter: Router): void {
      this.pluginRouters.set(pluginId, pluginRouter);
      this.mergedRouter = null;
    }

-   getPluginRouters(): Map<string, any> {
+   getPluginRouters(): Map<string, Router> {
      return this.pluginRouters;
    }

-   createMergedRouter(baseRouters: Record<string, any>): any {
+   createMergedRouter(baseRouters: Record<string, Router>): Router {
      const router = Router();

      // Merge all routers
      for (const [path, pluginRouter] of Object.entries(baseRouters)) {
        router.use(path, pluginRouter);
      }

      this.mergedRouter = router;
      return router;
    }
  }
```

**Testing**:
```bash
npm run typecheck
cd server && npm run test -- plugin-router
```

### Step 3.3: Organization Settings (Day 3-4)

#### File: `server/entities/organization.entity.ts`

```diff
+ import type { OrganizationSettings } from '@server/types/organization.types';

  @Entity("organizations")
  export class Organization {
    @Column({ type: 'jsonb', nullable: true })
-   settings!: Record<string, unknown> | null;
+   settings!: OrganizationSettings | null;
  }
```

#### File: `server/orchestrator/execution.layer.ts`

```diff
+ import type { OrganizationSettings } from '@server/types/organization.types';

  // Line 748, 771
- organization?.settings as Record<string, unknown>,
+ organization?.settings,
```

**Testing**:
```bash
npm run typecheck
cd server && npm run test -- organization
```

### Step 3.4: Plugin Configuration (Day 4-5)

#### File: `server/types/plugin.types.ts`

```diff
+ import type { PluginConfigValue, PluginInstanceConfig } from '@server/types/plugin-config.types';

  export interface HayPluginManifest {
    configSchema?: Record<
      string,
      {
        type: string;
        description?: string;
        label?: string;
        placeholder?: string;
        required?: boolean;
-       default?: unknown;
-       options?: Array<{ label: string; value: unknown }>;
+       default?: PluginConfigValue;
+       options?: Array<{ label: string; value: string | number | boolean }>;
        regex?: string;
        env?: string;
        encrypted?: boolean;
      }
    >;

    settingsExtensions?: Array<{
      slot: 'before-settings' | 'after-settings' | 'tab';
      component: string;
      tabName?: string;
      tabOrder?: number;
-     props?: Record<string, any>;
+     props?: Record<string, PluginConfigValue>;
    }>;
  }

- export interface PluginInstanceConfig {
-   [key: string]: any;
-   mcpServers?: MCPServersConfig;
- }
```

#### File: `server/services/plugin-runner-v2.service.ts`

```diff
+ import type { PluginInstanceConfig } from '@server/types/plugin-config.types';

  // Line 319
- orgConfig: Record<string, any>;
+ orgConfig: PluginInstanceConfig;
```

#### File: `server/services/plugin-ui.service.ts`

```diff
+ import type { PluginConfigValue } from '@server/types/plugin-config.types';

  export interface ConfigField {
    type: string;
    label: string;
    description?: string;
    required?: boolean;
-   default?: unknown;
-   options?: Array<{ label: string; value: unknown }>;
+   default?: PluginConfigValue;
+   options?: Array<{ label: string; value: string | number | boolean }>;
  }

  interface Props {
-   configuration: Record<string, any>;
+   configuration: Record<string, PluginConfigValue>;
  }

  interface Emits {
-   save: [config: Record<string, any>];
+   save: [config: Record<string, PluginConfigValue>];
  }

- const formData = ref<Record<string, any>>({ ...props.configuration });
+ const formData = ref<Record<string, PluginConfigValue>>({
+   ...props.configuration
+ });

- const validateField = (key: string, value: any) => {
+ const validateField = (key: string, value: PluginConfigValue): boolean => {
    // Type-safe validation
  };
```

**Testing**:
```bash
npm run typecheck
cd server && npm run test -- plugin-ui
cd server && npm run test -- plugin-runner
```

### Step 3.5: Execution Layer Types (Day 5-6)

#### File: `server/orchestrator/types.ts`

```diff
+ export interface HandoffFields {
+   priority?: 'low' | 'medium' | 'high' | 'urgent';
+   category?: string;
+   assignTo?: string;
+   tags?: string[];
+   customFields?: Record<string, string | number | boolean>;
+ }

+ export interface RetrievedDocument {
+   id: string;
+   title: string;
+   content: string;
+   source?: string;
+   metadata?: {
+     author?: string;
+     createdAt?: string;
+     tags?: string[];
+     [key: string]: string | number | boolean | string[] | undefined;
+   };
+ }
+
+ export interface DocumentWithSimilarity {
+   document: RetrievedDocument;
+   similarity: number;
+ }
```

#### File: `server/orchestrator/execution.layer.ts`

```diff
+ import type {
+   HandoffFields,
+   ToolArguments,
+   DocumentWithSimilarity
+ } from '@server/orchestrator/types';

  export interface ExecutionResult {
    step: "ASK" | "RESPOND" | "CALL_TOOL" | "HANDOFF" | "CLOSE";
    // ... existing fields

    tool?: {
      name: string;
-     args: Record<string, unknown>;
+     args: ToolArguments;
    };
    handoff?: {
      reason: string;
-     fields?: Record<string, unknown>;
+     fields?: HandoffFields;
    };
  }

  // Line 170
- let parsedArgs: Record<string, unknown> = {};
+ let parsedArgs: ToolArguments = {};

  // Line 505
- const retrievedDocs: Array<{ document: any; similarity: number }> = [];
+ const retrievedDocs: DocumentWithSimilarity[] = [];
```

**Testing**:
```bash
npm run typecheck
cd server && npm run test -- execution.layer
```

### Step 3.6: Remaining High Priority Items (Day 6-7)

#### MCP Registry Service

**File**: `server/services/mcp-registry.service.ts`

```diff
+ import type {
+   MCPServersConfig,
+   LocalMCPServerConfig,
+   RemoteMCPServerConfig,
+   MCPToolDefinition
+ } from '@server/types/plugin.types';
+ import type { MCPToolArguments, MCPCallResult } from '@server/types/mcp.types';

  // Line 79
- const data = await response.json() as { tools: any[] };
+ const data = await response.json() as { tools: MCPToolDefinition[] };

  // Line 103
- const mcpServers = instance.config.mcpServers as any;
+ const mcpServers = instance.config.mcpServers as MCPServersConfig;

  // Line 162-163
  async callTool(
    serverId: string,
    toolName: string,
-   args: Record<string, any>,
- ): Promise<any> {
+   args: MCPToolArguments,
+ ): Promise<MCPCallResult> {

  // Line 234-239
- const mcpServers = config.mcpServers as any;
+ const mcpServers = config.mcpServers as MCPServersConfig;

  if (mcpServers.local) {
-   mcpServers.local = mcpServers.local.filter((s: any) => s.serverId !== serverId);
+   mcpServers.local = mcpServers.local.filter(
+     (s: LocalMCPServerConfig) => s.serverId !== serverId
+   );
  }

  if (mcpServers.remote) {
-   mcpServers.remote = mcpServers.remote.filter((s: any) => s.serverId !== serverId);
+   mcpServers.remote = mcpServers.remote.filter(
+     (s: RemoteMCPServerConfig) => s.serverId !== serverId
+   );
  }
```

#### Plugin Metadata Validation

**File**: `server/services/plugin-metadata.service.ts`

```diff
+ import type { PluginMetadata, ConfigFieldDescriptor } from '@server/types/plugin-sdk.types';

- export function validateMetadata(metadata: any): metadata is PluginMetadata {
+ export function validateMetadata(metadata: unknown): metadata is PluginMetadata {
+   if (typeof metadata !== 'object' || metadata === null) {
+     return false;
+   }
+
+   const m = metadata as Record<string, unknown>;
+
+   // Validate structure
+   if (!m.configSchema || typeof m.configSchema !== 'object') return false;
+   if (!Array.isArray(m.authMethods)) return false;
+   if (!Array.isArray(m.uiExtensions)) return false;
+   if (!Array.isArray(m.routes)) return false;
+
+   // Validate config schema fields
+   for (const [key, value] of Object.entries(m.configSchema as Record<string, unknown>)) {
+     if (!isValidConfigField(value)) return false;
+   }
+
+   return true;
+ }
+
+ function isValidConfigField(field: unknown): field is ConfigFieldDescriptor {
+   if (typeof field !== 'object' || field === null) return false;
+
-   const f = field as any;
+   const f = field as Record<string, unknown>;
+
+   return (
+     typeof f.type === 'string' &&
+     ['string', 'number', 'boolean', 'json'].includes(f.type) &&
+     typeof f.label === 'string'
+   );
+ }
```

**Testing**:
```bash
npm run typecheck
cd server && npm run test -- mcp-registry
cd server && npm run test -- plugin-metadata
```

### Phase 3 Deliverable

✅ All 9 high-priority internal types fixed
✅ MCP system fully typed
✅ Plugin configuration typed
✅ Organization settings typed
✅ All tests passing

---

## Phase 4: Medium Priority Cleanup (Week 5)

**Goal**: Fix remaining 13 medium-priority type safety issues.

### Step 4.1: Error Handling Pattern (Day 1)

Create a standard error handling pattern across all services.

#### Create Error Utility

**File**: `server/utils/error-handler.ts`

```typescript
/**
 * Type-safe error handling utilities
 */

export function handleError(error: unknown, context: string): {
  message: string;
  stack?: string;
  name: string;
} {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      name: error.name,
    };
  }

  return {
    message: String(error),
    name: 'UnknownError',
  };
}

export function isErrorWithCode(error: unknown): error is Error & { code: string } {
  return error instanceof Error && 'code' in error;
}

export function isErrorWithStatus(error: unknown): error is Error & { status: number } {
  return error instanceof Error && 'status' in error;
}
```

#### Apply Pattern to All Services

**Files to update**:
- `server/services/plugin-runner-v2.service.ts:200,273`
- `server/services/mcp-registry.service.ts:98,202`
- `server/services/plugin-asset.service.ts:246`

```diff
+ import { handleError } from '@server/utils/error-handler';

  try {
    // ... code
- } catch (error: any) {
-   console.error('Error:', error.message);
+ } catch (error: unknown) {
+   const err = handleError(error, 'ServiceName.methodName');
+   console.error('Error:', err.message);
+   debugLog('service', 'Operation failed', {
+     level: 'error',
+     message: err.message,
+     stack: err.stack,
+   });
  }
```

**Testing**:
```bash
npm run typecheck
cd server && npm run test -- error-handler
```

### Step 4.2: Message Array Types (Day 2)

#### File: `server/orchestrator/conversation-utils.ts`

```diff
+ import type { Message } from '@server/database/entities/message.entity';

  export async function validateConversationClosure(
-   publicMessages: any[],
+   publicMessages: Message[],
    detectedIntent: string,
    hasActivePlaybook: boolean,
    conversationId?: string,
    organizationId?: string,
  ): Promise<{ shouldClose: boolean; reason: string }> {
```

#### File: `server/orchestrator/execution.layer.ts`

```diff
+ import type { Message } from '@server/database/entities/message.entity';

  // Line 680
  private someMethod(
-   messages: any[],
+   messages: Message[],
  ) {
```

**Testing**:
```bash
npm run typecheck
cd server && npm run test -- conversation-utils
```

### Step 4.3: Plugin SDK v2 Types (Day 3)

#### File: `server/types/plugin-sdk.types.ts`

```diff
+ import type { CredentialValue } from '@server/types/plugin-config.types';

  export interface AuthState {
    methodId: string;
-   credentials: Record<string, any>;
+   credentials: Record<string, CredentialValue>;
  }

  export interface ConfigFieldDescriptor {
    type: "string" | "number" | "boolean" | "json";
    label: string;
    description?: string;
    required?: boolean;
    encrypted?: boolean;
-   default?: any;
+   default?: string | number | boolean | null;
    env?: string;
    validation?: {
      min?: number;
      max?: number;
      pattern?: string;
-     enum?: any[];
+     enum?: Array<string | number | boolean>;
    };
  }
```

**Testing**:
```bash
npm run typecheck
```

### Step 4.4: Webhook Types (Day 4)

#### File: `server/types/plugin.types.ts`

```diff
+ export type WebhookBody =
+   | string
+   | Record<string, PluginConfigValue>
+   | PluginConfigValue[];

  export interface WebhookRequest {
    method: string;
    path: string;
    headers: Record<string, string>;
-   body: any;
+   body: WebhookBody;
    query: Record<string, string>;
  }

  export interface WebhookResponse {
    status: number;
    headers?: Record<string, string>;
-   body?: any;
+   body?: WebhookBody;
  }
```

**Testing**:
```bash
npm run typecheck
cd server && npm run test -- webhook
```

### Step 4.5: Plugin Upload Service (Day 5)

#### File: `server/services/plugin-upload.service.ts`

```diff
+ import type { JSONSchemaType } from 'ajv';
+ import type { HayPluginManifest } from '@server/types/plugin.types';

  class PluginUploadService {
-   private manifestSchema: any;
+   private manifestSchema: JSONSchemaType<HayPluginManifest>;

    constructor() {
-     this.manifestSchema = require('../path/to/manifest.schema.json');
+     this.manifestSchema = require('../../plugins/base/plugin-manifest.schema.json');
    }

    // Remove all `as any` casts - let TypeScript validate
    async uploadPlugin(file: File): Promise<PluginRegistry> {
-     const plugin = {
-       // ...
-     } as any;

+     const plugin: Partial<PluginRegistry> = {
+       // TypeScript will validate fields
+     };

-     manifest: manifest as any,
+     manifest,
    }
  }
```

**Testing**:
```bash
npm run typecheck
cd server && npm run test -- plugin-upload
```

### Step 4.6: Final Cleanup (Day 6-7)

#### Plugin Route Service

**File**: `server/services/plugin-route.service.ts`

```diff
+ import type { PluginConfigValue } from '@server/types/plugin-config.types';

  async handleRequest(
    req: Request,
-   body: unknown,
+   body: Record<string, PluginConfigValue> | PluginConfigValue[] | string,
  ) {
```

#### Plugin Runner V2

**File**: `server/services/plugin-runner-v2.service.ts`

```diff
  // Line 86, 115, 157
- } as any);
+ });

  // Line 158 - This is actually correct! Health status can be "unknown"
  code === 0 ? "unknown" : "unhealthy"  // ✅ Keep as is
```

#### Plugin Tools Service

**File**: `server/services/plugin-tools.service.ts`

```diff
+ import type { PluginInstanceConfig } from '@server/types/plugin-config.types';

  // Line 143
- const config = (instance.config as any) || {};
+ const config = instance.config || {} as PluginInstanceConfig;
```

**Testing**:
```bash
npm run typecheck
cd server && npm run test
```

### Phase 4 Deliverable

✅ All 13 medium-priority issues resolved
✅ Consistent error handling pattern
✅ No remaining `any` types in core systems
✅ All tests passing

---

## Testing Strategy

### Unit Tests

For each changed file, ensure existing unit tests pass:

```bash
# Test specific service
npm run test -- plugin-manager.service.test.ts

# Test with coverage
npm run test:coverage
```

### Integration Tests

Test cross-module interactions:

```bash
# Orchestrator integration tests
npm run test:integration -- orchestrator

# Plugin system integration
npm run test:integration -- plugins

# WebSocket integration
npm run test:integration -- websocket
```

### Type Regression Tests

Create a type test file to ensure types remain strict:

**File**: `server/tests/types/type-safety.test.ts`

```typescript
import { expectType, expectError } from 'tsd';
import type { ConversationContext } from '@server/orchestrator/types';
import type { WebSocketMessage } from '@server/types/websocket.types';
import type { PluginInstanceConfig } from '@server/types/plugin-config.types';

// Test: Orchestration status is properly typed
expectType<ConversationContext | null>({
  version: "v1",
  lastTurn: 0,
  toolLog: [],
});

// Test: WebSocket messages are discriminated unions
const chatMessage: WebSocketMessage = {
  type: 'chat',
  content: 'Hello',
};
expectType<WebSocketMessage>(chatMessage);

// Test: Invalid message type should error
expectError<WebSocketMessage>({
  type: 'invalid',
  content: 'Test',
});

// Test: Plugin config accepts valid values
const config: PluginInstanceConfig = {
  apiKey: 'test',
  enabled: true,
  retryCount: 3,
};
expectType<PluginInstanceConfig>(config);
```

Run type tests:
```bash
npm run test:types
```

### Manual Testing Checklist

- [ ] Create a new conversation - orchestration status persists correctly
- [ ] Connect via WebSocket - messages are properly typed
- [ ] Install a plugin - manifest validation works
- [ ] Configure plugin OAuth - token storage typed correctly
- [ ] Execute MCP tool - arguments and results typed
- [ ] View organization settings - settings structure validated

---

## Rollback Plan

### Git Strategy

```bash
# Each phase is a separate branch
git checkout -b type-safety/phase-1-foundation
# ... complete phase 1
git commit -m "feat: Phase 1 - Foundation types"

git checkout -b type-safety/phase-2-critical
# ... complete phase 2
git commit -m "feat: Phase 2 - Critical cross-module boundaries"

# If issues arise, rollback specific phase
git checkout main
git revert <phase-commit-hash>
```

### Feature Flags

For critical changes (Phase 2), consider feature flags:

```typescript
// server/config/feature-flags.ts
export const FEATURE_FLAGS = {
  TYPE_SAFE_ORCHESTRATION: process.env.TYPE_SAFE_ORCHESTRATION === 'true',
};

// In code
if (FEATURE_FLAGS.TYPE_SAFE_ORCHESTRATION) {
  // Use new typed approach
} else {
  // Use legacy approach
}
```

### Database Migrations

**No database migrations needed!** All changes are to JSONB field types in TypeScript only. Database schema remains unchanged.

### Monitoring

After each phase deployment:

```bash
# Monitor error rates
# No increase in runtime errors expected (type-only changes)

# Monitor TypeScript compilation
npm run typecheck  # Should complete without errors

# Monitor test suite
npm run test  # All tests should pass
```

---

## Success Metrics

### Quantitative Metrics

| Metric | Before | Target | Validation |
|--------|--------|--------|------------|
| `any` count in core systems | 44 | 0 | `grep -r "as any" server/{orchestrator,services}` |
| `unknown` without type guard | 15+ | 0 | Manual code review |
| Type errors on build | 0 | 0 | `npm run typecheck` |
| Test coverage | ~75% | >75% | `npm run test:coverage` |
| Build time | X seconds | ±5% | CI/CD metrics |

### Qualitative Metrics

- [ ] **Developer Experience**: IDE autocomplete works for all typed structures
- [ ] **Code Review**: Type errors caught in PR reviews, not in production
- [ ] **Documentation**: Types serve as inline documentation (e.g., `OrganizationSettings`)
- [ ] **Refactoring Safety**: Can refactor with confidence due to compile-time checks

### Validation Commands

```bash
# Count remaining 'any' types
rg ":\s*any" --type ts server/{orchestrator,services} | wc -l
# Target: 0

# Count 'as any' casts
rg "as any" --type ts server/{orchestrator,services} | wc -l
# Target: 0

# Check type coverage
npm run typecheck -- --noEmit --pretty
# Target: No errors

# Test coverage
npm run test:coverage
# Target: >75% coverage maintained
```

---

## Post-Migration Tasks

### Documentation Updates

1. Update `docs/PLUGIN_API.md` with new type definitions
2. Update `CLAUDE.md` with type safety guidelines
3. Create `docs/TYPE_DEFINITIONS_GUIDE.md` explaining new types

### Developer Onboarding

1. Add type examples to developer documentation
2. Create VSCode snippets for common patterns:
   ```json
   {
     "WebSocket Message": {
       "prefix": "ws-msg",
       "body": [
         "const message: WebSocketMessage = {",
         "  type: '$1',",
         "  $2",
         "};"
       ]
     }
   }
   ```

### CI/CD Integration

Add to CI pipeline:

```yaml
# .github/workflows/typecheck.yml
name: Type Safety Check
on: [pull_request]
jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run typecheck
      - name: Check for any types
        run: |
          ANY_COUNT=$(rg "as any" --type ts server/ | wc -l)
          if [ $ANY_COUNT -gt 0 ]; then
            echo "Found $ANY_COUNT 'as any' casts"
            exit 1
          fi
```

---

## Timeline Summary

| Week | Phase | Effort | Risk |
|------|-------|--------|------|
| 1 | Foundation Types | 1-2 days | Low |
| 2 | Critical Cross-Module | 3-4 days | Medium |
| 3-4 | High Priority Internal | 8-10 days | Low-Medium |
| 5 | Medium Priority Cleanup | 4-5 days | Low |
| 6 | Validation & Documentation | 2-3 days | Low |

**Total**: ~5-6 weeks (20-25 business days)

---

## Questions & Answers

### Q: Will this break existing code?
**A**: No. These are type-only changes. Runtime behavior is identical.

### Q: Do we need database migrations?
**A**: No. All changes are to TypeScript types for JSONB columns.

### Q: What if a type doesn't match reality?
**A**: The migration will expose it immediately via TypeScript errors. This is a good thing - it catches bugs before production.

### Q: Can we do this faster?
**A**: Yes, phases can run in parallel if multiple developers work on it. Critical phase (Week 2) must complete before Week 3-4.

### Q: What about plugin compatibility?
**A**: Plugins use the same types. SDK v2 plugins already return typed metadata. SDK v1 plugins will benefit from the new manifest types.

---

## Conclusion

This migration eliminates 44 type safety issues across core systems while maintaining 100% backward compatibility. The phased approach minimizes risk and allows for incremental validation.

**Key Benefits**:
- ✅ Type safety at module boundaries
- ✅ Better IDE autocomplete and error messages
- ✅ Catches bugs at compile time instead of runtime
- ✅ Serves as living documentation
- ✅ Enables safer refactoring

**Next Steps**:
1. Review and approve this migration strategy
2. Create tracking issues for each phase
3. Begin Phase 1: Foundation Types

---

**Document Version**: 1.0
**Last Updated**: 2025-12-25
**Owner**: Engineering Team
**Status**: Pending Approval
