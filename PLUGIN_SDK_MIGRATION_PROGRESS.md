# Plugin SDK Migration Progress Tracker

**Migration Goal**: Consolidate to single plugin SDK, remove all "v2" naming conventions

**Started**: 2025-12-22
**Status**: Not Started
**Current Phase**: Phase 1 - Plugin Migrations

---

## Phase 1: Migrate Plugins to New SDK ⏳

**Status**: 0/9 complete

### Migration Checklist

- [ ] **1. Email** (already has v2 version)
  - [ ] Delete old `src/index.ts`
  - [ ] Rename `src/index-v2.ts` → `src/index.ts`
  - [ ] Delete `tsconfig-v2.json` or rename to `tsconfig.json`
  - [ ] Update imports in `package.json`
  - [ ] Build and test

- [ ] **2. Hubspot**
  - [ ] Read current `src/index.ts`
  - [ ] Rewrite using `defineHayPlugin()` pattern
  - [ ] Update config registration
  - [ ] Update MCP registration
  - [ ] Build and test

- [ ] **3. Judo-in-Cloud**
  - [ ] Read current `src/index.ts`
  - [ ] Rewrite using `defineHayPlugin()` pattern
  - [ ] Update config registration
  - [ ] Update MCP registration
  - [ ] Build and test

- [ ] **4. Magento**
  - [ ] Read current `src/index.ts`
  - [ ] Rewrite using `defineHayPlugin()` pattern
  - [ ] Update config registration
  - [ ] Update MCP registration
  - [ ] Build and test

- [ ] **5. Shopify**
  - [ ] Read current `src/index.ts`
  - [ ] Rewrite using `defineHayPlugin()` pattern
  - [ ] Update config registration
  - [ ] Update MCP registration
  - [ ] Build and test

- [ ] **6. Simple-HTTP-Test**
  - [ ] Read current `src/index.ts`
  - [ ] Rewrite using `defineHayPlugin()` pattern
  - [ ] Update config registration
  - [ ] Update MCP registration
  - [ ] Build and test

- [ ] **7. Stripe**
  - [ ] Read current `src/index.ts`
  - [ ] Rewrite using `defineHayPlugin()` pattern
  - [ ] Update config registration
  - [ ] Update MCP registration (OAuth2)
  - [ ] Build and test

- [ ] **8. WooCommerce**
  - [ ] Read current `src/index.ts`
  - [ ] Rewrite using `defineHayPlugin()` pattern
  - [ ] Update config registration
  - [ ] Update MCP registration
  - [ ] Build and test

- [ ] **9. Zendesk**
  - [ ] Read current `src/index.ts`
  - [ ] Rewrite using `defineHayPlugin()` pattern
  - [ ] Update config registration
  - [ ] Update MCP registration
  - [ ] Build and test

---

## Phase 2: Delete Old SDK & Legacy Code ⏸️

**Status**: Not Started

### Deletion Checklist

- [ ] Delete `/packages/plugin-sdk/` directory (old class-based SDK)
- [ ] Delete `/plugins/base/` directory (legacy base classes)
- [ ] Delete email plugin old files (if any remain after Phase 1)
- [ ] Verify no imports reference deleted code

---

## Phase 3: Rename SDK v2 → SDK (Remove "v2" naming) ⏸️

**Status**: Not Started

### Directory & File Renames

- [ ] Rename `/plugin-sdk-v2/` → `/packages/plugin-sdk/`
- [ ] Update `/packages/plugin-sdk/package.json` name: `@hay/plugin-sdk-v2` → `@hay/plugin-sdk`
- [ ] Rename `/server/types/plugin-sdk-v2.types.ts` → `/server/types/plugin-sdk.types.ts`
- [ ] Rename `/server/services/plugin-runner-v2.service.ts` → `/server/services/plugin-runner.service.ts`

### Type & Class Renames

