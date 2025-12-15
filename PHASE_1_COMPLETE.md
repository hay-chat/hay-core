# Phase 1 Implementation Complete ✅

**Date**: December 15, 2025
**Status**: ✅ COMPLETE AND TESTED
**Migration Plan Reference**: [PLUGIN_SDK_V2_MIGRATION_PLAN.md](PLUGIN_SDK_V2_MIGRATION_PLAN.md) - Phase 1 (Preparation)

---

## Summary

Phase 1 of the Hay Core → Plugin SDK v2 migration has been successfully implemented and tested. This phase establishes the foundational infrastructure for SDK v2 integration, including database schema updates, type definitions, and core services.

---

## Completed Tasks

### 1. ✅ SDK v2 Type Definitions
**File**: [server/types/plugin-sdk-v2.types.ts](server/types/plugin-sdk-v2.types.ts)

Created comprehensive TypeScript types for SDK v2 contract:

- **Manifest Types**:
  - `HayPluginManifestV2` - Minimal manifest (replaces legacy verbose manifest)

- **Plugin-Global Metadata State**:
  - `PluginMetadataState` - Plugin-global state (`missing` | `fresh` | `stale` | `error`)
  - `PluginMetadata` - Metadata response from `/metadata` endpoint

- **Org-Scoped Runtime State**:
  - `PluginInstanceRuntimeState` - Org-scoped worker lifecycle (`stopped` | `starting` | `ready` | `degraded` | `error`)
  - `AuthState` - Authentication state structure

- **Metadata Schema Types**:
  - `ConfigFieldDescriptor` - Config field metadata
  - `AuthMethodDescriptor` - Auth method metadata
  - `UIExtensionDescriptor` - UI extension metadata
  - `RouteDescriptor` - Route metadata
  - `LocalMcpDescriptor` & `ExternalMcpDescriptor` - MCP server metadata
  - `MCPTool` - MCP tool definition

- **Worker Info**:
  - `WorkerInfo` - Worker process tracking

### 2. ✅ Database Schema Updates

#### PluginRegistry Entity
**File**: [server/entities/plugin-registry.entity.ts](server/entities/plugin-registry.entity.ts)

Added plugin-global metadata fields:
- `metadata` (jsonb) - Cached metadata from `/metadata` endpoint
- `metadataFetchedAt` (timestamptz) - Last fetch timestamp
- `metadataState` (varchar) - Metadata state (`missing`/`fresh`/`stale`/`error`)

#### PluginInstance Entity
**File**: [server/entities/plugin-instance.entity.ts](server/entities/plugin-instance.entity.ts)

Added org-scoped runtime fields:
- `authState` (jsonb) - Separate auth storage (methodId + credentials)
- `authValidatedAt` (timestamptz) - Last validation timestamp
- `runtimeState` (varchar) - Worker lifecycle state (`stopped`/`starting`/`ready`/`degraded`/`error`)

### 3. ✅ Database Migrations

#### Migration 1: PluginRegistry Metadata
**File**: [server/database/migrations/1765830031000-AddSDKv2MetadataToPluginRegistry.ts](server/database/migrations/1765830031000-AddSDKv2MetadataToPluginRegistry.ts)

- Added `metadata`, `metadata_fetched_at`, `metadata_state` columns
- Created index on `metadata_state`
- Created index on `checksum` for change detection

#### Migration 2: PluginInstance Runtime State
**File**: [server/database/migrations/1765830032000-AddSDKv2RuntimeStateToPluginInstance.ts](server/database/migrations/1765830032000-AddSDKv2RuntimeStateToPluginInstance.ts)

- Added `auth_state`, `auth_validated_at`, `runtime_state` columns
- Created index on `runtime_state`
- Created composite index on `(organization_id, plugin_id, runtime_state)`

**Migration Status**: ✅ Executed successfully

### 4. ✅ PortAllocator Service
**File**: [server/services/port-allocator.service.ts](server/services/port-allocator.service.ts)

Implements Core-allocated dynamic port pool strategy:

**Features**:
- Random port allocation from configurable range (default: 5000-65535)
- Port availability checking via TCP bind test
- Allocation tracking to prevent conflicts
- Port release mechanism
- Singleton pattern with `getPortAllocator()` helper

