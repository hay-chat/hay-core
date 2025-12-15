# Hay Core → Plugin SDK v2 Migration Plan

**Date**: 2025-12-15
**Status**: Planning Phase - REVISED v2
**Goal**: Migrate Hay Core from legacy plugin system to Plugin SDK v2

**Revision Notes**:
- **v2 (2025-12-15)**: Corrected org-scoped runtime state, port allocation handshake, removed in-process plugin loading, metadata caching strategy, AbortController timeouts, and MCP tool discovery API.
- **v1 (2025-12-15)**: Corrected onEnable existence, runner HTTP surface requirements, metadata state model, config update flow, and port allocation strategy.

---

## Executive Summary

This document provides a complete migration plan for updating Hay Core to use the new Plugin SDK v2. The SDK v2 is **already complete** and must be treated as authoritative. This plan covers:

1. Discovery & registry changes
2. Worker lifecycle management
3. Metadata ingestion
4. Org lifecycle hooks
5. Config & auth persistence
6. MCP integration
7. Migration strategy
8. Risks & open questions

**Migration Type**: Big-bang at runtime (legacy code preserved for 1-release rollback window)

---

## 0. SDK v2 Runner HTTP Surface (Hard Requirements)

**Critical**: The following endpoints MUST be implemented in SDK v2 runner before Core migration begins. These are not "gaps" or "assumptions" — they are hard dependencies.

| Endpoint | Method | Purpose | Maps to Hook | Request Body | Response |
|----------|--------|---------|--------------|--------------|----------|
| `/metadata` | GET | Fetch plugin metadata | `onInitialize()` result | None | `PluginMetadata` |
| `/validate-auth` | POST | Validate auth credentials | `onValidateAuth(ctx)` | `{ authState: AuthState }` | `{ valid: boolean, error?: string }` |
| `/config-update` | POST | Notify config change | `onConfigUpdate(ctx)` | `{ config: Record<string, any> }` | `{ success: boolean }` |
| `/disable` | POST | Cleanup before shutdown | `onDisable(ctx)` | None | `{ success: boolean }` |
| `/mcp/call-tool` | POST | Proxy MCP tool calls | MCP runtime | `{ toolName: string, arguments: Record<string, any> }` | Tool result |
| `/mcp/list-tools` | GET | List available MCP tools | MCP runtime | None | `{ tools: MCPToolDefinition[] }` |

**Action Required**: Update `plugin-sdk-v2/runner/http-server.ts` to expose all endpoints before Core implementation begins.

---

## 1. Discovery & Registry

### 1.1 Current State (Legacy)

**Files**:
- `server/services/plugin-manager.service.ts` - Scans filesystem, reads `package.json`
- `server/entities/plugin-registry.entity.ts` - Stores plugin metadata
- `server/repositories/plugin-registry.repository.ts` - DB access
- `server/types/plugin.types.ts` - Legacy `HayPluginManifest` type

**Current Behavior**:
- Scans `/plugins/core` and `/plugins/custom/{orgId}` directories
- Reads `package.json` → `hay-plugin` block
- Builds full manifest from `package.json` fields
- Stores: `manifest`, `configSchema`, `auth`, `capabilities`, `permissions.env`
- Calculates checksum for change detection
- Tracks `installed`, `built`, `status` (available/not_found/disabled)

**Problems**:
- Legacy manifest has `configSchema`, `auth`, `settingsExtensions` baked in
- SDK v2 says: manifest is **intentionally minimal** - NO config schema, NO auth details
- These must be fetched from `/metadata` endpoint at runtime

### 1.2 Required Changes

#### 1.2.1 Update Manifest Type

**File**: `server/types/plugin.types.ts`

**Action**: Create new `HayPluginManifestV2` type:

```typescript
export interface HayPluginManifestV2 {
  // From package.json hay-plugin block
  entry: string;                    // e.g. "./dist/index.js"
  displayName: string;               // e.g. "Shopify"
  category: string;                  // e.g. "integration"
  capabilities: string[];            // e.g. ["routes", "mcp", "auth", "config", "ui"]
  env?: string[];                    // Allowed env vars
}
```

**Removed Fields** (now fetched from `/metadata`):
- `configSchema` → fetch from `/metadata`
- `auth` → fetch from `/metadata`
- `settingsExtensions` → fetch from `/metadata`
- `type` → inferred from capabilities
- `autoActivate`, `trpcRouter`, `services`, `dashboardPages` → deprecated
- `capabilities.mcp`, `capabilities.chat_connector` → flatten to `capabilities` array
- `permissions.api` → merged into `capabilities`

#### 1.2.2 Update Plugin Registry Entity

**File**: `server/entities/plugin-registry.entity.ts`

**Action**: Update `PluginRegistry` entity:

```typescript
@Entity("plugin_registry")
export class PluginRegistry {
  // ... existing fields ...

  @Column({ type: "jsonb" })
  manifest!: HayPluginManifestV2;  // ⬅️ Change type

  // NEW: Plugin-global metadata cache (from /metadata endpoint)
  @Column({ type: "jsonb", nullable: true })
  metadata?: PluginMetadata;  // ⬅️ Add this

  @Column({ type: "timestamptz", nullable: true })
  metadataFetchedAt?: Date;  // ⬅️ Add this

  // NEW: Plugin-global metadata state (not org-specific)
  @Column({
    type: "varchar",
    length: 50,
    default: "missing"
  })
  metadataState!: PluginMetadataState;  // ⬅️ Add this

  @Column({ type: "varchar", length: 64, nullable: true })
  checksum?: string;  // Code checksum for change detection
}

export type PluginMetadataState =
  | "missing"   // Metadata not yet fetched
  | "fresh"     // Metadata cached and valid
  | "stale"     // Code changed (checksum mismatch), needs refetch
  | "error";    // Metadata fetch failed

export interface PluginMetadata {
  // From GET /metadata endpoint
  configSchema: Record<string, ConfigFieldDescriptor>;
  authMethods: AuthMethodDescriptor[];
  uiExtensions: UIExtensionDescriptor[];
  routes: RouteDescriptor[];
  mcp: {
    local: LocalMcpDescriptor[];
    external: ExternalMcpDescriptor[];
  };
}
```

#### 1.2.3 Update Discovery Logic

**File**: `server/services/plugin-manager.service.ts`

**Method**: `registerPlugin()`

**Changes**:
1. Read `package.json` → extract only `hay-plugin` block (minimal)
2. **DO NOT** build full manifest - just store the minimal manifest
3. Calculate checksum for change detection
4. Set `metadataState = "missing"`
5. Metadata will be fetched on first worker start (any org)

**Pseudocode**:
```typescript
async registerPlugin(pluginPath: string, sourceType: string, orgId: string | null) {
  const packageJson = await readPackageJson(pluginPath);
  const hayPlugin = packageJson["hay-plugin"];

  if (!hayPlugin) return; // Not a Hay plugin

  // Validate minimal manifest
  validateManifestV2(hayPlugin);

  const manifest: HayPluginManifestV2 = {
    entry: hayPlugin.entry,
    displayName: hayPlugin.displayName,
    category: hayPlugin.category,
    capabilities: hayPlugin.capabilities || [],
    env: hayPlugin.env || [],
  };

  // Calculate checksum of plugin code
  const checksum = await calculatePluginChecksum(pluginPath);

  // Upsert registry WITHOUT metadata (will be fetched later)
  await pluginRegistryRepository.upsertPlugin({
    pluginId: packageJson.name,
    name: manifest.displayName,
    version: packageJson.version,
    pluginPath: relativePath,
    manifest: manifest,
    metadata: null,  // ⬅️ Not loaded yet
    metadataState: "missing",  // ⬅️ Initial state
    checksum,  // ⬅️ For change detection
    sourceType,
    organizationId: orgId || undefined,
  });
}
```

#### 1.2.4 Manifest Validation

**New Function**: `validateManifestV2()`

**Validations**:
- `entry` is required and points to a file
- `displayName` is required
- `category` is required
- `capabilities` is an array
- `env` (if present) is an array of strings
- No `configSchema`, `auth`, or other legacy fields present

---

## 2. Worker Lifecycle

### 2.1 Current State (Legacy)

**Files**:
- `server/services/plugin-manager.service.ts` - `startPluginWorker()`, `stopPluginWorker()`
- `server/services/plugin-instance-manager.service.ts` - On-demand startup, cleanup
- Uses: `spawn("node", ["dist/index.js"])` directly