- [ ] `HayPluginManifestV2` → `HayPluginManifest` in plugin-sdk.types.ts
- [ ] `WorkerInfoV2` → `WorkerInfo` in plugin-sdk.types.ts
- [ ] `PluginRunnerV2Service` → `PluginRunnerService` class rename
- [ ] `getPluginRunnerV2Service()` → `getPluginRunnerService()` function rename

---

## Phase 4: Update Server Code (Remove Dual SDK Support) ⏸️

**Status**: Not Started

### 4.1 Plugin Manager Service

File: `/server/services/plugin-manager.service.ts`

- [ ] Update import: `plugin-sdk-v2.types` → `plugin-sdk.types`
- [ ] Update import: `plugin-runner-v2.service` → `plugin-runner.service`
- [ ] Update import: `WorkerInfoV2` → `WorkerInfo`
- [ ] Delete `WorkerInfoLegacy` interface (lines 16-30)
- [ ] Delete union type for WorkerInfo (line 30)
- [ ] Rename `runnerV2Service` → `runnerService` (line 46)
- [ ] Delete `isSDKv2Plugin()` method
- [ ] Simplify `startPluginWorker()` - remove version detection
- [ ] Simplify `stopPluginWorker()` - remove version routing
- [ ] Remove all `sdkVersion` checks

### 4.2 Plugin Instance Manager Service

File: `/server/services/plugin-instance-manager.service.ts`

- [ ] Update imports from renamed files
- [ ] Remove `isSDKv2` checks (line 98)
- [ ] Always use `pluginRunnerService.startWorker()`
- [ ] Simplify startup logic

### 4.3 MCP Registry Service

File: `/server/services/mcp-registry.service.ts`

- [ ] Update imports from renamed files
- [ ] Remove `worker.sdkVersion === "v2"` checks
- [ ] Assume all plugins use HTTP-based MCP
- [ ] Simplify tool discovery logic

### 4.4 MCP Client Factory Service

File: `/server/services/mcp-client-factory.service.ts`

- [ ] Update imports from renamed files
- [ ] Remove version-based routing (line 28)
- [ ] Always create `LocalHTTPMCPClient` for local plugins
- [ ] Simplify factory logic

### 4.5 Import Updates (35+ files)

**Pattern**: Update all imports from:
- `@server/types/plugin-sdk-v2.types` → `@server/types/plugin-sdk.types`
- `plugin-runner-v2.service` → `plugin-runner.service`

**Files to update**:

Routes (`/server/routes/v1/plugins/`):
- [ ] `plugins.handler.ts`
- [ ] `index.ts`
- [ ] `proxy.ts`
- [ ] Other route files as needed

Services (`/server/services/`):
- [ ] `plugin-metadata.service.ts`
- [ ] `plugin-tools.service.ts`
- [ ] `plugin-ui.service.ts`
- [ ] `plugin-route.service.ts`
- [ ] Other services as needed

Entities (`/server/entities/`):
- [ ] `plugin-registry.entity.ts`
- [ ] `plugin-instance.entity.ts`

Other:
- [ ] Search codebase for all remaining references
- [ ] Update any test files

---

## Phase 5: Update Plugin Package Dependencies ⏸️

**Status**: Not Started

### Package.json Updates

Update all 9 plugin `package.json` files with:
```json
"dependencies": {
  "@hay/plugin-sdk": "file:../../../packages/plugin-sdk"
}
```

- [ ] `plugins/core/email/package.json`
- [ ] `plugins/core/hubspot/package.json`
- [ ] `plugins/core/judo-in-cloud/package.json`
- [ ] `plugins/core/magento/package.json`
- [ ] `plugins/core/shopify/package.json`
- [ ] `plugins/core/simple-http-test/package.json`
- [ ] `plugins/core/stripe/package.json`
- [ ] `plugins/core/woocommerce/package.json`
- [ ] `plugins/core/zendesk/package.json`

---

## Phase 6: Documentation & Build Updates ⏸️

