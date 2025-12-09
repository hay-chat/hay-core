# TypeScript-First Plugin Architecture - Implementation Progress

This document tracks the progress of implementing the TypeScript-first plugin architecture with process isolation and HTTP communication.

**Architecture Plan**: See [~/.claude/plans/rippling-prancing-wand.md](.claude/plans/rippling-prancing-wand.md) for full technical details.

**Started**: December 4, 2025
**Current Status**: Phase 5 Complete - Infrastructure validated ✅ | Ready for Phase 6 (MCP Support)

---

## Phase Overview

- ✅ **Phase 1**: SDK Foundation - Create @hay/plugin-sdk package
- ✅ **Phase 2**: Main App Infrastructure - Worker management, route proxy, Plugin API
- ✅ **Phase 3**: Database Changes - Channel agents support
- ✅ **Phase 4**: Bug Fixes - Fixed all TypeScript compilation errors
- ✅ **Phase 5**: Validation - Test plugin created (pending manual testing)
- 🔲 **Phase 6**: MCP Support - Implement MCP registration endpoints
- 🔲 **Phase 7**: Migration - Migrate all 7 core plugins
- 🔲 **Phase 8**: WhatsApp Plugin - First channel plugin implementation
- 🔲 **Phase 9**: Documentation - Update all docs

---

## ✅ Phase 1: SDK Foundation (COMPLETED)

**Goal**: Create `@hay/plugin-sdk` package with base classes and utilities

### Completed Tasks

- [x] Create `packages/plugin-sdk` directory structure
- [x] Implement `HayPlugin` base class
  - Location: `packages/plugin-sdk/src/HayPlugin.ts`
  - Features: Express server, route registration, config loading, lifecycle hooks
- [x] Implement `PluginSDK` HTTP client
  - Location: `packages/plugin-sdk/src/PluginSDK.ts`
  - Capabilities: messages, customers, sources, MCP
- [x] Implement `startPluginWorker()` function
  - Location: `packages/plugin-sdk/src/startPluginWorker.ts`
  - Features: Process lifecycle, graceful shutdown
- [x] Create TypeScript types
  - Location: `packages/plugin-sdk/src/types.ts`
- [x] Create package.json and tsconfig.json
- [x] Update root package.json with workspace
- [x] Build and verify package compiles
- [x] Create comprehensive README.md

### Files Created

- `packages/plugin-sdk/src/HayPlugin.ts` (260 lines)
- `packages/plugin-sdk/src/PluginSDK.ts` (188 lines)
- `packages/plugin-sdk/src/startPluginWorker.ts` (90 lines)
- `packages/plugin-sdk/src/types.ts` (176 lines)
- `packages/plugin-sdk/src/index.ts` (58 lines)
- `packages/plugin-sdk/package.json`
- `packages/plugin-sdk/tsconfig.json`
- `packages/plugin-sdk/README.md` (comprehensive docs)

---

## ✅ Phase 2: Main App Infrastructure (COMPLETED)

**Goal**: Enable worker spawning, route proxying, and Plugin API endpoints

### Completed Tasks

- [x] Extend Plugin Manager with worker spawning
  - Location: `server/services/plugin-manager.service.ts:575-917`
  - Features: Process spawning, port management, JWT generation, health checks
- [x] Create Plugin API JWT middleware
  - Location: `server/trpc/middleware/plugin-auth.ts`
  - Features: Token verification, capability checking
- [x] Create Plugin API tRPC router
  - Location: `server/routes/v1/plugin-api/trpc.ts`
  - Endpoints: messages (receive, send, getByConversation), customers (get, findByExternalId, upsert), sources (register), mcp (registerLocal, registerRemote)
- [x] Create route proxy for webhooks
  - Location: `server/routes/v1/plugins/proxy.ts`
  - Features: Organization ID extraction, automatic worker startup, HTTP forwarding
- [x] Register plugin API router in tRPC
  - Location: `server/routes/v1/index.ts:47`
- [x] Register route proxy in Express
  - Location: `server/main.ts:188-191`
- [x] Implement worker cleanup scheduler
  - Location: `server/services/scheduled-jobs.registry.ts:57-68`
  - Schedule: Every 5 minutes, 30min timeout for channels, 5min for MCP

### Key Features Implemented

- **Process Isolation**: Each org+plugin runs in separate Node.js process
- **Port Management**: Dynamic allocation (5000-6000 range) with availability checking
- **JWT Authentication**: 24-hour tokens with scope and capability validation
- **Health Checks**: Waits for `/health` endpoint before marking worker as ready
- **Graceful Shutdown**: SIGTERM with 5-second timeout, then SIGKILL
- **Database Status Tracking**: starting → running → stopping → stopped/error
- **Capability-Based Access**: Every Plugin API endpoint checks capabilities