**Current Behavior**:
- Spawns plugin entry point directly
- Passes env vars: `ORGANIZATION_ID`, `PLUGIN_ID`, `HAY_API_TOKEN`, etc.
- Builds "safe env" with explicit allowlist
- Waits for `/health` endpoint
- Tracks worker in `Map<string, WorkerInfo>`

**Problems**:
- No runner abstraction
- No `/metadata` contract
- No org context injection via env vars
- No hook lifecycle management
- Static port range (5000-6000) will break at scale

### 2.2 Required Changes

#### 2.2.1 Create Runner Wrapper

**New File**: `server/services/plugin-runner-v2.service.ts`

**Purpose**: Start plugin workers using SDK v2 runner

**API**:
```typescript
export class PluginRunnerV2Service {
  /**
   * Start plugin worker using SDK v2 runner
   *
   * @param orgId - Organization ID
   * @param pluginId - Plugin ID (package name)
   * @param port - Allocated port (0 for OS-assigned)
   * @returns Worker info
   */
  async startWorker(
    orgId: string,
    pluginId: string,
    port: number
  ): Promise<WorkerInfo>;

  /**
   * Stop plugin worker gracefully
   */
  async stopWorker(orgId: string, pluginId: string): Promise<void>;

  /**
   * Get worker status
   */
  isRunning(orgId: string, pluginId: string): boolean;
}
```

#### 2.2.2 Runner Invocation

**Command**:
```bash
node /path/to/plugin-sdk-v2/runner/index.js \
  --plugin-path=/plugins/core/shopify \
  --org-id=org_123 \
  --port=5001 \
  --mode=production
```

**Environment Variables Passed** (SDK v2 contract):
- `HAY_ORG_ID`: Organization ID
- `HAY_PLUGIN_ID`: Plugin ID (package name)
- `HAY_WORKER_PORT`: Allocated port
- `HAY_ORG_CONFIG`: JSON string of org-specific config
- `HAY_ORG_AUTH`: JSON string of org-specific auth state
- `HAY_API_URL`: Hay Core API URL (if plugin has API capabilities)
- `HAY_API_TOKEN`: JWT token for Hay Core API (if plugin has API capabilities)
- `NODE_ENV`: production/development
- `PATH`: Node.js path
- Allowed env vars from manifest `env` array

**Critical**:
- `HAY_ORG_CONFIG` and `HAY_ORG_AUTH` replace individual config env vars
- SDK v2 runner reads these and injects into context
- Config resolution (org → env fallback) happens inside SDK

#### 2.2.3 Port Allocation Strategy

**Current**: Static pool (5000-6000)
**Problem**: Will break with many orgs/plugins

**Chosen Strategy**: Core-allocated Dynamic Port Pool

**Rationale**: OS-assigned ports (port=0) require a handshake mechanism that adds complexity. For early-stage product, Core-side dynamic allocation is simpler and sufficient.

**Implementation**:
```typescript
class PortAllocator {
  private allocatedPorts = new Set<number>();
  private basePort = 5000;
  private maxPort = 65535;

  async allocate(): Promise<number> {
    // Find next available port
    for (let port = this.basePort; port < this.maxPort; port++) {
      if (!this.allocatedPorts.has(port) && await this.isPortAvailable(port)) {
        this.allocatedPorts.add(port);
        return port;
      }
    }
    throw new Error("No available ports");
  }

  release(port: number): void {
    this.allocatedPorts.delete(port);
  }

  private async isPortAvailable(port: number): Promise<boolean> {
    // Try to bind to port, release immediately
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      server.listen(port);
    });
  }
}
```

**Future Enhancement** (if needed at scale):
- Option: OS-assigned ports with stdout handshake
- Runner prints `HAY_WORKER_PORT=12345` on successful bind
- Core parses stdout to learn actual port
- Requires runner modification

#### 2.2.4 Update Worker Info Tracking

**File**: `server/services/plugin-manager.service.ts`

**Changes**:
```typescript
interface WorkerInfo {
  process: ChildProcess;
  port: number;
  startedAt: Date;
  lastActivity: Date;
  metadata: PluginRegistry;
  organizationId: string;
  pluginId: string;
  instanceId: string;
  sdkVersion: "v1" | "v2";  // ⬅️ Add this to track version
}
```

#### 2.2.5 Update Worker Startup Flow

**File**: `server/services/plugin-manager.service.ts`

**Method**: `startPluginWorker()`

**New Flow**:
```typescript
async startPluginWorker(orgId: string, pluginId: string): Promise<WorkerInfo> {
  // 1. Get plugin registry (plugin-global metadata cache)
  const plugin = this.registry.get(pluginId);
  const manifest = plugin.manifest as HayPluginManifestV2;

  // 2. Get plugin instance (org-scoped config + auth)
  const instance = await pluginInstanceRepository.findByOrgAndPlugin(orgId, pluginId);
  if (!instance || !instance.enabled) {
    throw new Error(`Plugin not enabled`);
  }

  // 3. Update org-scoped state to "starting"
  await pluginInstanceRepository.updateRuntimeState(instance.id, "starting");

  // 4. Allocate port
  const port = await this.portAllocator.allocate();

  // 5. Build env vars (SDK v2 contract)
  const env = this.buildSDKv2Env({
    orgId,
    pluginId,
    port,
    orgConfig: instance.config || {},
    orgAuth: instance.authState || {},
    capabilities: manifest.capabilities,
    allowedEnvVars: manifest.env || [],
  });

  // 6. Spawn SDK v2 runner
  const runnerPath = path.join(__dirname, "../../plugin-sdk-v2/runner/index.js");
  const pluginPath = path.join(this.pluginsDir, plugin.pluginPath);

  const workerProcess = spawn("node", [
    runnerPath,
    `--plugin-path=${pluginPath}`,
    `--org-id=${orgId}`,
    `--port=${port}`,
    `--mode=production`,
  ], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // 7. Wait for /metadata endpoint (not /health)
  try {
    await this.waitForMetadataEndpoint(port, { maxAttempts: 20, interval: 500 });
  } catch (error) {
    await pluginInstanceRepository.updateRuntimeState(instance.id, "error", error.message);
    this.portAllocator.release(port);
    throw error;
  }

  // 8. Fetch and cache metadata (plugin-global, not per org)
  // Only fetch if: missing, stale (checksum changed), or error
  if (plugin.metadataState !== "fresh") {
    try {
      await this.fetchAndStoreMetadata(pluginId, port);
      // Updates plugin.metadata and sets metadataState = "fresh"
    } catch (error) {
      await pluginRegistryRepository.updateMetadataState(plugin.id, "error");
      logger.warn(`Metadata fetch failed for ${pluginId}, cached metadata may be stale`, error);
      // Don't throw - use cached metadata if available
    }
  }

  // 9. Update org-scoped state to "ready"
  await pluginInstanceRepository.updateRuntimeState(instance.id, "ready");

  // 10. Store worker info
  const workerInfo: WorkerInfo = {
    process: workerProcess,
    port,
    startedAt: new Date(),
    lastActivity: new Date(),
    metadata: plugin,
    organizationId: orgId,
    pluginId,
    instanceId: instance.id,
    sdkVersion: "v2",
  };

  this.workers.set(`${orgId}:${pluginId}`, workerInfo);

  return workerInfo;
}
```

#### 2.2.6 Build SDK v2 Environment

**New Method**: `buildSDKv2Env()`

**Changes from Legacy**:
```typescript
private buildSDKv2Env(params: {
  orgId: string;
  pluginId: string;
  port: number;
  orgConfig: Record<string, any>;
  orgAuth: AuthState | null;
  capabilities: string[];
  allowedEnvVars: string[];
}): Record<string, string> {
  const { orgId, pluginId, port, orgConfig, orgAuth, capabilities, allowedEnvVars } = params;

  // Base env
  const env: Record<string, string> = {
    NODE_ENV: process.env.NODE_ENV || "production",
    PATH: process.env.PATH || "",

    // SDK v2 contract
    HAY_ORG_ID: orgId,
    HAY_PLUGIN_ID: pluginId,
    HAY_WORKER_PORT: port.toString(),
    HAY_ORG_CONFIG: JSON.stringify(orgConfig),       // ⬅️ NEW
    HAY_ORG_AUTH: JSON.stringify(orgAuth || {}),     // ⬅️ NEW
  };

  // Add API access if needed
  if (capabilities.includes("routes") || capabilities.includes("mcp")) {
    env.HAY_API_URL = process.env.API_URL || "http://localhost:3001";
    env.HAY_API_TOKEN = this.generatePluginJWT(orgId, pluginId, capabilities);
  }

  // Add allowed env vars from host
  for (const envVar of allowedEnvVars) {
    if (process.env[envVar]) {
      env[envVar] = process.env[envVar]!;
    }
  }

  return env;
}
```