**API**:
- `allocate()` - Allocate an available port
- `release(port)` - Release a port
- `getAllocatedCount()` - Get current allocation count
- `isAllocated(port)` - Check if port is allocated
- `reset()` - Clear all allocations

**Test Results**: ✅ Passed
- Successfully allocated 2 different ports
- Port tracking working correctly
- Release mechanism functioning

### 5. ✅ PluginRunnerV2Service
**File**: [server/services/plugin-runner-v2.service.ts](server/services/plugin-runner-v2.service.ts)

Core service for managing SDK v2 plugin workers:

**Features**:
- Worker spawning using SDK v2 runner
- SDK v2 environment variable injection (HAY_ORG_CONFIG, HAY_ORG_AUTH, etc.)
- Worker process tracking (Map<orgId:pluginId, WorkerInfo>)
- Org-scoped runtime state management
- Graceful shutdown handling
- `/metadata` endpoint health checking (not `/health`)
- Port allocation integration

**Key Methods**:
- `startWorker(orgId, pluginId)` - Start a plugin worker
- `stopWorker(orgId, pluginId)` - Stop worker gracefully (calls `/disable`)
- `isRunning(orgId, pluginId)` - Check worker status
- `getWorker(orgId, pluginId)` - Get worker info
- `stopAllWorkers()` - Shutdown all workers

**Environment Contract**:
```typescript
{
  NODE_ENV: "production",
  PATH: process.env.PATH,
  HAY_ORG_ID: orgId,
  HAY_PLUGIN_ID: pluginId,
  HAY_WORKER_PORT: port.toString(),
  HAY_ORG_CONFIG: JSON.stringify(orgConfig),     // NEW: Org-specific config
  HAY_ORG_AUTH: JSON.stringify(orgAuth || {}),   // NEW: Auth state
  // + allowed env vars from manifest
}
```

**Runner Invocation**:
```bash
npx tsx plugin-sdk-v2/runner/index.ts \
  --plugin-path=/plugins/core/shopify \
  --org-id=org_123 \
  --port=5001 \
  --mode=production
```

### 6. ✅ SDK v2 Runner HTTP Endpoints
**File**: [plugin-sdk-v2/runner/http-server.ts](plugin-sdk-v2/runner/http-server.ts)

All required endpoints already implemented:

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/metadata` | GET | Fetch plugin metadata | ✅ Implemented |
| `/validate-auth` | POST | Validate auth credentials | ✅ Implemented |
| `/config-update` | POST | Notify config change | ✅ Implemented |
| `/disable` | POST | Cleanup before shutdown | ✅ Implemented |
| `/mcp/call-tool` | POST | Proxy MCP tool calls | ✅ Stub (Phase 6) |
| `/mcp/list-tools` | GET | List available MCP tools | ✅ Stub (Phase 6) |

---

## Test Results

### Test Script
**File**: [scripts/test-phase1.ts](scripts/test-phase1.ts)

Comprehensive test covering:
1. ✅ Database connection
2. ✅ PluginRegistry schema verification
3. ✅ PluginInstance schema verification
4. ✅ PortAllocator service functionality
5. ✅ Database write operations (PluginRegistry with metadata)
6. ✅ Database write operations (PluginInstance with auth/runtime state)
7. ✅ State transitions (`stopped` → `starting` → `ready`)
8. ✅ Cleanup operations

### Test Output
```
============================================================
✅ Phase 1 Implementation Test: PASSED
============================================================

Phase 1 Components:
  ✅ SDK v2 types created
  ✅ PluginRegistry entity updated with metadata fields
  ✅ PluginInstance entity updated with auth/runtime state
  ✅ Database migrations executed successfully
  ✅ PortAllocator service working
  ✅ Database read/write operations verified