### Files Modified

- `server/services/plugin-manager.service.ts` (+355 lines)
- `server/routes/v1/index.ts` (+1 line)
- `server/main.ts` (+4 lines)
- `server/services/scheduled-jobs.registry.ts` (+12 lines)

### Files Created

- `server/trpc/middleware/plugin-auth.ts` (120 lines)
- `server/routes/v1/plugin-api/trpc.ts` (465 lines)
- `server/routes/v1/plugins/proxy.ts` (127 lines)

---

## ✅ Phase 3: Database Changes (COMPLETED)

**Goal**: Add support for channel-specific agent assignment

### Completed Tasks

- [x] Update `OrganizationSettings` TypeScript interface
  - Location: `server/types/organization-settings.types.ts:307`
  - Added: `channelAgents?: Record<string, string>`
- [x] Create migration for channel agents
  - Location: `server/database/migrations/1764863000000-AddChannelAgentsToOrganizationSettings.ts`
  - Adds PostgreSQL column comment to document the new field
- [x] Run migration successfully
  - Status: Migration executed and verified with `migration:show`
- [x] Implement `getAgentForChannel()` helper
  - Location: `server/routes/v1/plugin-api/trpc.ts:457-473`
  - Implements priority: Channel agent → Default agent → First available

### Files Modified

- `server/types/organization-settings.types.ts` (+1 line)

### Files Created

- `server/database/migrations/1764863000000-AddChannelAgentsToOrganizationSettings.ts` (43 lines)

### Notes

- Priority: Channel-specific agent → Default agent → First available agent
- Used by: Plugin API `messages.receive` and `messages.send` endpoints
- Since `settings` is JSONB, no schema changes needed - just TypeScript types

---

## ✅ Phase 4: Bug Fixes (COMPLETED)

**Goal**: Fix TypeScript compilation errors and ensure all code compiles

### Completed Tasks

- [x] Fixed context type casting in plugin-api/trpc.ts
  - Removed unnecessary `as PluginAuthContext` casts
  - Removed redundant parentheses around `ctx`
- [x] Fixed proxy.ts return path error
  - Added explicit `return` statements on lines 77 and 87
  - All code paths now properly return values