**Key Differences**:
- **No individual config env vars** (e.g. `SHOPIFY_API_KEY`) - all config in `HAY_ORG_CONFIG`
- **Auth state** passed as `HAY_ORG_AUTH`
- SDK handles resolution (org → env fallback) internally

---

## 3. Metadata Ingestion

### 3.1 `/metadata` Endpoint Contract

**SDK v2 Spec** (from PLUGIN.md section 3.2):

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
      "label": "API Key",
      "required": false,
      "env": "SHOPIFY_API_KEY",
      "sensitive": true
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
      "slot": "plugin-settings",
      "component": "components/ShopifySettings.vue"
    }
  ],
  "mcp": {
    "local": [],
    "external": []
  }
}
```

### 3.2 Fetch Metadata

**New Method**: `fetchAndStoreMetadata()`

**File**: `server/services/plugin-manager.service.ts`

**Implementation**:
```typescript
async fetchAndStoreMetadata(pluginId: string, port: number): Promise<void> {
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Create AbortController for timeout (Node.js standard)
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 5000);

    try {
      const response = await fetch(`http://localhost:${port}/metadata`, {
        signal: abortController.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const metadata: PluginMetadata = await response.json();

      // Validate metadata structure
      validateMetadata(metadata);

      // Store in database
      await pluginRegistryRepository.updateMetadata(pluginId, {
        metadata,
        metadataFetchedAt: new Date(),
        metadataState: "fresh",
      });

      // Update in-memory registry
      const plugin = this.registry.get(pluginId);
      if (plugin) {
        plugin.metadata = metadata;
        plugin.metadataFetchedAt = new Date();
        plugin.metadataState = "fresh";
      }

      logger.info(`Fetched metadata for ${pluginId}`, {
        configFields: Object.keys(metadata.configSchema || {}).length,
        authMethods: metadata.authMethods?.length || 0,
        routes: metadata.routes?.length || 0,
        uiExtensions: metadata.uiExtensions?.length || 0,
      });

      return; // Success
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error as Error;
      logger.warn(`Metadata fetch attempt ${attempt}/${maxRetries} failed for ${pluginId}`, error);

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  throw new Error(`Failed to fetch metadata after ${maxRetries} attempts: ${lastError?.message}`);
}
```

### 3.3 UI Behavior by Runtime State

**State-Driven UI** (org-scoped states from `PluginInstance.runtimeState`):

| State | UI Behavior | Config Editable? | Enable/Disable |
|-------|-------------|------------------|----------------|
| `stopped` | Show "Not running" | Yes | Show "Start" button |
| `starting` | Show "Starting worker..." with spinner | No | Disable all actions |
| `ready` | Show "Running" with green indicator | Yes | Fully functional |
| `degraded` | Show warning "Limited functionality" | Yes (basic only) | Can disable/restart |
| `error` | Show error message from `lastError` field | No | Show "Retry" button |

**Plugin-Global Metadata State** (from `PluginRegistry.metadataState`):

| State | Behavior |
|-------|----------|
| `missing` | Metadata not fetched yet, wait for first worker start |
| `fresh` | Metadata cached and valid, use for UI rendering |
| `stale` | Code changed, metadata will refetch on next worker start |
| `error` | Metadata fetch failed, use cached if available, show warning |

**Frontend Changes Required**:
- Read `instance.runtimeState` for worker status (per org)
- Read `plugin.metadataState` and `plugin.metadata` for UI rendering (global)
- Show appropriate UI per state combination
- Disable actions when not in `ready` state

### 3.4 Use Metadata in Core

#### 3.4.1 Settings UI

**Current**: Reads `manifest.configSchema`
**New**: Reads `metadata.configSchema`

**Files to Update**:
- `server/routes/v1/plugins/plugins.handler.ts` - `getPlugin()`, `getAllPlugins()`
- `dashboard/pages/plugins/[id].vue` - Settings form rendering

**Change**:
```typescript
// OLD
const configSchema = plugin.manifest.configSchema;

// NEW
const configSchema = plugin.metadata?.configSchema || {};

// Guard against missing/stale metadata
if (plugin.metadataState === "missing") {
  showInfo("Plugin metadata loading, please wait...");
} else if (plugin.metadataState === "error") {
  showWarning("Limited configuration available - metadata fetch failed");
}

// Guard against org-scoped worker issues
if (instance.runtimeState === "error") {
  showError(`Plugin error: ${instance.lastError}`);
}
```

#### 3.4.2 Auth UI

**Current**: Reads `manifest.auth`
**New**: Reads `metadata.authMethods`

**Files to Update**:
- `server/routes/v1/plugins/plugins.handler.ts` - Auth endpoints
- `dashboard/components/plugins/PluginAuthSetup.vue` - Auth form

**Change**:
```typescript
// OLD
const authConfig = plugin.manifest.auth;

// NEW
const authMethods = plugin.metadata?.authMethods || [];
```

#### 3.4.3 MCP Registration

**Current**: Reads `manifest.capabilities.mcp`
**New**: Reads `metadata.mcp`

**File**: `server/services/mcp-registry.service.ts`

**Change**: MCP servers are now registered dynamically when plugin calls `mcp.startLocal()` in `onStart` hook

#### 3.4.4 Routes

**Current**: Routes defined in `manifest.apiEndpoints`
**New**: Routes defined in `metadata.routes`

**File**: `server/services/plugin-route.service.ts`

**Change**:
```typescript
// OLD
const routes = plugin.manifest.apiEndpoints || [];

// NEW
const routes = plugin.metadata?.routes || [];
```

### 3.5 Metadata Refresh Strategy

**Metadata is Plugin-Global** (not org-specific):
- Metadata = result of `onInitialize()` which depends only on plugin code
- Does NOT vary by org config or auth
- Cached in `PluginRegistry` and shared across all orgs

**When to Fetch**:
1. **Initial load**: First worker start for any org (metadataState = "missing")
2. **Code change**: Checksum mismatch detected (set metadataState = "stale", refetch on next start)
3. **Manual refresh**: Admin API call (force refetch)
4. **Error recovery**: Previous fetch failed (metadataState = "error", retry on next start)

**When NOT to Fetch**:
- Every worker start (use cached metadata if metadataState = "fresh")
- Every API request (too expensive)
- During config updates (metadata is static, unrelated to org config)

**Checksum Change Detection**:
```typescript
async checkPluginCodeChange(pluginId: string): Promise<boolean> {
  const plugin = this.registry.get(pluginId);
  const newChecksum = await calculatePluginChecksum(plugin.pluginPath);

  if (newChecksum !== plugin.checksum) {
    // Code changed, mark metadata as stale
    await pluginRegistryRepository.update(plugin.id, {
      checksum: newChecksum,
      metadataState: "stale",
    });
    return true;
  }
  return false;
}
```

---

## 4. Org Lifecycle Hooks

### 4.1 Hook Mapping (Legacy → SDK v2)

| Legacy System | SDK v2 Hook | Triggered By | Triggered When | Responsibility |
|---------------|-------------|--------------|----------------|----------------|
| Install/upload | `onEnable()` | **Hay Core** | Plugin installed for org | **Core-only hook** - never called by runner |
| Worker startup | `onInitialize()` | **Runner** | Worker process starts | Plugin declares schema/auth/routes/UI |
| Worker startup | `onStart()` | **Runner** | After `onInitialize`, with org context | Plugin starts MCP, reads config/auth |
| Auth save | `onValidateAuth()` | **Core → Runner** | User saves auth credentials | Plugin validates credentials |
| Config save | `onConfigUpdate()` | **Core → Runner** | User saves config | Plugin notified of config change |
| Disable/uninstall | `onDisable()` | **Core → Runner** | Plugin uninstalled for org | Plugin cleans up resources |

**Critical Corrections**:
- `onEnable()` **DOES EXIST** but is **Core-only**
- `onEnable()` is **NEVER** called by the SDK v2 runner
- `onEnable()` is called directly by Hay Core during installation (future use for provisioning)
- All other hooks are runner-managed or Core→Runner HTTP calls

### 4.2 Enable Plugin Flow

**File**: `server/routes/v1/plugins/plugins.handler.ts`

**Method**: `enablePlugin()`

**Current Flow**:
```typescript
async enablePlugin(input: { pluginId, configuration }) {
  // 1. Install/build if needed
  await pluginManager.installPlugin(pluginId);
  await pluginManager.buildPlugin(pluginId);

  // 2. Create plugin instance row
  await pluginInstanceRepository.enablePlugin(orgId, pluginId, configuration);

  // 3. Start worker (for MCP plugins)
  await pluginManager.getOrStartWorker(orgId, pluginId);
}
```

**New Flow (SDK v2)**:
```typescript
async enablePlugin(input: { pluginId, configuration }) {
  // 1. Install/build if needed (UNCHANGED)
  await pluginManager.installPlugin(pluginId);
  await pluginManager.buildPlugin(pluginId);

  // 2. Create plugin instance row (UNCHANGED)
  const instance = await pluginInstanceRepository.enablePlugin(
    orgId,
    pluginId,
    configuration
  );

  // 3. Start worker
  // Worker will:
  //   - Call onInitialize() (global context)
  //   - Call onStart() (org context)
  // NOTE: onEnable hook exists but is NOT executed yet
  // Future: Execute onEnable in isolated runner process (not in Core)
  const worker = await pluginManager.startPluginWorker(orgId, pluginId);

  // 4. Fetch metadata from /metadata endpoint
  // (Already done in startPluginWorker if metadataState !== "fresh")

  return { success: true, instance };
}
```

**Important**: `onEnable()` hook is **NOT executed in this migration**. Plugin code is **NEVER loaded into Core process**. Future implementation will execute `onEnable()` in an isolated runner process for resource provisioning.

### 4.3 Validate Auth Flow

**File**: `server/routes/v1/plugins/plugins.handler.ts`

**New Endpoint**: `validateAuth()`

**Implementation**:
```typescript
export const validateAuth = authenticatedProcedure
  .input(z.object({
    pluginId: z.string(),
    authState: z.object({
      methodId: z.string(),
      credentials: z.record(z.any()),
    }),
  }))
  .mutation(async ({ ctx, input }) => {
    // 1. Get or start worker
    const worker = await pluginManager.getOrStartWorker(
      ctx.organizationId!,
      input.pluginId
    );

    // 2. Call plugin's validation endpoint with timeout
    // SDK v2 runner exposes: POST /validate-auth
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 10000); // 10 second timeout

    try {
      const response = await fetch(`http://localhost:${worker.port}/validate-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authState: input.authState,
        }),
        signal: abortController.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error("Validation request failed");
      }

      const result = await response.json();

      // 3. Return validation result
      return {
        valid: result.valid,
        error: result.error,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        return {
          valid: false,
          error: "Validation timeout (>10s)",
        };
      }
      throw error;
    }
  });
```

**SDK v2 Runner Requirement**:
- Runner MUST expose `POST /validate-auth` endpoint
- Endpoint calls `plugin.onValidateAuth(ctx)` and returns `{ valid: boolean, error?: string }`

### 4.4 Config Update Flow (SIMPLIFIED)

**File**: `server/routes/v1/plugins/plugins.handler.ts`

**Method**: `configurePlugin()`

**Current Flow**:
```typescript
async configurePlugin(input: { pluginId, configuration }) {
  // 1. Update config in database
  await pluginInstanceRepository.updateConfig(instanceId, configuration);

  // 2. Restart worker (if running)
  if (workerRunning) {
    await pluginManager.stopPluginWorker(orgId, pluginId);
    await pluginManager.startPluginWorker(orgId, pluginId);
  }
}
```

**New Flow (SDK v2) - Option A (RECOMMENDED)**:
```typescript
async configurePlugin(input: { pluginId, configuration }) {
  // 1. Validate auth if auth fields changed
  if (hasAuthChanges(input.configuration)) {
    const authValid = await validateAuth({
      pluginId,
      authState: extractAuth(input.configuration)
    });
    if (!authValid.valid) {
      throw new Error("Auth validation failed: " + authValid.error);
    }
  }

  // 2. Update config in database
  await pluginInstanceRepository.updateConfig(instanceId, input.configuration);

  // 3. Restart worker to apply new config
  // Do NOT call /config-update - plugin reads config in onStart
  if (workerRunning) {
    await pluginManager.stopPluginWorker(orgId, pluginId);
    await pluginManager.startPluginWorker(orgId, pluginId);
  }
}
```

**Rationale for Option A**:
- Simpler contract: plugin always reads config in `onStart`
- No double-application of config changes
- Restart ensures clean state
- Suitable for early-stage product

**Alternative Flow - Option B (Advanced)**:
```typescript
// Only call /config-update if plugin requests it
// Do NOT restart worker unless plugin returns { restartRequired: true }
```

**Recommendation**: Use Option A (restart-based) initially. Option B can be added later if needed for performance.

### 4.5 Disable Plugin Flow

**File**: `server/routes/v1/plugins/plugins.handler.ts`

**Method**: `disablePlugin()`

**Current Flow**:
```typescript
async disablePlugin(input: { pluginId }) {
  // 1. Stop worker
  await pluginManager.stopPluginWorker(orgId, pluginId);

  // 2. Disable in database
  await pluginInstanceRepository.disablePlugin(orgId, pluginId);
}
```

**New Flow (SDK v2)**:
```typescript
async disablePlugin(input: { pluginId }) {
  // 1. Call plugin's disable hook (if worker running)
  if (workerRunning) {
    try {
      await fetch(`http://localhost:${worker.port}/disable`, {
        method: "POST",
        timeout: 5000,
      });
    } catch (error) {
      logger.warn(`Plugin disable hook failed:`, error);
      // Continue anyway
    }
  }

  // 2. Stop worker
  await pluginManager.stopPluginWorker(orgId, pluginId);

  // 3. Disable in database
  await pluginInstanceRepository.disablePlugin(orgId, pluginId);
}
```

**SDK v2 Runner Requirement**:
- Runner MUST expose `POST /disable` endpoint
- Endpoint calls `plugin.onDisable(ctx)` if defined
- Runner gracefully shuts down after hook completes

---

## 5. Config & Auth Persistence

### 5.1 Current State

**Entity**: `PluginInstance`

**Fields**:
```typescript
@Column({ type: "jsonb", nullable: true })
config?: Record<string, unknown>;  // All config + auth mixed

