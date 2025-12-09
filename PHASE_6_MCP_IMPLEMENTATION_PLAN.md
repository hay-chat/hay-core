# Phase 6: MCP Support Implementation Plan

**Goal**: Implement MCP (Model Context Protocol) registration endpoints to enable migration of existing plugins.

**Status**: 🔲 Not Started
**Started**: December 9, 2025
**Estimated Complexity**: High (multiple subsystems, subprocess management, tool registration)

---

## Overview

All 7 existing core plugins (email, attio, hubspot, judo-in-cloud, shopify, stripe, zendesk) are MCP-only plugins. They need MCP server support to function. Currently, the Plugin API has placeholder endpoints that just log and return success.

**Current State**:

- `mcp.registerLocal` endpoint exists but is a TODO (line 368 in `server/routes/v1/plugin-api/trpc.ts`)
- `mcp.registerRemote` endpoint exists but is a TODO (line 410)
- No MCP subprocess management
- No tool registration with agent system

**Target State**:

- Plugins can register local MCP servers (stdio/subprocess)
- Plugins can register remote MCP servers (HTTP/SSE)
- MCP servers are managed as subprocesses
- MCP tools are registered with agent system
- Tools are callable from AI agents

---

## Architecture Design

### MCP Server Types

**1. Local MCP Server (stdio)**

- Runs as subprocess alongside plugin worker
- Communication via stdin/stdout
- Managed by plugin worker process
- Example: Email plugin's MCP server

**2. Remote MCP Server (HTTP/SSE)**

- Runs independently (external service)
- Communication via HTTP or Server-Sent Events
- Connection validated on registration
- Example: External API-based MCP servers

### Component Architecture

```
Plugin Worker Process
  ├── HayPlugin (Express server)
  │   ├── HTTP routes
  │   └── Plugin SDK client
  │
  └── MCP Server Manager
      ├── Local MCP subprocess(es)
      │   ├── stdin/stdout communication
      │   └── Process lifecycle
      │
      └── Remote MCP connection(s)
          └── HTTP/SSE client

Main App
  ├── Plugin API (receives MCP registration)
  ├── MCP Registry (stores tool definitions)
  └── Agent System (uses MCP tools)
```

### Data Flow

```
1. Plugin Registration:
   Plugin Worker -> sdk.registerLocalMCP() -> Plugin API -> Store in DB

2. Tool Discovery:
   Agent System -> MCP Registry -> Get tool list

3. Tool Execution:
   Agent -> Plugin API -> Plugin Worker -> MCP Server -> Result
```

---

## Implementation Phases

### Phase 6.1: Database Schema (30 min)

- [ ] Design MCP configuration storage
- [ ] Create migration for MCP-related fields
- [ ] Run migration

### Phase 6.2: MCP Server Manager (2-3 hours)

- [ ] Create `MCPServerManager` class
- [ ] Implement local MCP subprocess spawning
- [ ] Implement remote MCP connection
- [ ] Add health checks for MCP servers
- [ ] Add cleanup on worker shutdown

### Phase 6.3: Plugin API Endpoints (1-2 hours)

- [ ] Implement `mcp.registerLocal` endpoint
- [ ] Implement `mcp.registerRemote` endpoint
- [ ] Add tool definition validation
- [ ] Add error handling

### Phase 6.4: Plugin SDK Helpers (1 hour)

- [ ] Add `sdk.registerLocalMCP()` method
- [ ] Add `sdk.registerRemoteMCP()` method
- [ ] Update PluginSDK types

### Phase 6.5: Tool Registry Integration (2 hours)

- [ ] Create MCP tool registry service
- [ ] Store tool definitions in database
- [ ] Make tools available to agent system
- [ ] Add tool routing logic

### Phase 6.6: Testing & Validation (1-2 hours)

- [ ] Create test MCP server
- [ ] Test local MCP registration
- [ ] Test remote MCP registration
- [ ] Test tool execution
- [ ] Migrate email plugin as proof of concept

**Total Estimated Time**: 7-10 hours

---

## Detailed Task Breakdown

### ✅ Phase 6.1: Database Schema

**Goal**: Store MCP configuration in database