```

---

## Architecture Decisions

### 1. Metadata State is Plugin-Global
- **Decision**: Metadata state stored in `PluginRegistry` (not per org)
- **Rationale**: Metadata = result of `onInitialize()` which depends only on plugin code, not org config
- **Implications**:
  - One metadata cache shared across all orgs
  - Refetch only when code changes (checksum mismatch)
  - Reduced database queries and metadata fetches

### 2. Runtime State is Org-Scoped
- **Decision**: Runtime state stored in `PluginInstance` (per org+plugin)
- **Rationale**: Worker lifecycle varies per org (enabled/disabled, config changes, auth failures)
- **Implications**:
  - Each org can have different runtime states for same plugin
  - UI can show per-org worker status
  - Supports multi-tenant architecture

### 3. Auth Separation from Config
- **Decision**: `authState` separate from `config` in `PluginInstance`
- **Rationale**: Cleaner separation, better security, explicit auth lifecycle
- **Implications**:
  - Core can validate auth separately
  - Config updates don't accidentally touch auth
  - Explicit auth validation flow

### 4. Core-Allocated Port Pool
- **Decision**: Core allocates ports dynamically from pool (not OS-assigned)
- **Rationale**: Simpler implementation, no stdout handshake needed
- **Implications**:
  - Suitable for early-stage product
  - Range: 5000-65535 (configurable)
  - Future enhancement: OS-assigned ports if needed at scale

### 5. No In-Process Plugin Loading
- **Decision**: Plugins never loaded into Core process
- **Rationale**: Complete isolation, better security, crash resilience
- **Implications**:
  - `onEnable` hook exists but not executed (future: out-of-process)
  - All plugin interaction via HTTP
  - Worker crashes don't affect Core

---

## Files Created

1. `server/types/plugin-sdk-v2.types.ts` - SDK v2 type definitions
2. `server/services/port-allocator.service.ts` - Port allocation service
3. `server/services/plugin-runner-v2.service.ts` - Worker management service
4. `server/database/migrations/1765830031000-AddSDKv2MetadataToPluginRegistry.ts` - Migration
5. `server/database/migrations/1765830032000-AddSDKv2RuntimeStateToPluginInstance.ts` - Migration
6. `scripts/test-phase1.ts` - Phase 1 test script
7. `PHASE_1_COMPLETE.md` - This document

---

## Files Modified

1. `server/entities/plugin-registry.entity.ts` - Added metadata fields
2. `server/entities/plugin-instance.entity.ts` - Added auth/runtime state fields

---

## Next Steps: Phase 2 - Worker Management

**Reference**: [PLUGIN_SDK_V2_MIGRATION_PLAN.md](PLUGIN_SDK_V2_MIGRATION_PLAN.md) - Phase 2

### Tasks:
1. Update `startPluginWorker()` in plugin-manager.service.ts to use PluginRunnerV2Service
2. Implement org-scoped runtime state transitions (starting → ready/error)
3. Implement plugin-global metadata state management (missing → fresh/stale/error)
4. Update `buildSDKv2Env()` integration
5. Update `waitForMetadataEndpoint()` (replace `/health` with `/metadata`)
6. Update worker tracking to distinguish v1/v2

### Estimated Duration: 4 days

---

## Success Criteria Met

- ✅ Complete, self-contained type system for SDK v2
- ✅ Database schema supports plugin-global + org-scoped states
- ✅ Migrations executed without errors
- ✅ PortAllocator service functional and tested
- ✅ PluginRunnerV2Service implements worker management contract
- ✅ SDK v2 runner exposes all required HTTP endpoints
- ✅ All Phase 1 tests passing
- ✅ No dependencies on legacy plugin code
- ✅ Clean separation between global and org runtime

---

## Testing Instructions

### Run Phase 1 Tests
```bash
npx tsx scripts/test-phase1.ts
```

### Verify Migrations
```bash
cd server
npm run migration:show
```

### Rollback (if needed)
```bash
cd server
npm run migration:revert  # Reverts last migration
npm run migration:revert  # Reverts second-to-last migration
```

---

## Notes

- All new database fields are **nullable** for backwards compatibility
- Legacy `status` field kept in PluginInstance for rollback safety
- No breaking changes to existing plugin system
- SDK v2 runner already has all required endpoints implemented
- Phase 1 is foundation-only; no Core integration yet (that's Phase 2+)

---

**Status**: ✅ **READY FOR PHASE 2**