@Column({ type: "varchar", length: 50, nullable: true })
authMethod?: "api_key" | "oauth";  // Basic tracking
```

**Problems**:
- Auth and config are mixed in same field
- No `authState` field
- No structure for multiple auth methods

### 5.2 Required Changes

#### 5.2.1 Add Auth State Field

**File**: `server/entities/plugin-instance.entity.ts`

**Changes**:
```typescript
@Entity("plugin_instances")
export class PluginInstance extends OrganizationScopedEntity {
  // ... existing fields ...

  @Column({ type: "jsonb", nullable: true })
  config?: Record<string, unknown>;  // Pure config (no auth)

  // NEW: Auth state (separate from config)
  @Column({ type: "jsonb", nullable: true })
  authState?: AuthState;

  @Column({ type: "varchar", length: 50, nullable: true })
  authMethod?: string;  // Current method ID (e.g. "apiKey", "oauth")

  @Column({ type: "timestamptz", nullable: true })
  authValidatedAt?: Date;  // Last successful validation

  // NEW: Org-scoped runtime state (worker lifecycle per org+plugin)
  @Column({
    type: "varchar",
    length: 50,
    default: "stopped"
  })
  runtimeState!: PluginInstanceRuntimeState;  // ⬅️ Add this

  @Column({ type: "timestamptz", nullable: true })
  lastStartedAt?: Date;  // Last worker startup time

  @Column({ type: "text", nullable: true })
  lastError?: string;  // Last error message (for troubleshooting)
}

export type PluginInstanceRuntimeState =
  | "stopped"      // Worker not running
  | "starting"     // Worker spawning, waiting for /metadata
  | "ready"        // Worker running, healthy
  | "degraded"     // Worker running but MCP/config issues
  | "error";       // Worker crashed or failed to start

