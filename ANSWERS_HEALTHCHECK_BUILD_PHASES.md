# Answers: Healthcheck, Build Process, and Future Phases

## Question 1: MCP Server Healthcheck

### Current State: ❌ No `/health` endpoint

You're absolutely right - there's **no healthcheck endpoint** currently implemented in the SDK v2 worker HTTP server.

**Current endpoints:**
- ✅ `GET /metadata` - Plugin metadata
- ✅ `POST /validate-auth` - Auth validation
- ✅ `POST /config-update` - Config updates
- ✅ `POST /disable` - Cleanup
- ✅ `GET /mcp/list-tools` - List MCP tools
- ✅ `POST /mcp/call-tool` - Execute MCP tools
- ❌ `GET /health` - **MISSING**

### What the Migration Plan Says

From [PLUGIN_SDK_V2_MIGRATION_PLAN.md:228](PLUGIN_SDK_V2_MIGRATION_PLAN.md#L228):
```
- Waits for `/health` endpoint
```

From [PLUGIN_SDK_V2_MIGRATION_PLAN.md:425](PLUGIN_SDK_V2_MIGRATION_PLAN.md#L425):
```typescript
// 7. Wait for /metadata endpoint (not /health)
try {
  await this.waitForMetadataEndpoint(port, { maxAttempts: 20, interval: 500 });
} catch (error) {
```

**Decision in migration plan**: Use `/metadata` as the healthcheck instead of a dedicated `/health` endpoint.

### Recommendation: Add `/health` Endpoint

While `/metadata` works as a proxy healthcheck, a dedicated `/health` endpoint is better practice:

**Benefits:**
1. **Lightweight** - No heavy computation (metadata fetching can be expensive)
2. **Standard** - Industry convention (Docker HEALTHCHECK, Kubernetes readiness probes)
3. **Granular** - Can check MCP server status, database connections, etc.
4. **Fast** - Returns immediately without business logic

**Proposed Implementation:**

```typescript
// plugin-sdk-v2/runner/http-server.ts

private setupHealthEndpoint(): void {
  this.app.get('/health', (_req: Request, res: Response) => {
    try {
      // Basic health check
      const health = {
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        pid: process.pid,
        orgId: this.orgId,
        mcpServers: {
          count: this.mcpServers.size,
          servers: Array.from(this.mcpServers.keys()),
        },
      };

      res.status(200).json(health);
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
```

Add to constructor:
```typescript
constructor(port: number, registry: PluginRegistry, logger: HayLogger) {
  // ... existing code ...

  // Setup routes
  this.setupHealthEndpoint();      // ⬅️ ADD THIS
  this.setupMetadataEndpoint();
  this.setupLifecycleEndpoints();
  this.setupMcpEndpoints();
  this.setupPluginRoutes();
  this.setupErrorHandler();
}
```

**Should we implement this now?** ✅ **YES** - It's a simple addition and follows best practices.

---

## Question 2: Plugin Build Process

### Current State: ✅ Build process exists (legacy SDK v1)

**Yes, there is a build process**, but it's currently designed for legacy SDK v1 plugins.

### How Build Works (Legacy)

1. **Script**: [scripts/build-plugins.sh](scripts/build-plugins.sh)
   - Scans `plugins/*/manifest.json` files
   - Reads `capabilities.mcp.installCommand` and `buildCommand` from manifest
   - Executes commands for each plugin

2. **Service**: [server/services/plugin-manager.service.ts:454](server/services/plugin-manager.service.ts#L454)
   - `buildPlugin(pluginId)` method
   - Reads `manifest.capabilities.mcp.buildCommand`
   - Executes via `execSync()` in plugin directory
   - Tracks build status in database

3. **Automatic Build**: [server/services/core/tool-execution.service.ts:291-293](server/services/core/tool-execution.service.ts#L291-L293)
   - Before executing tools, checks if plugin needs building
   - Auto-builds if `needsBuilding()` returns true
   - Ensures plugin is ready before use

### SDK v2 Compatibility: ⚠️ **Partially Compatible**

**For SDK v2 plugins:**

**Option 1: Manual Build (Current Approach)**
```bash
cd plugins/core/email
npm run build
```

**Option 2: Add Build Command to package.json** (SDK v2 compatible)
```json
{
  "name": "@hay/email-plugin",
  "hay-plugin": {
    "entry": "./dist/index-v2.js",
    "capabilities": ["mcp", "config"],
    "buildCommand": "npm run build"  // ⬅️ Add this (legacy field)
  },
  "scripts": {
    "build": "tsc --project tsconfig-v2.json"
  }
}
```

Then the legacy build system will pick it up:
```bash
# From root
bash scripts/build-plugins.sh
```

**Option 3: Update Build Script for SDK v2** (Better)

Create `scripts/build-plugins-v2.sh`:
```bash
#!/bin/bash

echo "🔨 Building SDK v2 plugins..."

# Build plugins with package.json hay-plugin.buildCommand
for plugin_dir in plugins/core/*/; do
  plugin_name=$(basename "$plugin_dir")
  package_file="${plugin_dir}package.json"

  if [ ! -f "$package_file" ]; then
    continue
  fi

  # Extract buildCommand from hay-plugin block
  build_cmd=$(node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('$package_file', 'utf8'));
    const buildScript = pkg.scripts?.build;
    if (buildScript) {
      console.log('npm run build');
    }
  ")

  if [ -z "$build_cmd" ]; then
    continue
  fi

  echo "📦 Building plugin: $plugin_name..."
  if (cd "$plugin_dir" && eval "$build_cmd" 2>&1); then
    echo "✅ Built $plugin_name"
  else
    echo "❌ Build failed for $plugin_name"
  fi
done
```

**Should we update the build process?** 🤔 **OPTIONAL** - Current manual approach works, but automation is nice.

---

## Question 3: Future Phase Concerns

Let me analyze the migration plan to identify concerns addressed in future phases vs. those we should handle now.

### Already Addressed (Phase 6 Complete) ✅

| Concern | Status | Notes |
|---------|--------|-------|
| MCP tool discovery | ✅ Done | `/mcp/list-tools` implemented |
| MCP tool execution | ✅ Done | `/mcp/call-tool` implemented |
| Frontend integration | ✅ Done | Dynamic tool discovery from workers |
| Real-time updates | ✅ Done | WebSocket broadcast working |
| Error handling | ✅ Done | MCP errors preserved and returned |

### Phase 7: Worker Management (Planned) 📋

**From migration plan - Phase 7 will address:**

1. **Auto-start workers on plugin enable**
   - Current: Manual worker start via command line
   - Future: Automatic worker spawning when plugin enabled
   - File: `server/services/plugin-runner-v2.service.ts`

2. **Health monitoring and auto-restart**
   - Current: No health checks, manual restart if crashed
   - Future: Periodic health checks, automatic restart on failure
   - Dependency: `/health` endpoint (see Question 1)

3. **Process management (PM2 integration)**
   - Current: Workers run as standalone processes
   - Future: PM2 or systemd integration for production
   - Benefits: Log rotation, clustering, monitoring

4. **Worker state management**
   - Current: Basic tracking in `plugin_runners` table
   - Future: Full state machine (stopped → starting → ready → degraded → error)
   - File: Database migration + service updates

5. **Port allocation strategy**
   - Current: Manual port assignment (`--port=5556`)
   - Future: Automatic port allocation from pool
   - Prevents port conflicts

### Phase 8: Metadata Management (Planned) 📋

**From migration plan - Phase 8 will address:**

1. **Metadata caching**
   - Current: Fetch `/metadata` on every tool discovery
   - Future: Cache in `plugin_registry.metadata` column
   - Cache invalidation on code changes (checksum)

2. **Metadata state tracking**
   - Current: No tracking
   - Future: `metadataState` column (missing → fresh → stale → error)

3. **Config schema validation**
   - Current: No validation before worker start
   - Future: Validate org config against schema from `/metadata`

### Critical Gaps We Should Fix NOW 🚨

Based on your testing, here are concerns that should be addressed **before production** use:

#### 1. **No Healthcheck Endpoint** (Question 1)

**Problem**: Can't monitor worker health
**Impact**: Can't detect crashed workers, no readiness probe
**Fix**: Add `/health` endpoint (30 minutes)
**Priority**: 🔴 **HIGH** - Required for production monitoring

#### 2. **Manual Worker Start**

**Problem**: Users must manually start workers
**Impact**: Poor UX, easy to forget, error-prone
**Fix**: Implement auto-start in `plugin-runner-v2.service.ts`
**Priority**: 🟡 **MEDIUM** - Can defer to Phase 7, but UX is bad

#### 3. **No Auto-Restart on Crash**

**Problem**: If worker crashes, tools permanently fail
**Impact**: Production outage until manual restart
**Fix**: Health monitoring + restart logic
**Priority**: 🔴 **HIGH** - Critical for production reliability

#### 4. **No Build Automation for SDK v2**

**Problem**: Must manually build each plugin
**Impact**: Easy to forget to rebuild after code changes
**Fix**: Update `plugin-manager.service.ts` to detect SDK v2 plugins
**Priority**: 🟢 **LOW** - Nice to have, not critical

#### 5. **Port Conflicts**

**Problem**: Manual port assignment can cause conflicts
**Impact**: Workers fail to start if port in use
**Fix**: Implement port allocation pool
**Priority**: 🟡 **MEDIUM** - Can defer to Phase 7, use conventions for now

### Recommendation: Minimal Production-Ready Set

To make this **production-ready** with minimal effort:

#### **Quick Wins (Do Now - 1-2 hours)**

1. ✅ **Add `/health` endpoint** - Essential for monitoring
2. ✅ **Add build detection for SDK v2** - Reads `scripts.build` from package.json
3. ✅ **Document port conventions** - e.g., email=5556, stripe=5557, etc.

#### **Can Defer to Phase 7 (1-2 weeks)**

4. ⏰ Auto-start workers
5. ⏰ Health monitoring loop
6. ⏰ Auto-restart on crash
7. ⏰ PM2 integration

#### **Can Defer to Phase 8 (2-3 weeks)**

8. ⏰ Metadata caching
9. ⏰ Config schema validation
10. ⏰ Dynamic port allocation

---

## Summary & Next Actions

### Your Questions Answered

1. **Healthcheck**: ❌ Missing, should add `/health` endpoint
2. **Build Process**: ✅ Exists for legacy, partially works for SDK v2
3. **Future Phases**: Some concerns deferred to Phase 7/8, but we should fix healthcheck + build now

### Recommended Immediate Actions

```bash
# 1. Add /health endpoint (30 min)
# 2. Update build detection for SDK v2 (30 min)
# 3. Document port conventions (10 min)
```

**Total time investment**: ~1.5 hours to make it production-ready

### What Can Wait

- Auto-start workers (Phase 7)
- Health monitoring loop (Phase 7)
- Metadata caching (Phase 8)
- Port allocation pool (Phase 7)

**Want me to implement the healthcheck endpoint and build detection now?** These are quick wins that significantly improve the system.