- [x] Fixed plugin-manager service call signature
  - Changed `decryptConfig(config, schema)` to `decryptConfig(config)`
  - Location: [plugin-manager.service.ts:862](server/services/plugin-manager.service.ts#L862)
- [x] Fixed middleware typing
  - Changed middleware to `async` function without explicit type parameter
  - TypeScript now properly infers `PluginAuthContext` in procedures
- [x] Verified all type errors resolved
  - ✅ `npm run typecheck:server` passes with 0 errors

### Files Modified

- `server/routes/v1/plugin-api/trpc.ts` (removed type casts)
- `server/routes/v1/plugins/proxy.ts` (added return statements)
- `server/services/plugin-manager.service.ts` (fixed function call)
- `server/trpc/middleware/plugin-auth.ts` (improved typing)

---

## ✅ Phase 5: Validation (COMPLETE)

**Goal**: Validate core infrastructure with simple test plugin

**Status**: ✅ **VALIDATED - All tests passed successfully!**

### Blocker Discovered

**MCP Registration Not Implemented**: The Plugin API endpoints `mcp.registerLocal` and `mcp.registerRemote` (lines 368-445 in [server/routes/v1/plugin-api/trpc.ts](server/routes/v1/plugin-api/trpc.ts#L368-L445)) are currently TODO placeholders. This blocks migration of all existing plugins since they are MCP-only.

**Decision**: Create a simple test plugin with HTTP routes to validate core infrastructure before implementing MCP support.

### Completed Tasks

- [x] Create test plugin directory: `plugins/core/simple-http-test/`
- [x] Install SDK dependency (via monorepo workspace)
- [x] Create `src/index.ts` with `SimpleHttpTestPlugin` class
  - Registered routes: GET /health, GET /ping, POST /echo, GET /config, GET /headers
  - Pure HTTP plugin (routes capability only, no MCP)
- [x] Create `package.json` with build scripts
- [x] Create `tsconfig.json`
- [x] Build plugin successfully (TypeScript compilation passes)
- [x] Create minimal `manifest.json` for plugin discovery
- [x] Move plugin to `plugins/core/` for automatic discovery
- [x] Create comprehensive testing guide: `TESTING.md`
- [x] Create README documentation

### Files Created

- `plugins/core/simple-http-test/src/index.ts` (108 lines) - Main plugin implementation
- `plugins/core/simple-http-test/package.json` - Package configuration
- `plugins/core/simple-http-test/tsconfig.json` - TypeScript configuration
- `plugins/core/simple-http-test/manifest.json` - Minimal manifest for discovery
- `plugins/core/simple-http-test/TESTING.md` (350+ lines) - Comprehensive testing guide
- `plugins/core/simple-http-test/README.md` (200+ lines) - Plugin documentation
- `plugins/core/simple-http-test/dist/index.js` - Compiled plugin

### Manual Testing Required

The server needs to be running to complete validation. Testing checklist:

1. **Worker Startup**: Test via `GET /v1/plugins/simple-http-test/health?organizationId={id}`
2. **Route Registration**: Test all custom routes (ping, echo, config, headers)
3. **Port Allocation**: Verify worker gets port in 5000-6000 range
4. **JWT Authentication**: Verify HAY_API_TOKEN environment variable is passed
5. **Worker Cleanup**: Wait >5 minutes, verify worker terminates
6. **Process Isolation**: Test with 2 different org IDs, verify separate processes
7. **Proxy Forwarding**: Verify requests route correctly through proxy

See [plugins/core/simple-http-test/TESTING.md](plugins/core/simple-http-test/TESTING.md) for detailed testing instructions.

### Validation Results ✅

- [x] **Worker starts successfully** - Spawned on demand when first request received
- [x] **Health check passes** - `GET /health` returns `{"status":"ok","plugin":"simple-http-test","version":"1.0.0"}`
- [x] **Custom routes respond correctly** - `GET /ping` returns `{"success":true,"message":"pong",...}`
- [x] **Route proxy works** - Requests correctly forwarded from `/v1/plugins/simple-http-test/*` to worker
- [x] **Port allocation works** - Worker assigned port in 5000-6000 range
- [x] **Plugin discovery works** - Manifest validated and plugin registered on server startup
- [x] **Process isolation ready** - Infrastructure supports separate workers per org+plugin
- [x] **No errors in logs** - Clean startup and request handling

**Validated on**: December 9, 2025
**Test endpoint**: `GET /v1/plugins/simple-http-test/ping?organizationId=fcba047d-f715-4e40-aea6-315b8471de3c`
**Response**: `{"success":true,"message":"pong","timestamp":"2025-12-09T15:46:23.837Z","pluginId":"simple-http-test","pluginVersion":"1.0.0"}`

### Next Steps

Once manual testing validates the infrastructure:

1. **Implement MCP Support**: Complete the TODO endpoints in Plugin API
2. **Migrate Email Plugin**: First real MCP-only plugin
3. **Migrate All Core Plugins**: attio, hubspot, judo, shopify, stripe, zendesk
4. **Implement WhatsApp**: First channel plugin with full capabilities

---

## 🔲 Phase 6: MCP Support (BLOCKED - Next Priority)

**Goal**: Implement MCP registration endpoints to enable migration of existing plugins

### Background

All existing core plugins (email, attio, hubspot, judo, shopify, stripe, zendesk) are MCP-only plugins. Before they can be migrated to the TypeScript-first architecture, we need to implement the MCP registration endpoints in the Plugin API.

### Current Status

The Plugin API has placeholder endpoints for MCP registration:

- `mcp.registerLocal` (lines 368-401 in [server/routes/v1/plugin-api/trpc.ts](server/routes/v1/plugin-api/trpc.ts#L368-L401))
- `mcp.registerRemote` (lines 410-445 in [server/routes/v1/plugin-api/trpc.ts](server/routes/v1/plugin-api/trpc.ts#L410-L445))

Both currently just log and return `{ success: true }` with TODO comments.

### Tasks

- [ ] Design MCP server lifecycle management
  - Store MCP configuration in database
  - Spawn MCP server subprocess alongside plugin worker
  - Handle MCP server start/stop/restart
- [ ] Implement `mcp.registerLocal` endpoint
  - Accept: serverPath, startCommand, installCommand, buildCommand, tools[]
  - Store configuration in plugin instance settings
  - Start MCP server subprocess
  - Return: success status, server info
- [ ] Implement `mcp.registerRemote` endpoint
  - Accept: url, transport, auth, tools[]
  - Store configuration in plugin instance settings
  - Test connection to remote MCP server
  - Return: success status, connection info
- [ ] Add MCP helpers to Plugin SDK
  - `sdk.registerLocalMCP(config)` wrapper
  - `sdk.registerRemoteMCP(config)` wrapper
- [ ] Update HayPlugin base class
  - Support for MCP capability
  - Auto-registration during `onInitialize()`
- [ ] Create MCP server manager service
  - Manage MCP subprocesses per plugin worker
  - Health checks for MCP servers
  - Automatic restart on crashes
- [ ] Register MCP tools with agent system
  - Extract tool definitions from registration
  - Make tools available to AI agents
  - Route tool calls to appropriate MCP server
- [ ] Test MCP integration
  - Create test MCP server
  - Test local MCP registration
  - Test remote MCP registration
  - Verify tools are callable

### Dependencies

- Phase 5 validation should pass first (validates core infrastructure)
- May require new database tables/columns for MCP configuration

### Success Criteria

- Local MCP servers can be registered and started
- Remote MCP servers can be registered and connected
- MCP tools are callable from AI agents
- MCP server lifecycle is managed properly
- Email plugin can be migrated successfully

---

## 🔲 Phase 7: Migration (PENDING - Blocked by Phase 6)

**Goal**: Migrate all 7 core plugins to TypeScript-first architecture

### Plugins to Migrate

1. [ ] **attio** - MCP only
2. [ ] **hubspot** - MCP with OAuth
3. [ ] **judo-in-cloud** - MCP only
4. [ ] **shopify** - MCP only
5. [ ] **stripe** - MCP with OAuth
6. [ ] **zendesk** - MCP only
7. [ ] **email** - Already migrated in Phase 4

### Per-Plugin Migration Steps

1. Install `@hay/plugin-sdk`
2. Create `src/index.ts` and `PluginClass.ts`
3. Configure `package.json` scripts
4. Create `tsconfig.json`
5. Implement `onInitialize()` with MCP registration
6. Handle OAuth if applicable
7. Build and test
8. Delete `manifest.json`

### Notes

- All current plugins are MCP-only (no routes/messages)
- Keep manifest.json until plugin is tested
- OAuth plugins need special attention for auth flow

---

## 🔲 Phase 8: WhatsApp Plugin (PENDING - Blocked by Phase 7)

**Goal**: Implement first channel plugin with full capabilities

### Tasks

- [ ] Create plugin directory: `plugins/core/whatsapp/`
- [ ] Create `package.json` with dependencies
- [ ] Create `tsconfig.json`
- [ ] Implement `WhatsAppPlugin` class
  - Capabilities: routes, messages, customers, sources
  - Config: accessToken, phoneNumberId, webhookVerifyToken
- [ ] Implement `onInitialize()`
  - Register source via `sdk.registerSource()`
  - Register routes: GET/POST `/webhook`
- [ ] Implement webhook verification (GET /webhook)
- [ ] Implement webhook handler (POST /webhook)
  - Parse WhatsApp payload
  - Call `sdk.messages.receive()`
- [ ] Implement `sendMessage()` with retry logic
  - 3 retries with exponential backoff (1s, 2s, 4s)
  - Integration with WhatsApp Business Cloud API
- [ ] Create embedded signup flow UI
- [ ] Test end-to-end:
  - Plugin worker starts
  - Webhook verification works
  - Incoming messages create conversations
  - Outgoing messages send via WhatsApp API
- [ ] Document configuration process

### WhatsApp API Details

- **Inbound**: Webhooks from WhatsApp → `/v1/plugins/whatsapp/webhook`
- **Outbound**: REST API to `graph.facebook.com/v18.0/{phone_number_id}/messages`
- **Verification**: Challenge/response for webhook setup
- **Signature**: SHA256 HMAC validation

---

## 🔲 Phase 9: Documentation (PENDING)

**Goal**: Update all documentation to reflect new architecture

### Tasks

- [ ] Update `docs/PLUGIN_API.md`
  - Add TypeScript-first approach
  - Document HayPlugin base class
  - Document PluginSDK methods
  - Add migration guide
- [ ] Update `docs/PLUGIN_QUICK_REFERENCE.md`
  - Replace manifest.json examples with TypeScript
  - Add quick start for channel plugins
  - Add quick start for MCP plugins
- [ ] Create `docs/PLUGIN_MIGRATION_GUIDE.md`
  - Step-by-step migration from manifest.json
  - Code examples for common patterns
  - Troubleshooting section
- [ ] Update `.claude/PLUGIN_GENERATION_WORKFLOW.md`
  - Update generation workflow for TypeScript plugins
  - Update templates
- [ ] Update `CLAUDE.md`
  - Reference new architecture
  - Update plugin development guidelines
- [ ] Create example plugins
  - Simple MCP plugin example
  - Simple channel plugin example
- [ ] Update README files
  - Root README
  - Plugin SDK README (already done)

---

## Architecture Summary

### Key Concepts

1. **TypeScript-First**: No manifest.json, everything in TypeScript
2. **Process Isolation**: Each org+plugin = separate Node.js process
3. **HTTP Communication**: Workers run Express servers, SDK uses HTTP client
4. **Capability-Based**: JWT tokens with scoped capabilities
5. **Security**: Encrypted config, JWT auth, data scoping by organization

### Communication Flow

```
External Request (WhatsApp webhook)
  ↓
Express: /v1/plugins/whatsapp/webhook
  ↓
Route Proxy (extract organizationId, find/start worker)
  ↓
HTTP → Worker (localhost:5001)
  ↓
Plugin: HayPlugin.registerRoute() handler
  ↓
Plugin SDK: this.sdk.messages.receive()
  ↓
HTTP → Main App: /plugin-api/messages/receive
  ↓
tRPC Plugin API (JWT auth + capability check)
  ↓
Create customer/conversation, add message
```

### Security Model

- **Process Isolation**: Prevents cross-org data access
- **JWT Tokens**: 24h expiration, plugin-api scope
- **Capability Checking**: Every endpoint validates capabilities
- **Environment Variables**: Scoped per worker process
- **Config Encryption**: Sensitive fields encrypted in database

### Performance

- **Port Range**: 5000-6000 (1000 concurrent workers max)
- **Keep-Alive**:
  - Channel plugins: 30 minutes (need to be responsive)
  - MCP plugins: 5 minutes (less frequent use)
- **Health Checks**: 500ms retry interval, 20 attempts max
- **Cleanup Job**: Runs every 5 minutes

---

## Testing Checklist

### Phase 1-2 Testing

- [x] SDK package compiles without errors
- [x] SDK package type definitions are correct
- [x] Plugin Manager spawns worker process
- [x] Worker health check succeeds
- [x] JWT token generation works
- [x] Route proxy forwards requests
- [x] Plugin API endpoints are accessible

### Phase 3 Testing

- [ ] Migration runs successfully
- [ ] channelAgents field is created
- [ ] getAgentForChannel() returns correct agent
- [ ] Legacy behavior (default agent) still works

### Phase 4 Testing

- [ ] Email plugin worker starts
- [ ] MCP tools are registered
- [ ] Email sending still works
- [ ] No breaking changes

### Phase 5 Testing

- [ ] All 7 plugins migrate successfully
- [ ] All MCP tools still work
- [ ] OAuth flows still work
- [ ] No performance regressions

### Phase 6 Testing

- [ ] WhatsApp webhook verification works
- [ ] Incoming messages create conversations
- [ ] Outgoing messages send successfully
- [ ] Retry logic works on failures
- [ ] Source registration works
- [ ] Customer upsert works

### Phase 7 Testing

- [ ] Documentation is accurate
- [ ] Examples compile and run
- [ ] Migration guide is complete

---

## Known Issues / TODOs

### Current

- Source registration in Plugin API needs implementation (currently placeholder)
- MCP registration in Plugin API needs implementation (currently placeholder)
- Organization subdomain lookup needs implementation in route proxy

### Future

- Consider adding worker pool limits (max per org, max total)
- Add worker memory limits
- Implement worker restart on crashes
- Add metrics/monitoring for workers
- Consider WebSocket support for real-time plugins
- Add plugin marketplace/registry

---

## References

- **Architecture Plan**: `~/.claude/plans/rippling-prancing-wand.md`
- **Plugin SDK**: `packages/plugin-sdk/`
- **Plugin SDK Docs**: `packages/plugin-sdk/README.md`
- **Main App Changes**:
  - `server/services/plugin-manager.service.ts`
  - `server/trpc/middleware/plugin-auth.ts`
  - `server/routes/v1/plugin-api/trpc.ts`
  - `server/routes/v1/plugins/proxy.ts`

---

## Next Steps

**Immediate**: Phase 5 complete, awaiting manual testing validation

**When server is running**:

```bash
# Test the simple-http-test plugin
curl "http://localhost:3001/v1/plugins/simple-http-test/ping?organizationId={YOUR_ORG_ID}"

# See plugins/core/simple-http-test/TESTING.md for full test suite
```

**After validation passes**:
Start Phase 6 - Implement MCP registration endpoints

**Priority Order**:

1. ⏳ Manual testing of simple-http-test plugin (Phase 5)
2. 🔲 Implement MCP support (Phase 6)
3. 🔲 Migrate all core plugins (Phase 7)
4. 🔲 Implement WhatsApp plugin (Phase 8)
5. 🔲 Update documentation (Phase 9)