export interface AuthState {
  methodId: string;  // e.g. "apiKey", "oauth"
  credentials: Record<string, any>;  // { apiKey: "...", ... } or { accessToken: "...", ... }
}
```

#### 5.2.2 Migration

**New File**: `server/database/migrations/{timestamp}-add-auth-state-to-plugin-instances.ts`

**Migration**:
```typescript
export class AddAuthStateAndRuntimeStateToPluginInstances1234567890 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add auth state columns
    await queryRunner.addColumn("plugin_instances", new TableColumn({
      name: "auth_state",
      type: "jsonb",
      isNullable: true,
    }));

    await queryRunner.addColumn("plugin_instances", new TableColumn({
      name: "auth_validated_at",
      type: "timestamptz",
      isNullable: true,
    }));

    // 2. Add org-scoped runtime state columns
    await queryRunner.addColumn("plugin_instances", new TableColumn({
      name: "runtime_state",
      type: "varchar",
      length: "50",
      default: "'stopped'",
      isNullable: false,
    }));

    await queryRunner.addColumn("plugin_instances", new TableColumn({
      name: "last_started_at",
      type: "timestamptz",
      isNullable: true,
    }));

    await queryRunner.addColumn("plugin_instances", new TableColumn({
      name: "last_error",
      type: "text",
      isNullable: true,
    }));

    // 3. Migrate existing data (if any legacy auth in config)
    // This is plugin-specific and may need manual review
    // For now, leave auth_state null - users will re-configure
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn("plugin_instances", "auth_state");
    await queryRunner.dropColumn("plugin_instances", "auth_validated_at");
    await queryRunner.dropColumn("plugin_instances", "runtime_state");
    await queryRunner.dropColumn("plugin_instances", "last_started_at");
    await queryRunner.dropColumn("plugin_instances", "last_error");
  }
}
```

#### 5.2.3 Update Repository Methods

**File**: `server/repositories/plugin-instance.repository.ts`

**New Methods**:
```typescript
class PluginInstanceRepository {
  /**
   * Update auth state for a plugin instance
   */
  async updateAuthState(
    instanceId: string,
    orgId: string,
    authState: AuthState
  ): Promise<void> {
    await this.repo.update(
      { id: instanceId, organizationId: orgId },
      {
        authState,
        authMethod: authState.methodId,
        authValidatedAt: new Date(),
      }
    );
  }

  /**
   * Get auth state for a plugin instance
   */
  async getAuthState(
    orgId: string,
    pluginId: string
  ): Promise<AuthState | null> {
    const instance = await this.findByOrgAndPlugin(orgId, pluginId);
    return instance?.authState || null;
  }
}
```

### 5.3 Config vs Auth Separation

**Rule**:
- **Config** = non-sensitive settings (e.g. `enableTestMode`, `webhookUrl`)
- **Auth** = credentials (e.g. `apiKey`, `accessToken`, `refreshToken`)

**How to Separate**:
- SDK v2 plugin declares auth methods via `register.auth.apiKey()` or `register.auth.oauth2()`
- Auth fields are identified by `authMethods[].configField` (for API key) or OAuth flow
- When user saves settings:
  1. Extract auth-related fields → store in `authState`
  2. Extract non-auth fields → store in `config`

**Example**:
```typescript
// User saves:
{
  "apiKey": "sk_live_xxx",
  "enableTestMode": true,
  "webhookUrl": "https://..."
}

// Plugin metadata says:
{
  "authMethods": [
    { "id": "apiKey", "type": "apiKey", "configField": "apiKey" }
  ],
  "configSchema": {
    "apiKey": { "type": "string", "sensitive": true },
    "enableTestMode": { "type": "boolean" },
    "webhookUrl": { "type": "string" }
  }
}

// Core separates:
authState = {
  methodId: "apiKey",
  credentials: { apiKey: "sk_live_xxx" }
}

config = {
  enableTestMode: true,
  webhookUrl: "https://..."
}
```

### 5.4 Injection into Worker

**Current**: Individual env vars (e.g. `SHOPIFY_API_KEY=...`)

**SDK v2**: JSON strings
- `HAY_ORG_CONFIG='{"enableTestMode":true,"webhookUrl":"..."}'`
- `HAY_ORG_AUTH='{"methodId":"apiKey","credentials":{"apiKey":"sk_live_xxx"}}'`

**SDK Handles Resolution**:
```typescript
// In plugin code:
const apiKey = ctx.auth.get().credentials.apiKey;
const testMode = ctx.config.get<boolean>("enableTestMode");
```

---

## 6. MCP Integration

### 6.1 Current State

**Files**:
- `server/services/mcp-registry.service.ts` - Tracks MCP tools
- `server/services/mcp-client-factory.service.ts` - Creates MCP clients
- `server/types/plugin.types.ts` - `MCPToolDefinition`, `LocalMCPServerConfig`, `RemoteMCPServerConfig`

**Current Behavior**:
- MCP servers defined in `manifest.capabilities.mcp`
- Tools stored in `plugin_instances.config.mcpServers`
- Core starts MCP processes separately

**Problems**:
- MCP lifecycle not tied to plugin lifecycle
- No `onStart` hook to initialize MCP with org config/auth
- MCP descriptors in manifest (static) vs runtime (dynamic)

### 6.2 Required Changes

#### 6.2.1 MCP Lifecycle in SDK v2

**SDK v2 Model**:
1. Plugin calls `ctx.mcp.startLocal()` in `onStart()` hook
2. SDK v2 runner manages MCP subprocess lifecycle
3. MCP servers automatically stopped when worker stops
4. Core doesn't manage MCP processes directly

**Example** (from plugin code):
```typescript
async onStart(ctx: HayStartContext) {
  // Get credentials
  const apiKey = ctx.auth.get().credentials.apiKey;

  // Start local MCP server
  await ctx.mcp.startLocal({
    serverId: "shopify-mcp",
    command: "node",
    args: ["./mcp-server.js"],
    env: {
      SHOPIFY_API_KEY: apiKey,
    },
  });
}
```

#### 6.2.2 Core's Role

**Core Does**:
1. Fetch MCP descriptors from `/metadata` endpoint
2. Display available MCP tools in UI
3. Route MCP tool calls to correct worker

**Core Does NOT**:
- Start/stop MCP processes (SDK handles it)
- Manage MCP server lifecycle (SDK handles it)
- Inject MCP config (plugin handles it via `onStart`)

#### 6.2.3 Metadata Response

**From `/metadata`**:
```json
{
  "mcp": {
    "local": [
      {
        "serverId": "shopify-mcp",
        "description": "Shopify API tools",
        "status": "available"
      }
    ],
    "external": []
  }
}
```

**Note**:
- Descriptors are **static** (available servers)
- Actual MCP tools are discovered when server starts (via `listTools()`)
- Core doesn't need to know about MCP tools upfront

#### 6.2.4 MCP Registry Changes

**File**: `server/services/mcp-registry.service.ts`

**Changes**:
```typescript
export class MCPRegistryService {
  /**
   * Get MCP servers for an organization
   * (Read from plugin metadata, not instance config)
   */
  async getServersForOrg(orgId: string): Promise<MCPServerDescriptor[]> {
    const instances = await pluginInstanceRepository.findByOrganization(orgId);
    const servers: MCPServerDescriptor[] = [];

    for (const instance of instances) {
      if (!instance.enabled) continue;

      const plugin = await pluginRegistryRepository.findByPluginId(instance.pluginId);
      const metadata = plugin?.metadata;

      if (metadata?.mcp?.local) {
        servers.push(...metadata.mcp.local.map(s => ({
          ...s,
          pluginId: instance.pluginId,
          organizationId: orgId,
        })));
      }
    }

    return servers;
  }

  /**
   * Call MCP tool
   * (Route to plugin worker, which routes to MCP server)
   */
  async callTool(
    orgId: string,
    pluginId: string,
    toolName: string,
    args: Record<string, any>
  ): Promise<any> {
    // Get worker
    const worker = await pluginManager.getOrStartWorker(orgId, pluginId);

    // Call worker's MCP proxy endpoint
    const response = await fetch(`http://localhost:${worker.port}/mcp/call-tool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolName,
        arguments: args,
      }),
    });

    if (!response.ok) {
      throw new Error(`MCP tool call failed: ${response.statusText}`);
    }

    return response.json();
  }
}
```

**SDK v2 Runner Requirement**:
- Runner MUST expose `POST /mcp/call-tool` endpoint
- Endpoint routes to appropriate MCP server managed by SDK

#### 6.2.5 MCP Tool Discovery

**Problem**: UI/agent needs list of available tools, not just server descriptors

**Solution**: Add `GET /mcp/list-tools` endpoint to runner

**Runner Endpoint**:
```typescript
// GET /mcp/list-tools
{
  "tools": [
    {
      "serverId": "shopify-mcp",
      "name": "get_products",
      "description": "List all products",
      "input_schema": { ... }
    },
    {
      "serverId": "shopify-mcp",
      "name": "create_order",
      "description": "Create a new order",
      "input_schema": { ... }
    }
  ]
}
```

**Core Integration**:
```typescript
export class MCPRegistryService {
  /**
   * Get all MCP tools for an organization
   */
  async getToolsForOrg(orgId: string): Promise<MCPTool[]> {
    const instances = await pluginInstanceRepository.findByOrganization(orgId);
    const tools: MCPTool[] = [];

    for (const instance of instances) {
      if (!instance.enabled || instance.runtimeState !== "ready") {
        continue;
      }

      // Get worker
      const worker = await pluginManager.getWorker(orgId, instance.pluginId);
      if (!worker) continue;

      // Fetch tools from worker
      try {
        const response = await fetch(`http://localhost:${worker.port}/mcp/list-tools`);
        const data = await response.json();

        tools.push(...data.tools.map((t: any) => ({
          ...t,
          organizationId: orgId,
          pluginId: instance.pluginId,
        })));
      } catch (error) {
        logger.warn(`Failed to fetch MCP tools for ${instance.pluginId}`, error);
      }
    }