**Status**: Not Started

### Documentation Files

- [ ] `/CLAUDE.md` - Remove all "v2" references
- [ ] `/docs/PLUGIN_API.md` - Update SDK import examples
- [ ] `/docs/PLUGIN_QUICK_REFERENCE.md` - Update code examples
- [ ] `/.claude/PLUGIN_GENERATION_WORKFLOW.md` - Update references
- [ ] `/packages/plugin-sdk/README.md` - Remove "v2" from title and content

### Archive Phase Documents

- [ ] Create `/docs/archive/sdk-v2-migration/` directory
- [ ] Move all `PHASE_*.md` files from `/plugin-sdk-v2/` to archive (13 files)
- [ ] Move SDK v2 planning documents to archive

### Build Scripts

- [ ] Root `package.json` - Review for SDK references
- [ ] `/scripts/build-plugins.sh` - Update SDK path if needed
- [ ] Verify all build scripts work

---

## Final Verification Checklist ⏸️

**Status**: Not Started

### Build & Type Check

- [ ] `npm run clean:all`
- [ ] `npm install`
- [ ] `npm run build` (all packages build successfully)
- [ ] `npm run typecheck` (no type errors)
- [ ] `npm run lint` (no linting errors)

### Server Testing

- [ ] Server starts without errors
- [ ] All 9 plugins load successfully
- [ ] Plugin metadata endpoints work
- [ ] MCP connections established

### Plugin Testing

Test each plugin individually:

- [ ] **Email** - Config UI, tool execution
- [ ] **Hubspot** - Config UI, MCP tools
- [ ] **Judo-in-Cloud** - OAuth flow, MCP tools
- [ ] **Magento** - Config UI, MCP tools
- [ ] **Shopify** - Config UI, MCP tools
- [ ] **Simple-HTTP-Test** - Basic functionality
- [ ] **Stripe** - OAuth flow, MCP tools
- [ ] **WooCommerce** - Config UI, MCP tools
- [ ] **Zendesk** - Config UI, MCP tools

### Code Cleanup Verification

- [ ] No references to "v2" or "SDKv2" in active code (excluding archived docs)
- [ ] No references to `/packages/plugin-sdk/` old SDK
- [ ] No references to `/plugins/base/`
- [ ] All old SDK files deleted
- [ ] TypeScript compiles without errors

---

## Session Notes

### Session 1 (2025-12-22)
- Created migration plan
- Created progress tracking document
- Ready to begin Phase 1

### Session 2
*Notes from next session...*

---

## Quick Reference: Migration Pattern

```typescript
// OLD SDK (class-based)
import { HayPlugin, startPluginWorker } from '@hay/plugin-sdk';

export class PluginName extends HayPlugin {
  async onInitialize() {
    this.registerConfigOption('key', { ... });
  }
  protected async registerMCP() {
    await this.sdk.mcp.registerRemoteMCP({ ... });
  }
}

if (require.main === module) {
  startPluginWorker(PluginName);
}

// NEW SDK (factory-based)
import { defineHayPlugin } from '@hay/plugin-sdk';

export default defineHayPlugin((globalCtx) => ({
  name: 'PluginName',

  onInitialize(ctx) {
    ctx.register.config({
      key: { type: 'string', label: '...', ... }
    });
  },

  async onStart(ctx) {
    await ctx.mcp.startExternal({
      url: '...',
      auth: { ... },
      tools: [...]
    });
  }
}));
```

---

## Estimated Time Remaining

- Phase 1: 8-12 hours (plugin migrations)
- Phase 2: 30 minutes (deletions)
- Phase 3: 1 hour (renames)
- Phase 4: 4-6 hours (server updates)
- Phase 5: 30 minutes (package.json)
- Phase 6: 1-2 hours (documentation)

**Total**: ~15-22 hours
**Completed**: 0 hours
**Remaining**: ~15-22 hours