#### Task 6.1.1: Design Schema

Determine where to store MCP configuration:

- **Option A**: Add `mcpServers` field to `plugin_instances.config` (JSONB)
- **Option B**: Create new `mcp_servers` table
- **Recommendation**: Option A (simpler, follows existing pattern)

**Schema Design**:

```typescript
interface PluginInstanceConfig {
  // Existing config fields...
  mcpServers?: {
    local?: {
      serverPath: string;
      startCommand: string;
      installCommand?: string;
      buildCommand?: string;
      tools: MCPToolDefinition[];
      env?: Record<string, string>;
    }[];
    remote?: {
      url: string;
      transport: "http" | "sse" | "websocket";
      auth?: {
        type: "bearer" | "apiKey";
        token?: string;
        apiKey?: string;
      };
      tools: MCPToolDefinition[];
    }[];
  };
}

interface MCPToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, any>;
}
```

#### Task 6.1.2: Create Migration

```bash
cd server
npm run migration:create -- ./database/migrations/AddMCPSupportToPluginInstances
```

Migration should:

- Add comment documenting `mcpServers` field in `plugin_instances.config`
- Update any relevant documentation

#### Task 6.1.3: Run Migration

```bash
npm run migration:run
```

---

### ✅ Phase 6.2: MCP Server Manager

**Goal**: Manage MCP server subprocesses within plugin workers

**Location**: `packages/plugin-sdk/src/MCPServerManager.ts`

#### Task 6.2.1: Create MCPServerManager Class

```typescript
export class MCPServerManager {
  private localServers: Map<string, ChildProcess> = new Map();
  private remoteClients: Map<string, MCPClient> = new Map();

  constructor(private config: MCPManagerConfig) {}

  // Lifecycle
  async initialize(): Promise<void>;
  async shutdown(): Promise<void>;

  // Local MCP
  async startLocalServer(config: LocalMCPConfig): Promise<void>;
  async stopLocalServer(serverId: string): Promise<void>;

  // Remote MCP
  async connectRemoteServer(config: RemoteMCPConfig): Promise<void>;
  async disconnectRemoteServer(serverId: string): Promise<void>;

  // Health & Status
  async healthCheck(serverId: string): Promise<boolean>;
  getServerStatus(serverId: string): ServerStatus;

  // Tool Execution
  async callTool(serverId: string, toolName: string, args: any): Promise<any>;
}
```

**Key Features**:

- Spawn local MCP servers as child processes
- Manage stdin/stdout communication
- Handle server crashes and restarts
- Connect to remote MCP servers
- Validate connections
- Execute tools

#### Task 6.2.2: Implement Local MCP Spawning

**Algorithm**:

1. Check if server path exists
2. Run install/build commands if specified
3. Spawn process with `child_process.spawn()`
4. Set up stdin/stdout communication
5. Wait for server ready signal
6. Store process in map

**Error Handling**:

- Server path not found
- Install/build fails
- Process crashes on startup
- Communication timeout

#### Task 6.2.3: Implement Remote MCP Connection

**Algorithm**:

1. Parse server URL
2. Create HTTP/SSE client
3. Set up authentication
4. Test connection with ping/health check
5. Store client in map

**Error Handling**:

- Invalid URL
- Connection refused
- Authentication failure
- Protocol mismatch

#### Task 6.2.4: Add Health Checks

- Local: Check process is alive, test stdin/stdout
- Remote: HTTP ping or SSE connection status
- Schedule periodic health checks (every 30s)
- Auto-restart on failure (with backoff)

#### Task 6.2.5: Integrate with HayPlugin

Update `HayPlugin` base class:

```typescript
export abstract class HayPlugin {
  protected mcpManager?: MCPServerManager;

  protected async initializeMCP(): Promise<void> {
    if (this.metadata.capabilities.includes("mcp")) {
      this.mcpManager = new MCPServerManager({
        workingDir: process.cwd(),
        logger: console,
      });
      await this.mcpManager.initialize();
    }
  }

  async _stop(): Promise<void> {
    if (this.mcpManager) {
      await this.mcpManager.shutdown();
    }
    // ... existing shutdown logic
  }
}
```