    return tools;
  }
}
```

**UI/Agent Usage**:
```typescript
// In agent orchestration
const tools = await mcpRegistryService.getToolsForOrg(orgId);
// tools now contains flat list of all available MCP tools
```

#### 6.2.6 Remove Legacy MCP Process Management

**Files to Remove/Deprecate**:
- Any code that spawns MCP processes directly from Core
- Any code that manages MCP server lifecycle from Core
- Any code that injects MCP config from Core

**All MCP Lifecycle → SDK v2 Runner**

---

## 7. Migration Strategy

### 7.1 Migration Type: Big-Bang at Runtime

**Decision**: Replace legacy system at runtime, preserve code for rollback

**Clarification**:
- **Runtime**: All new plugin workers use SDK v2 runner
- **Code**: Legacy code remains in repo (tagged) for 1-release rollback window
- **DB**: Schema is backwards-compatible (new fields nullable)

**Reasons**:
1. SDK v2 contract is incompatible with legacy
2. Worker lifecycle is fundamentally different
3. Metadata model is different (minimal manifest + runtime fetch)
4. No production plugins to migrate yet (early stage)
5. Simpler than side-by-side dual-mode

### 7.2 Rollback Window

**Git Strategy**:
- Tag pre-v2 commit: `plugin-sdk-v1-final`
- Keep legacy code in repo until v2 stabilizes (1 release cycle)
- After stabilization: remove legacy code in cleanup PR

**DB Strategy**:
- All new fields are nullable → backwards compatible
- Rollback procedure: revert code, run down migrations

**Ops Strategy**:
- Test rollback procedure in staging before production deploy
- Have database backup before migration
- Monitor error rates for 48 hours post-deploy

### 7.3 Migration Phases

#### Phase 1: Preparation (Week 1)
- [ ] Create SDK v2 types in Hay Core (`PluginMetadataState`, `PluginInstanceRuntimeState`)
- [ ] Add `metadata`, `metadataFetchedAt`, `metadataState`, `checksum` fields to `PluginRegistry` entity
- [ ] Add `authState`, `authValidatedAt`, `runtimeState`, `lastStartedAt`, `lastError` fields to `PluginInstance` entity
- [ ] Run database migrations
- [ ] Create `PluginRunnerV2Service` and `PortAllocator` class
- [ ] **Update SDK v2 runner to expose required HTTP endpoints** (Section 0: /metadata, /validate-auth, /disable, /mcp/call-tool, /mcp/list-tools)

#### Phase 2: Worker Management (Week 2)
- [ ] Update `startPluginWorker()` to use SDK v2 runner
- [ ] Update `buildSDKv2Env()` to use new contract (HAY_ORG_CONFIG, HAY_ORG_AUTH)
- [ ] Update `waitForMetadataEndpoint()` (replace `/health` with `/metadata`)
- [ ] Implement org-scoped runtime state transitions (starting → ready/error)
- [ ] Implement plugin-global metadata state management (missing → fresh/stale/error)
- [ ] Update worker tracking to distinguish v1/v2
- [ ] Implement Core-allocated dynamic port pool (PortAllocator class)

#### Phase 3: Metadata Ingestion (Week 2-3)
- [ ] Implement `fetchAndStoreMetadata()` with AbortController-based timeouts and retry logic
- [ ] Implement checksum-based change detection for metadata staleness
- [ ] Update `getAllPlugins()` to return metadata + both state types (metadataState + runtimeState)
- [ ] Update `getPlugin()` to return metadata + both state types
- [ ] Update frontend to read from `metadata` instead of `manifest`
- [ ] Implement state-driven UI (Section 3.3) with proper guards for missing/stale metadata

#### Phase 4: Lifecycle Hooks (Week 3)
- [ ] Update `enablePlugin()` flow (NO in-process plugin loading, skip onEnable for now)
- [ ] Implement `validateAuth()` endpoint with AbortController timeout
- [ ] Update `configurePlugin()` flow (simplified restart-based)
- [ ] Update `disablePlugin()` flow with graceful `/disable` call
- [ ] Verify SDK v2 runner exposes all required endpoints
- [ ] Add documentation warning: onEnable hook exists but not executed yet (future: out-of-process)

#### Phase 5: Auth Separation (Week 3-4)
- [ ] Implement `updateAuthState()` repository method
- [ ] Implement config/auth separation logic in save flows
- [ ] Update frontend auth UI components
- [ ] Update `buildSDKv2Env()` to inject `HAY_ORG_AUTH`
- [ ] Test auth validation flow end-to-end

#### Phase 6: MCP Integration (Week 4)
- [ ] Update `MCPRegistryService` to read from metadata (server descriptors)
- [ ] Implement `getToolsForOrg()` using `/mcp/list-tools` endpoint
- [ ] Implement MCP tool call routing via `/mcp/call-tool`
- [ ] Update orchestrator to use new MCP registry (getToolsForOrg + callTool)
- [ ] Remove legacy MCP process management code
- [ ] Verify runner exposes `/mcp/list-tools` endpoint

#### Phase 7: Cleanup (Week 5)
- [ ] Remove legacy manifest fields from UI
- [ ] Deprecate legacy worker startup code (keep for rollback)
- [ ] Update documentation
- [ ] Update plugin examples (Stripe/Shopify)
- [ ] Tag `plugin-sdk-v1-final` commit

#### Phase 8: Testing & Validation (Week 5-6)
- [ ] Test plugin discovery
- [ ] Test worker startup/shutdown
- [ ] Test metadata ingestion + retry logic
- [ ] Test config/auth flows
- [ ] Test MCP integration
- [ ] Test error handling + state transitions
- [ ] Test rollback procedure in staging

### 7.4 Backwards Compatibility

**Legacy Plugins**:
- Mark as "incompatible" in UI
- Show migration instructions
- Provide migration tool/script

**Migration Tool**:
```bash
npm run migrate-plugin -- /plugins/core/shopify
```

**Migration Steps**:
1. Update `package.json` → minimal `hay-plugin` block
2. Update plugin code to use SDK v2 factory
3. Implement `onInitialize()`, `onStart()`, `onValidateAuth()`, `onDisable()` hooks
4. Remove legacy manifest fields
5. Test with SDK v2 runner

### 7.5 Rollout Plan

**Recommendation**: Hard Cutover with Rollback Window

**Deployment Strategy**:
1. Deploy to staging
2. Test all flows + rollback procedure
3. Deploy to production
4. Monitor error rates for 48 hours
5. If stable: proceed to cleanup (Phase 7)
6. If critical issues: execute rollback

**Rollback Trigger Criteria**:
- Worker startup failure rate > 20%
- Metadata fetch failure rate > 30%
- User-facing errors spike > 2x baseline

---

## 8. Risks & Open Questions

### 8.1 Architectural Risks

#### Risk 1: Metadata Fetch Failure
**Problem**: Worker starts but `/metadata` fetch fails (all 3 retries)
**Impact**: Plugin in `degraded` state, limited functionality
**Mitigation**:
- Set `runtimeState = "degraded"`
- Allow basic operations (disable, manual refresh)
- Show clear warning in UI
- Provide admin API to force metadata refresh
- Log error details for debugging

#### Risk 2: Worker Crashes After `onStart`
**Problem**: Plugin throws in `onStart`, worker crashes
**Impact**: Plugin instances for org go offline
**Mitigation**:
- SDK v2 catches errors in `onStart`
- Core marks plugin as "error" state
- Auto-restart with exponential backoff (max 3 attempts)
- After 3 failures, set `runtimeState = "error"` and stop retrying
- Show "Retry" button in UI for manual restart

#### Risk 3: Auth Validation Timeout
**Problem**: `onValidateAuth` calls external API, times out (>10s)
**Impact**: User waits, then sees timeout error
**Mitigation**:
- 10-second timeout on auth validation
- Show "Validating..." spinner in UI
- If timeout: return `{ valid: false, error: "Validation timeout" }`
- Allow user to retry or skip validation (with warning)

#### Risk 4: MCP Server Fails to Start
**Problem**: Plugin calls `mcp.startLocal()`, MCP crashes
**Impact**: Plugin installed but MCP unavailable
**Mitigation**:
- SDK v2 logs MCP error but doesn't crash plugin
- Plugin continues without MCP (degraded mode)
- UI shows "MCP unavailable" status
- Retry on next worker restart

#### Risk 5: Config/Auth Separation Confusion
**Problem**: Developers confused about config vs auth fields
**Impact**: Auth credentials stored in config, or vice versa
**Mitigation**:
- Clear documentation with examples
- Validation in Core (reject if auth in config)
- UI separates auth and config sections visually
- Error messages guide users to correct section

#### Risk 6: Port Allocation at Scale
**Problem**: Static port pool (5000-6000) exhausted
**Impact**: Can't start new workers
**Mitigation**:
- Implement OS-assigned ports (port=0) OR
- Implement centralized port allocator with reuse
- Add TODO in code for future scale

### 8.2 Open Questions for Clarification

1. **Metadata Caching**:
   - Should metadata be cached indefinitely or TTL?
   - **Recommendation**: Cache until code changes (checksum mismatch) + manual refresh option

2. **Auth Method Switching**:
   - Can user switch from API key to OAuth after initial setup?
   - **Recommendation**: Yes, via config update + auth validation

3. **Multiple Auth Methods**:
   - Can a plugin support API key AND OAuth simultaneously?
   - **Recommendation**: Yes, user chooses one in UI (stored in `authState.methodId`)

4. **Plugin Updates**:
   - How to handle plugin code updates (new version)?
   - **Recommendation**:
     - Detect checksum change
     - Restart all workers for that plugin
     - Re-fetch metadata
     - Notify users of breaking changes

5. **Error Recovery**:
   - Should Core auto-restart crashed workers?
   - **Recommendation**:
     - Yes, with exponential backoff (1s, 2s, 4s)
     - Max 3 restart attempts
     - After 3 failures, set `runtimeState = "error"` and stop

6. **Worker Cleanup**:
   - When to stop inactive workers?
   - **Recommendation**:
     - 5 minutes for MCP plugins (lightweight)
     - 30 minutes for channel plugins (stateful)
     - Make configurable per plugin type

---

## 9. Before/After Comparison

### 9.1 Plugin Manifest

**Before (Legacy)**:
```jsonc
{
  "hay-plugin": {
    "entry": "./dist/index.js",
    "displayName": "Shopify",
    "category": "integration",
    "capabilities": ["routes", "mcp"],
    "configSchema": {
      "apiKey": { "type": "string", "env": "SHOPIFY_API_KEY" }
    },
    "auth": {
      "type": "apiKey",
      "clientIdEnvVar": "SHOPIFY_CLIENT_ID"
    },
    "permissions": {
      "env": ["SHOPIFY_API_KEY", "SHOPIFY_CLIENT_ID"]
    }
  }
}
```

**After (SDK v2)**:
```jsonc
{
  "hay-plugin": {
    "entry": "./dist/index.js",
    "displayName": "Shopify",
    "category": "integration",
    "capabilities": ["routes", "mcp", "auth", "config"],
    "env": ["SHOPIFY_API_KEY", "SHOPIFY_CLIENT_ID"]
  }
}
```

### 9.2 Worker Startup

**Before (Legacy)**:
```bash
node /plugins/core/shopify/dist/index.js

