# Plugin SDK Migration Progress Tracker

**Migration Goal**: Consolidate to single plugin SDK, remove all "v2" naming conventions

**Started**: 2025-12-22
**Status**: Not Started
**Current Phase**: Phase 1 - Plugin Migrations

---

## Phase 1: Migrate Plugins to New SDK ⏳

**Status**: 2/9 complete (22%)

### Standard Migration Checklist (Per Plugin)

Each plugin migration should follow these steps:

**Core Migration**:
- [ ] Read current `src/index.ts` to understand existing implementation
- [ ] Rewrite using `defineHayPlugin()` factory pattern
- [ ] Update config registration (`this.registerConfigOption` → `ctx.register.config`)
- [ ] Update auth registration if applicable (`this.registerAuth*` → `ctx.register.auth.*`)
- [ ] Update MCP registration (`registerMCP()` → `ctx.mcp.startLocal/startExternal` in `onStart`)
- [ ] Update UI extension registration if applicable (`this.registerUIExtension` → `ctx.register.ui`)
- [ ] Update route registration if applicable (`this.registerRoute` → `ctx.register.route`)

**Hook Implementation**:
- [ ] Implement `onInitialize` - Register config, auth, routes, UI extensions
- [ ] Implement `onStart` - Start MCP servers, connect to external services
- [ ] Implement `onValidateAuth` - Validate credentials (if auth capability exists)
- [ ] Implement `onConfigUpdate` - Handle config changes (if config capability exists)
- [ ] Implement `onDisable` - Cleanup resources when plugin disabled
- [ ] Implement `onEnable` - (Optional) Handle re-enable after disable

**Package & Cleanup**:
- [ ] Add SDK dependency to `package.json`: `"@hay/plugin-sdk-v2": "file:../../../plugin-sdk-v2"`
- [ ] Add TypeScript dev dependencies: `@types/node`, `typescript`
- [ ] Update imports to use `@hay/plugin-sdk-v2` instead of direct file paths
- [ ] Delete old test files, backup files, and legacy artifacts
- [ ] Ensure `tsconfig.json` is properly configured

**Testing**:
- [ ] Build plugin: `npm run build`
- [ ] Verify TypeScript compilation succeeds
- [ ] Test plugin loads in server
- [ ] Test MCP tools are discoverable
- [ ] Test config UI if applicable
- [ ] Test auth flow if applicable

---

### Plugin Migration Order & Status

- [x] **1. Email** ✅ COMPLETE
  - [x] Core migration complete
  - [x] Add SDK dependency to package.json
  - [x] Update import to use `@hay/plugin-sdk-v2`
  - [x] Delete test files: `test-mcp-endpoint.js`, `test-plugin.js`, `test-worker-spawn.js`, `package-v1.json.backup`
  - [x] Add missing hooks: `onEnable`
  - [x] Final verification - builds successfully

- [x] **2. HubSpot** ✅ COMPLETE
  - [x] Core migration complete
  - [x] Add SDK dependency to package.json
  - [x] Update import to use `@hay/plugin-sdk-v2`
  - [x] Add missing hooks: `onDisable`, `onConfigUpdate`, `onEnable`
  - [x] Final verification - builds successfully

- [ ] **3. Zendesk** 🎯 NEXT PRIORITY (UI Component Architecture Decision)
  - **Priority**: HIGH - Has UI components, needs V2 UI architecture decision
  - **Complexity**: ⭐⭐⭐ Medium-High
  - **Features**: Local MCP, UI Extensions (after-settings slot with Vue component)
  - **Decision Needed**: Define how plugins will create/inject Vue components in V2
  - **Migration Steps**:
    - [ ] Read current implementation (local MCP + UI extension)
    - [ ] **DESIGN PHASE**: Define V2 UI extension architecture
      - [ ] Decide: Plugin-provided Vue components vs. server-side rendering?
      - [ ] Decide: Component registration API in `ctx.register.ui()`
      - [ ] Decide: How plugins bundle/serve Vue components
      - [ ] Document pattern for future plugins
    - [ ] Implement new UI extension pattern
    - [ ] Migrate MCP registration (local MCP server)
    - [ ] Test UI component rendering in dashboard
    - [ ] Document UI migration pattern for other plugins