---

### ✅ Phase 6.3: Plugin API Endpoints

**Goal**: Implement MCP registration endpoints in Plugin API

**Location**: `server/routes/v1/plugin-api/trpc.ts` (lines 368-445)

#### Task 6.3.1: Implement `mcp.registerLocal`

**Input Schema**:

```typescript
z.object({
  serverId: z.string().optional(), // Auto-generate if not provided
  serverPath: z.string(),
  startCommand: z.string(),
  installCommand: z.string().optional(),
  buildCommand: z.string().optional(),
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      input_schema: z.record(z.any()),
    }),
  ),
  env: z.record(z.string()).optional(),
});
```

**Implementation Steps**:

1. Validate input
2. Get plugin instance from context
3. Update plugin instance config with MCP server definition
4. Save to database
5. Register tools in MCP registry
6. Return success with server ID

**Response**:

```typescript
{
  success: true;
  serverId: string;
  toolsRegistered: number;
}
```

#### Task 6.3.2: Implement `mcp.registerRemote`

**Input Schema**:

```typescript
z.object({
  serverId: z.string().optional(),
  url: z.string().url(),
  transport: z.enum(["http", "sse", "websocket"]),
  auth: z
    .object({
      type: z.enum(["bearer", "apiKey"]),
      token: z.string().optional(),
      apiKey: z.string().optional(),
    })
    .optional(),
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      input_schema: z.record(z.any()),
    }),
  ),
});
```

**Implementation Steps**:

1. Validate input
2. Test connection to remote server
3. Get plugin instance from context
4. Update plugin instance config
5. Save to database
6. Register tools in MCP registry
7. Return success

#### Task 6.3.3: Add Error Handling

**Common Errors**:

- Invalid server path (local)
- Connection failed (remote)
- Duplicate server ID
- Invalid tool schema
- Database save failure

---

### ✅ Phase 6.4: Plugin SDK Helpers

**Goal**: Add convenience methods to Plugin SDK for MCP registration

**Location**: `packages/plugin-sdk/src/PluginSDK.ts`

#### Task 6.4.1: Add `registerLocalMCP()` Method

```typescript
export class PluginSDK {
  // ... existing methods

  /**
   * Register a local MCP server (runs as subprocess)
   */
  async registerLocalMCP(config: {
    serverId?: string;
    serverPath: string;
    startCommand: string;
    installCommand?: string;
    buildCommand?: string;
    tools: MCPToolDefinition[];
    env?: Record<string, string>;
  }): Promise<{ success: boolean; serverId: string }> {
    this.requireCapability("mcp");

    const response = await fetch(`${this.config.apiUrl}/plugin-api/mcp/register-local`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiToken}`,
      },
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      throw new Error(`Failed to register local MCP: ${response.statusText}`);
    }

    return response.json();
  }
}
```

#### Task 6.4.2: Add `registerRemoteMCP()` Method

Similar implementation for remote MCP servers.

#### Task 6.4.3: Update Types

Add to `packages/plugin-sdk/src/types.ts`:

```typescript
export interface LocalMCPConfig {
  serverId?: string;
  serverPath: string;
  startCommand: string;
  installCommand?: string;
  buildCommand?: string;
  tools: MCPToolDefinition[];
  env?: Record<string, string>;
}

export interface RemoteMCPConfig {
  serverId?: string;
  url: string;
  transport: "http" | "sse" | "websocket";
  auth?: {
    type: "bearer" | "apiKey";
    token?: string;
    apiKey?: string;
  };
  tools: MCPToolDefinition[];
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, any>;
}
```

---

### ✅ Phase 6.5: Tool Registry Integration

**Goal**: Make MCP tools available to AI agents

**Location**: Create `server/services/mcp-tool-registry.service.ts`

#### Task 6.5.1: Create MCP Tool Registry Service

```typescript
export class MCPToolRegistryService {
  /**
   * Register tools from MCP server
   */
  async registerTools(
    organizationId: string,
    pluginId: string,
    serverId: string,
    tools: MCPToolDefinition[],
  ): Promise<void>;

  /**
   * Get all tools available for an organization
   */
  async getToolsForOrganization(organizationId: string): Promise<MCPTool[]>;