# Env vars:
ORGANIZATION_ID=org_123
PLUGIN_ID=hay-plugin-shopify
SHOPIFY_API_KEY=sk_live_xxx
SHOPIFY_CLIENT_ID=abc123
HAY_API_TOKEN=jwt_token
```

**After (SDK v2)**:
```bash
node /plugin-sdk-v2/runner/index.js \
  --plugin-path=/plugins/core/shopify \
  --org-id=org_123 \
  --port=5001 \
  --mode=production

# Env vars:
HAY_ORG_ID=org_123
HAY_PLUGIN_ID=hay-plugin-shopify
HAY_WORKER_PORT=5001
HAY_ORG_CONFIG='{"enableTestMode":true}'
HAY_ORG_AUTH='{"methodId":"apiKey","credentials":{"apiKey":"sk_live_xxx"}}'
HAY_API_TOKEN=jwt_token
SHOPIFY_CLIENT_ID=abc123  # (allowed env var)
```

### 9.3 Plugin Code

**Before (Legacy)**:
```typescript
// No standard structure
export function start() {
  const apiKey = process.env.SHOPIFY_API_KEY;
  // ...
}
```

**After (SDK v2)**:
```typescript
import { defineHayPlugin } from "@hay/plugin-sdk";

export default defineHayPlugin((globalCtx) => {
  return {
    name: "Shopify",

    // Optional: Core-only hook (not called by runner)
    async onEnable(ctx) {
      // Provision external resources if needed
    },

    onInitialize(ctx) {
      // Declare schema
      ctx.register.config({
        apiKey: { type: "string", env: "SHOPIFY_API_KEY", sensitive: true },
      });

      // Declare auth
      ctx.register.auth.apiKey({
        id: "apiKey",
        label: "API Key",
        configField: "apiKey",
      });
    },

    async onStart(ctx) {
      // Get credentials
      const apiKey = ctx.auth.get().credentials.apiKey;

      // Start MCP
      await ctx.mcp.startLocal({
        serverId: "shopify-mcp",
        command: "node",
        args: ["./mcp-server.js"],
        env: { SHOPIFY_API_KEY: apiKey },
      });
    },

    async onValidateAuth(ctx) {
      const apiKey = ctx.auth.credentials.apiKey;
      const client = new ShopifyClient(apiKey);
      return await client.verify();
    },

    async onDisable(ctx) {
      // Cleanup webhooks
      await removeWebhooks();
    },
  };
});
```

---

## 10. Success Criteria

### 10.1 Functional Requirements

- [ ] Plugins discovered via minimal manifest
- [ ] Workers spawn using SDK v2 runner
- [ ] Metadata fetched from `/metadata` endpoint (with retry)
- [ ] Plugin-global metadata state tracked (missing → fresh/stale/error)
- [ ] Org-scoped runtime state tracked (stopped → starting → ready/degraded/error)
- [ ] Settings UI renders from metadata (with state-based guards)
- [ ] Auth UI renders from metadata
- [ ] Auth validation calls `onValidateAuth` hook via `/validate-auth`
- [ ] Config updates trigger worker restart (simplified flow)
- [ ] Disable calls `onDisable` hook via `/disable`
- [ ] MCP servers started via `onStart` hook
- [ ] MCP tools callable via `/mcp/call-tool` proxy
- [ ] Config and auth stored separately
- [ ] Workers isolated per org

### 10.2 Non-Functional Requirements

- [ ] Worker startup < 5 seconds
- [ ] Metadata fetch < 2 seconds (with 3 retry attempts)
- [ ] Auth validation < 10 seconds (with timeout)
- [ ] Zero core secrets leaked to plugins
- [ ] Workers auto-restart on crash (max 3 attempts, exponential backoff)
- [ ] Inactive workers cleaned up after timeout (5-30 min)
- [ ] Logs capture plugin errors with context
- [ ] UI shows plugin metadata state (missing/fresh/stale/error)
- [ ] UI shows org-scoped runtime state (stopped/starting/ready/degraded/error)
- [ ] Port allocation scales beyond static pool (OS-assigned or dynamic)

### 10.3 Documentation

- [ ] SDK v2 migration guide
- [ ] Hook lifecycle documentation (including onEnable as Core-only)
- [ ] Config vs auth separation guide
- [ ] MCP integration guide
- [ ] Example plugin (Stripe/Shopify migrated to SDK v2)
- [ ] API reference for Core ↔ Plugin communication
- [ ] Rollback procedure documentation

---

## 11. Files to Create

### 11.1 New Files

| File | Purpose |
|------|---------|
| `server/services/plugin-runner-v2.service.ts` | SDK v2 runner invocation and worker management |
| `server/services/port-allocator.service.ts` | Core-allocated dynamic port pool |
| `server/types/plugin-sdk-v2.types.ts` | SDK v2 type definitions (PluginMetadataState, PluginInstanceRuntimeState) |
| `server/services/plugin-metadata.service.ts` | Metadata fetching/validation/retry logic with AbortController |
| `server/routes/v1/plugins/validate-auth.ts` | Auth validation endpoint |
| `server/database/migrations/{timestamp}-add-metadata-to-plugin-registry.ts` | Add metadata, metadataFetchedAt, metadataState, checksum fields |
| `server/database/migrations/{timestamp}-add-runtime-state-to-plugin-instances.ts` | Add authState, authValidatedAt, runtimeState, lastStartedAt, lastError fields |
| `docs/PLUGIN_SDK_V2_MIGRATION.md` | Migration guide for plugin authors |
| `scripts/migrate-plugin-to-sdk-v2.ts` | Automated migration tool |
| `plugin-sdk-v2/runner/endpoints/validate-auth.ts` | Runner endpoint implementation |
| `plugin-sdk-v2/runner/endpoints/disable.ts` | Runner endpoint implementation |
| `plugin-sdk-v2/runner/endpoints/mcp-call-tool.ts` | Runner MCP proxy endpoint |
| `plugin-sdk-v2/runner/endpoints/mcp-list-tools.ts` | Runner MCP tool discovery endpoint |

### 11.2 Files to Modify

| File | Changes |
|------|---------|
| `server/services/plugin-manager.service.ts` | Update discovery, worker startup, env building, org-scoped state transitions, metadata caching |
| `server/entities/plugin-registry.entity.ts` | Add metadata, metadataFetchedAt, metadataState, checksum fields |
| `server/entities/plugin-instance.entity.ts` | Add authState, authValidatedAt, runtimeState, lastStartedAt, lastError fields |
| `server/repositories/plugin-registry.repository.ts` | Add updateMetadata(), updateMetadataState() |
| `server/repositories/plugin-instance.repository.ts` | Add updateAuthState(), getAuthState(), updateRuntimeState() |
| `server/routes/v1/plugins/plugins.handler.ts` | Update all flows (enable, config, disable) with SDK v2 contract, NO in-process plugin loading |
| `server/services/mcp-registry.service.ts` | Read from metadata, implement getToolsForOrg() via /mcp/list-tools, route to /mcp/call-tool |
| `server/types/plugin.types.ts` | Add SDK v2 types, deprecate legacy (keep for rollback) |
| `dashboard/pages/plugins/[id].vue` | Read from metadata, show both state types (metadataState + runtimeState), guard actions |
| `dashboard/components/plugins/PluginAuthSetup.vue` | Use authMethods array |
| `plugin-sdk-v2/runner/http-server.ts` | Add required endpoints (Section 0: /metadata, /validate-auth, /disable, /mcp/call-tool, /mcp/list-tools) |

### 11.3 Files to Deprecate (Keep for Rollback)

| File | Action |
|------|--------|
| Legacy MCP process spawning code | Deprecate (keep 1 release) |
| `manifest.configSchema` usage | Deprecate (keep 1 release) |
| `manifest.auth` usage | Deprecate (keep 1 release) |
| Individual config env vars | Deprecate (keep 1 release) |
| `manifest.apiEndpoints` | Deprecate (keep 1 release) |

---

## 12. Rollback Plan

### 12.1 If Migration Fails (Critical Bug)

**Scenario**: Critical bug found in SDK v2 integration (e.g. >20% worker startup failures)

**Actions**:
1. Revert code to `plugin-sdk-v1-final` tag
2. Run down migrations (drop new columns)
3. Restart services
4. Communicate to users: "Temporary issue resolved, plugin system restored"

**Prerequisites**:
- Git tag `plugin-sdk-v1-final` exists
- Rollback tested in staging
- Database backup from before migration
- Runbook documented and accessible

### 12.2 Partial Rollback (Performance Issues)

**Scenario**: SDK v2 works but has performance issues (e.g. slow metadata fetch)

**Actions**:
1. Keep SDK v2 for new plugins
2. Allow existing plugins to continue on v1 (if any)
3. Fix performance issues incrementally
4. Force migration after fixes validated

---

## 13. Testing Strategy

### 13.1 Unit Tests

- [ ] Test manifest validation (SDK v2 format)
- [ ] Test metadata validation (structure + fields)
- [ ] Test config/auth separation logic
- [ ] Test env building (SDK v2 contract)
- [ ] Test port allocation (OS-assigned or pool)
- [ ] Test worker tracking (v1 vs v2)
- [ ] Test runtime state transitions

### 13.2 Integration Tests

- [ ] Test plugin discovery end-to-end
- [ ] Test worker startup with SDK v2 runner
- [ ] Test metadata fetch with retries
- [ ] Test metadata fetch failure → degraded state
- [ ] Test enable plugin flow
- [ ] Test auth validation flow (success + failure)
- [ ] Test config update flow (restart-based)
- [ ] Test disable plugin flow
- [ ] Test MCP integration (start + call tool)

### 13.3 E2E Tests

- [ ] Install plugin via UI
- [ ] Verify runtime state transitions in UI
- [ ] Configure plugin settings
- [ ] Validate auth credentials (success + timeout)
- [ ] Call MCP tool via agent
- [ ] Update config, verify restart
- [ ] Disable plugin, verify cleanup
- [ ] Test degraded state UX (manual refresh)

### 13.4 Performance Tests

- [ ] Worker startup time (< 5s)
- [ ] Metadata fetch time (< 2s per attempt)
- [ ] Auth validation time (< 10s)
- [ ] MCP tool call latency (< 1s)
- [ ] Memory usage per worker (< 100MB)
- [ ] Inactive worker cleanup (5-30 min)
- [ ] Port allocation under load (100+ workers)

---

## 14. Timeline

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Preparation | 3 days | None |
| Phase 2: Worker Management | 4 days | Phase 1 |
| Phase 3: Metadata Ingestion | 4 days | Phase 2 |
| Phase 4: Lifecycle Hooks | 5 days | Phase 3 |
| Phase 5: Auth Separation | 4 days | Phase 4 |
| Phase 6: MCP Integration | 4 days | Phase 5 |
| Phase 7: Cleanup | 3 days | Phase 6 |
| Phase 8: Testing | 7 days | Phase 7 |
| **Total** | **34 days (~7 weeks)** | |

**Target Completion**: End of Q1 2026

---

## 15. Conclusion

This migration plan provides a complete, corrected roadmap for updating Hay Core to use Plugin SDK v2. The plan prioritizes:

1. **Correctness**: Fixed critical errors (onEnable, runner endpoints, state model, config flow, port allocation)
2. **Security**: Config/auth separation, env var isolation
3. **Simplicity**: Big-bang runtime, restart-based config updates
4. **Resilience**: State tracking, retry logic, degraded mode support
5. **Safety**: 1-release rollback window, backwards-compatible schema
6. **Testing**: Comprehensive test coverage including failure scenarios

**Key Corrections from Reviews**:

**Review v1**:
- ✅ `onEnable()` exists but is Core-only (not runner-called)
- ✅ Runner HTTP surface moved from "gaps" to hard requirements (Section 0)
- ✅ Initial state model added (later split into metadata + runtime states in v2)
- ✅ Config update flow simplified (restart-based, no double-application)
- ✅ Port allocation strategy clarified (OS-assigned or dynamic pool + TODO)
- ✅ Rollback window strategy clarified (big-bang runtime, preserved code)

**Review v2**:
- ✅ Runtime state moved to org-scoped (PluginInstance.runtimeState)
- ✅ Metadata state added as plugin-global (PluginRegistry.metadataState)
- ✅ Port allocation: Core-allocated dynamic pool (no handshake needed)
- ✅ Removed in-process plugin loading (onEnable skipped, future: out-of-process)
- ✅ Metadata caching: plugin-global, refetch only on checksum change
- ✅ AbortController-based timeouts (Node.js standard, not `timeout` option)
- ✅ MCP tool discovery API added (/mcp/list-tools endpoint)

**Next Steps**:
1. ✅ Review corrected plan v2 with team
2. Update SDK v2 runner to expose required HTTP endpoints (Section 0)
3. Create GitHub issues for each phase
4. Begin Phase 1 implementation

**Approval Required Before Proceeding**: ✅

---

**End of Migration Plan (Revised)**