- [ ] **4. Shopify** (UI Component Test #2)
  - **Complexity**: ⭐⭐⭐ Medium-High
  - **Features**: Local MCP, UI Extensions (after-settings slot)
  - **Note**: Second plugin with UI components, validates Zendesk pattern
  - **Migration**: Follow standard checklist + Zendesk UI pattern
  - [ ] Apply UI extension pattern from Zendesk
  - [ ] Migrate local MCP server
  - [ ] Test UI components

- [ ] **5. Stripe** (OAuth2 + External MCP)
  - **Complexity**: ⭐⭐ Medium
  - **Features**: OAuth2, External MCP, tools.json
  - **Similar to**: HubSpot
  - **Migration**: Follow standard checklist + HubSpot OAuth2 pattern
  - [ ] Copy OAuth2 pattern from HubSpot
  - [ ] Convert `registerRemoteMCP` → `ctx.mcp.startExternal`
  - [ ] Use existing `tools.json` for tool metadata

- [ ] **6. WooCommerce** (API Key + Local MCP)
  - **Complexity**: ⭐⭐ Medium
  - **Features**: API Key auth, Local MCP
  - **New Pattern**: First plugin with API Key auth in V2
  - **Migration**: Follow standard checklist + new API Key pattern
  - [ ] Implement `ctx.register.auth.apiKey()` pattern
  - [ ] Migrate local MCP
  - [ ] Document API Key pattern for future plugins

- [ ] **7. Magento** (API Key + Local MCP)
  - **Complexity**: ⭐⭐ Medium
  - **Features**: API Key auth, Local MCP
  - **Similar to**: WooCommerce
  - **Migration**: Follow standard checklist + WooCommerce API Key pattern
  - [ ] Apply API Key pattern from WooCommerce
  - [ ] Migrate local MCP

- [ ] **8. Judo-in-Cloud**
  - **Complexity**: ⭐⭐ Medium
  - **Features**: TBD (need to investigate)
  - **Migration**: Follow standard checklist
  - [ ] Investigate current implementation
  - [ ] Determine migration approach
  - [ ] Migrate using appropriate pattern

- [ ] **9. Simple-HTTP-Test** (Testing Plugin)
  - **Complexity**: ⭐ Low
  - **Features**: Basic HTTP testing
  - **Note**: Simplest plugin, good for validation
  - **Migration**: Follow standard checklist
  - [ ] Migrate basic plugin structure
  - [ ] Useful for testing plugin loading/lifecycle

---

## UI Component Architecture Decision 🎨

**Status**: Not Yet Decided - To be addressed during Zendesk migration

### Current V1 Approach
Plugins register Vue components that are rendered in specific slots:
```typescript
this.registerUIExtension({
  slot: 'after-settings',
  component: 'components/settings/AfterSettings.vue',
});
```

### V2 Architecture Options

**Option 1: Plugin-Provided Vue Components** ✨ (Recommended approach to explore first)
- Plugins ship with Vue 3 components in their `components/` directory
- Components are registered via `ctx.register.ui()` in `onInitialize`
- Dashboard dynamically imports and renders plugin components
- Plugins can use Vue 3 Composition API, composables, etc.

**Pros**:
- Maximum flexibility for plugin developers
- Plugins control their own UI/UX
- Can use full Vue ecosystem (Pinia stores, composables, etc.)
- Natural fit with existing V1 pattern

**Cons**:
- Need to solve: component bundling/serving
- Need to solve: Vue version compatibility
- Need to solve: shared dependencies (Tailwind, UI components)

**Option 2: Server-Side Rendering / Configuration**
- Plugins provide UI configuration (JSON schema)
- Dashboard renders UI based on configuration
- More restricted but simpler

**Pros**:
- Simpler to implement
- No component bundling needed
- Easier version compatibility

**Cons**:
- Less flexible for complex UIs
- May not handle all use cases (tutorial images, custom layouts)

**Option 3: Hybrid Approach**
- Simple UIs use configuration (Option 2)
- Complex UIs use Vue components (Option 1)
- Plugins choose based on needs

### Open Questions
- [ ] How do plugins bundle/serve Vue components?
- [ ] How do we handle Vue version compatibility?
- [ ] Can plugins share Tailwind classes and UI components from dashboard?
- [ ] How do we handle plugin component hot reload in dev?
- [ ] Should plugins have access to dashboard composables/stores?
- [ ] How do we prevent plugins from breaking dashboard UI?

### Decision Process
1. Review Zendesk's current UI component (tutorial with images, links)
2. Review Shopify's current UI component
3. Prototype Option 1 (Vue components) with Zendesk
4. Document trade-offs and implementation details
5. Make architectural decision for V2
6. Update SDK types and documentation

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

### Session 2 (2025-12-27)
- **Completed comprehensive review** of Email and HubSpot migrations
- Created `PLUGIN_SDK_V2_REVIEW.md` with detailed analysis
- **Key Findings**:
  - ✅ Both plugins architecturally sound and working
  - ⚠️ Both missing SDK dependency in package.json (critical fix needed)
  - ⚠️ Both using direct file imports instead of `@hay/plugin-sdk-v2`
  - 📝 Email has old test files that need cleanup
  - 📝 Both missing some optional hooks (`onEnable`, `onDisable`, `onConfigUpdate`)
- **Updated Migration Plan**:
  - Added comprehensive standard checklist with all hooks
  - Added package dependency and cleanup steps
  - Reorganized plugin order with Zendesk as #3 priority
  - Added complexity ratings and pattern references for each plugin
  - Added UI Component Architecture Decision section
- **Architectural Patterns Documented** (5 patterns):
  1. Config + Auth integration using `ctx.config.field()`
  2. Local MCP server factory pattern
  3. External MCP with dynamic auth headers
  4. Graceful OAuth token handling
  5. Config resolution with fallbacks
- **Next Steps**:
  - Zendesk migration will define V2 UI component architecture
  - Need to decide: Plugin-provided Vue components vs. configuration-based UI
  - Clean up Email and HubSpot (add dependencies, fix imports, add hooks)

### Session 3 (2025-12-27)
- **Completed Email and HubSpot cleanup**:
  - ✅ Added SDK dependency to both package.json files
  - ✅ Updated imports from direct file paths to `@hay/plugin-sdk-v2`
  - ✅ Fixed SDK package.json exports (removed `.mjs` references, using `.js`)
  - ✅ Built plugin-sdk-v2 successfully
  - ✅ Deleted old test files from Email plugin (4 files removed)
  - ✅ Added `onEnable` hook to Email plugin
  - ✅ Added `onDisable`, `onConfigUpdate`, and `onEnable` hooks to HubSpot plugin
  - ✅ Both plugins build successfully with no TypeScript errors
- **Status**: Email and HubSpot plugins are now **COMPLETE** and ready for use
- **Next Steps**:
  - Zendesk migration (#3) - will define UI component architecture
  - Continue with remaining 7 plugins

### Session 4 (2025-12-28)
- **Fixed Medium Priority Issues** from code review:
  - ✅ **Removed legacy UI registration**: Deleted `register.ui(extension)` callable method, kept only `register.ui.page()`
    - Updated [plugin-sdk-v2/types/register.ts](plugin-sdk-v2/types/register.ts) and [plugin-sdk-v2/sdk/register.ts](plugin-sdk-v2/sdk/register.ts)
    - Cleaner API with single registration pattern
  - ✅ **Replaced magic number**: Added `AUTO_TEST_DELAY_MS = 3000` constant in [dashboard/pages/integrations/plugins/[pluginId].vue](dashboard/pages/integrations/plugins/[pluginId].vue#L577)
  - ✅ **Added validation**: `handleCancelEditEnvField()` and `handleResetToEnv()` in [PluginConfigForm.vue](dashboard/components/plugins/PluginConfigForm.vue) now validate fields exist and have correct metadata
  - ✅ **Real API validation**: Zendesk `onValidateAuth()` now makes actual API call to `/api/v2/users/me.json` to verify credentials work
  - ✅ **CSS load completion**: [usePluginRegistry.ts](dashboard/composables/usePluginRegistry.ts) now waits for CSS to load before loading scripts
  - ✅ **Refactored auto-test logic**: Extracted `isAuthConfigured()` helper function, reduced complexity from 70+ lines to ~30 lines
  - ✅ **Improved MCP feedback**: Zendesk now logs clear info message when credentials not configured, and `onConfigUpdate()` calls `ctx.requestRestart()` to apply changes
- **Impact**: Better code quality, clearer error handling, more reliable plugin UI loading
- **Next Steps**:
  - Continue with remaining medium/low priority issues if needed
  - Resume Zendesk migration for UI architecture decision

### Session 5
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

### Updated Estimates (Session 2)

- **Phase 1**: 10-16 hours (plugin migrations)
  - Email cleanup: 30 min
  - HubSpot cleanup: 30 min
  - Zendesk (with UI architecture design): 4-6 hours ⚠️ Critical path
  - Shopify (UI validation): 2-3 hours
  - Stripe: 1-2 hours
  - WooCommerce (new API Key pattern): 2-3 hours
  - Magento: 1-2 hours
  - Judo-in-Cloud: 1-2 hours
  - Simple-HTTP-Test: 30 min

- **Phase 2**: 30 minutes (deletions)
- **Phase 3**: 1 hour (renames)
- **Phase 4**: 4-6 hours (server updates)
- **Phase 5**: 30 minutes (package.json updates)
- **Phase 6**: 1-2 hours (documentation)

**Total**: ~17-26 hours
**Completed**: ~2 hours (Email + HubSpot core migrations)
**Remaining**: ~15-24 hours

**Critical Path**: Zendesk UI architecture decision - may add 2-4 hours if complex