  /**
   * Get specific tool definition
   */
  async getTool(organizationId: string, toolName: string): Promise<MCPTool | null>;

  /**
   * Execute a tool
   */
  async executeTool(
    organizationId: string,
    toolName: string,
    args: Record<string, any>,
  ): Promise<any>;

  /**
   * Unregister tools (when plugin disabled or MCP server removed)
   */
  async unregisterTools(organizationId: string, pluginId: string, serverId: string): Promise<void>;
}
```

**Storage**:

```typescript
interface MCPTool {
  id: string;
  organizationId: string;
  pluginId: string;
  serverId: string;
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  createdAt: Date;
}
```

Store in `plugin_instances.config.mcpServers[].tools` (no new table needed).

#### Task 6.5.2: Integrate with Agent System

Update orchestrator to include MCP tools:

```typescript
// In server/orchestrator/execution.layer.ts
const mcpTools = await mcpToolRegistry.getToolsForOrganization(organizationId);
const tools = [...builtInTools, ...mcpTools];
```

#### Task 6.5.3: Tool Execution Routing

When agent calls a tool:

1. Check if it's an MCP tool
2. Look up which plugin/server provides it
3. Route to Plugin API
4. Plugin API calls plugin worker
5. Plugin worker calls MCP server
6. Return result to agent

---

### ✅ Phase 6.6: Testing & Validation

**Goal**: Validate MCP implementation works end-to-end

#### Task 6.6.1: Create Test MCP Server

Create `plugins/test/simple-mcp/`:

- Simple MCP server with 2-3 test tools
- Implements MCP protocol via stdio
- Example tools: echo, add, getCurrentTime

#### Task 6.6.2: Test Local MCP Registration

1. Create test plugin that registers local MCP server
2. Start worker
3. Verify MCP subprocess spawned
4. Verify tools registered
5. Call tool via agent
6. Verify result

#### Task 6.6.3: Test Remote MCP Registration

1. Start mock remote MCP server
2. Create test plugin that registers it
3. Verify connection established
4. Verify tools registered
5. Call tool via agent
6. Verify result

#### Task 6.6.4: Migrate Email Plugin

**Email plugin** is the simplest real plugin to migrate:

- MCP-only (no routes)
- Has 2 tools: healthcheck, send-email
- Good proof of concept

**Migration steps**:

1. Install `@hay/plugin-sdk`
2. Create `src/index.ts`:

   ```typescript
   import { HayPlugin, startPluginWorker } from "@hay/plugin-sdk";

   class EmailPlugin extends HayPlugin {
     constructor() {
       super({
         id: "email",
         name: "Email",
         version: "1.0.0",
         capabilities: ["mcp"],
       });
     }

     async onInitialize(): Promise<void> {
       await this.sdk.registerLocalMCP({
         serverPath: "./mcp",
         startCommand: "node index.js",
         tools: [
           {
             name: "healthcheck",
             description: "Check email service health",
             input_schema: {},
           },
           {
             name: "send-email",
             description: "Send an email",
             input_schema: {
               type: "object",
               properties: {
                 to: { type: "string" },
                 subject: { type: "string" },
                 body: { type: "string" },
               },
               required: ["to", "subject", "body"],
             },
           },
         ],
       });
     }
   }

   startPluginWorker(EmailPlugin);
   ```

3. Build and test
4. Verify MCP server starts
5. Test sending email via agent

#### Task 6.6.5: Update Documentation

- Update `PLUGIN_ARCHITECTURE_PROGRESS.md` - Mark Phase 6 complete
- Update `docs/PLUGIN_API.md` - Document MCP endpoints
- Create migration guide for MCP plugins

---

## Success Criteria

- [x] Database schema supports MCP configuration
- [x] MCPServerManager can spawn/manage local MCP servers
- [x] MCPServerManager can connect to remote MCP servers
- [x] Plugin API endpoints accept MCP registrations
- [x] Plugin SDK provides helper methods
- [x] Tools are registered in registry
- [x] Agents can discover MCP tools
- [x] Agents can execute MCP tools
- [x] Email plugin migrated and working
- [x] Zero errors in logs
- [x] Tests pass

---

## Potential Issues & Solutions

### Issue 1: MCP Server Crashes

**Problem**: MCP subprocess dies unexpectedly
**Solution**:

- Implement auto-restart with exponential backoff
- Log errors for debugging
- Mark tools as unavailable during downtime

### Issue 2: Tool Namespace Collisions

**Problem**: Two plugins provide tool with same name
**Solution**:

- Prefix tool names with plugin ID: `email.send-email`
- Validate uniqueness on registration
- Return error if collision detected

### Issue 3: MCP Communication Timeout

**Problem**: Tool execution takes too long
**Solution**:

- Set reasonable timeout (30s for MCP calls)
- Return timeout error to agent
- Agent can retry if appropriate

### Issue 4: Environment Variable Conflicts

**Problem**: MCP server needs env vars that conflict with worker
**Solution**:

- Isolate MCP server env vars
- Pass explicit env object to child process
- Don't inherit all worker env vars

### Issue 5: Port Conflicts (Remote MCP)

**Problem**: Remote MCP server connection uses ports
**Solution**:

- Use HTTP client (no port binding needed on client side)
- Handle connection pooling
- Implement connection reuse

---

## Files to Create/Modify

### New Files

- [ ] `packages/plugin-sdk/src/MCPServerManager.ts` (~300 lines)
- [ ] `server/services/mcp-tool-registry.service.ts` (~200 lines)
- [ ] `server/database/migrations/TIMESTAMP-AddMCPSupportToPluginInstances.ts` (~50 lines)
- [ ] `plugins/test/simple-mcp/` (test MCP server)

### Modified Files

- [ ] `packages/plugin-sdk/src/HayPlugin.ts` (add MCP manager integration)
- [ ] `packages/plugin-sdk/src/PluginSDK.ts` (add registerLocalMCP, registerRemoteMCP)
- [ ] `packages/plugin-sdk/src/types.ts` (add MCP types)
- [ ] `server/routes/v1/plugin-api/trpc.ts` (implement mcp.registerLocal, mcp.registerRemote)
- [ ] `server/orchestrator/execution.layer.ts` (integrate MCP tools)
- [ ] `plugins/core/email/src/index.ts` (migrate to TypeScript-first)

---

## Testing Checklist

### Unit Tests

- [ ] MCPServerManager spawns local server correctly
- [ ] MCPServerManager handles server crashes
- [ ] MCPServerManager connects to remote server
- [ ] Tool registry stores/retrieves tools
- [ ] Tool execution routes correctly

### Integration Tests

- [ ] Local MCP registration end-to-end
- [ ] Remote MCP registration end-to-end
- [ ] Tool execution via agent
- [ ] Worker cleanup kills MCP subprocesses
- [ ] Multiple MCP servers in one plugin

### Manual Tests

- [ ] Email plugin works after migration
- [ ] Email tools appear in agent tool list
- [ ] Agent can send email via tool
- [ ] MCP server restart on crash
- [ ] Health checks report status correctly

---

## Rollout Plan

1. **Phase 6.1-6.5**: Build infrastructure (no production impact)
2. **Phase 6.6**: Test with email plugin (staging only)
3. **Validate**: Run for 24 hours, monitor logs
4. **Migrate**: One plugin at a time (email → attio → hubspot → etc.)
5. **Monitor**: Check for errors, performance issues

---

## Notes

- MCP protocol: https://github.com/modelcontextprotocol/specification
- Keep MCP servers simple - they're just tool providers
- Plugin workers manage MCP lifecycle, not main app
- Each worker can have multiple MCP servers
- Tools are namespaced by plugin to avoid collisions

---

## Progress Tracking

Update this section as you complete tasks:

- [ ] Phase 6.1: Database Schema
- [ ] Phase 6.2: MCP Server Manager
- [ ] Phase 6.3: Plugin API Endpoints
- [ ] Phase 6.4: Plugin SDK Helpers
- [ ] Phase 6.5: Tool Registry Integration
- [ ] Phase 6.6: Testing & Validation

**Next Action**: Start with Phase 6.1 - Database Schema
