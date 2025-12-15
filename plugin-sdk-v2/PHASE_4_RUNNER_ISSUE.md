# Phase 4 Runner Issue: Factory Function Handling

**Date**: 2025-12-15
**Severity**: High - Blocks plugin execution
**Status**: ✅ FIXED (2025-12-15)

## Fix Summary

The runner has been updated to properly handle factory functions returned by `defineHayPlugin()`. The plugin loader now:
1. Creates the global context before loading the plugin
2. Detects if the plugin export is a function (factory pattern)
3. Calls the factory with the global context to get the plugin definition
4. Supports both factory functions (spec-compliant) and direct object exports (legacy)

**Test Results**: ✅ All hooks execute correctly, HTTP server starts, endpoints respond properly.

## Problem Summary (Original Issue)

The Phase 4 runner implementation expected plugins to export a `HayPluginDefinition` object directly, but the Phase 3 SDK implementation and PLUGIN.md specification define that plugins should use `defineHayPlugin()` which returns a **factory function** that must be called with a global context to produce the plugin definition.

This mismatch prevented plugins from loading successfully.

## Root Cause Analysis

### What the Spec Says (PLUGIN.md)

From Section 5.1 (lines 302-327):

```typescript
export default defineHayPlugin((globalCtx) => {
  return {
    name: "Shopify",
    onInitialize() { /* ... */ },
    async onStart(startCtx) { /* ... */ },
    // ... other hooks
  };
});
```

The spec clearly shows:
1. `defineHayPlugin()` takes a **factory function** as parameter
2. The factory function receives `globalCtx` and returns a plugin definition
3. Plugins export the result of calling `defineHayPlugin()`

### What Phase 3 Implemented

File: `sdk/factory.ts` (lines 111-113)

```typescript
export function defineHayPlugin(
  factory: HayPluginFactory,
): HayPluginFactory {
  // ... validation
  return factory; // Returns the factory, not the result!
}
```

**Implementation**: `defineHayPlugin()` returns the factory function itself (pass-through).

This means:
- Plugin exports: `defineHayPlugin((ctx) => ({ name: "X", ... }))`
- What gets exported: A function `(ctx) => ({ name: "X", ... })`
- Not: The plugin definition object

### What Phase 4 Runner Expects

File: `runner/plugin-loader.ts` (lines 52-57)

```typescript
const pluginDefinition = pluginModule.default;

// Validate plugin definition structure
validatePluginDefinition(pluginDefinition, pluginName);

return pluginDefinition as HayPluginDefinition;
```

File: `runner/plugin-loader.ts` (lines 73-78)

```typescript
function validatePluginDefinition(def: any, pluginName: string): void {
  if (!def || typeof def !== 'object') {
    throw new Error(
      `Plugin "${pluginName}" must export an object (HayPluginDefinition)`
    );
  }
  // ... validates `name` field exists
}
```

**Implementation**: The runner expects `pluginModule.default` to be an **object** with a `name` field.

**What actually happens**:
- Plugin exports a factory function
- `typeof pluginModule.default === 'function'`
- Validation fails: "must export an object (HayPluginDefinition)"

## Error Message

```
[2025-12-15T17:46:29.222Z] [org:test-org] ERROR: Failed to load plugin
{"error":"Plugin \"Stripe\" must export an object (HayPluginDefinition)"}
```

## Architecture Mismatch

```
┌─────────────────────────────────────────────────────────────────┐
│ PLUGIN.md Specification                                         │
├─────────────────────────────────────────────────────────────────┤
│ export default defineHayPlugin((globalCtx) => ({               │
│   name: "Plugin",                                               │
│   onInitialize() { /* uses globalCtx */ }                       │
│ }));                                                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Phase 3: SDK Implementation (sdk/factory.ts)                    │
├─────────────────────────────────────────────────────────────────┤
│ function defineHayPlugin(factory) {                             │
│   return factory; // ← Returns factory function                 │
│ }                                                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Plugin Export (examples/stripe/src/index.ts)                    │
├─────────────────────────────────────────────────────────────────┤
│ export default defineHayPlugin((globalCtx) => ({ ... }));       │
│                                                                  │
│ Result: Exports a FUNCTION (globalCtx) => ({ ... })             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Phase 4: Runner (runner/plugin-loader.ts)                       │
├─────────────────────────────────────────────────────────────────┤
│ const pluginDefinition = pluginModule.default;                  │
│                                                                  │
│ if (!def || typeof def !== 'object') {  // ← Expects OBJECT     │
│   throw new Error("must export an object");                     │
│ }                                                                │
│                                                                  │
│ ❌ FAILS: pluginDefinition is a function, not an object          │
└─────────────────────────────────────────────────────────────────┘
```

## Solution Options

### Option 1: Update Runner to Call Factory (Recommended)

**Change**: Modify `runner/plugin-loader.ts` to detect and call factory functions.

**Implementation**:

```typescript
// In plugin-loader.ts

export async function loadPlugin(
  entryPath: string,
  pluginName: string,
  globalContext: HayGlobalContext  // ← NEW: Pass global context
): Promise<HayPluginDefinition> {
  let pluginModule: any;

  try {
    pluginModule = await import(entryPath);
  } catch (err) {
    throw new Error(`Failed to load plugin "${pluginName}": ${err}`);
  }

  if (!pluginModule.default) {
    throw new Error(`Plugin "${pluginName}" must export a default value`);
  }

  let pluginDefinition = pluginModule.default;

  // NEW: Check if export is a factory function
  if (typeof pluginDefinition === 'function') {
    try {
      // Call factory with global context to get plugin definition
      pluginDefinition = pluginDefinition(globalContext);
    } catch (err) {
      throw new Error(
        `Plugin "${pluginName}" factory function failed: ${err}`
      );
    }
  }

  // Validate plugin definition structure
  validatePluginDefinition(pluginDefinition, pluginName);

  return pluginDefinition as HayPluginDefinition;
}
```

**Runner index.ts changes**:

```typescript
// BEFORE (current):
state.plugin = await loadPlugin(validated.entryPath, manifest.displayName);

const globalCtx = createGlobalContext(logger, registry, manifest);
await executeOnInitialize(state.plugin, globalCtx, logger);

// AFTER (proposed):
const registry = new PluginRegistry();
const globalCtx = createGlobalContext(logger, registry, manifest);

// Pass global context to plugin loader
state.plugin = await loadPlugin(
  validated.entryPath,
  manifest.displayName,
  globalCtx  // ← NEW
);

await executeOnInitialize(state.plugin, globalCtx, logger);
```

**Pros**:
- ✅ Matches PLUGIN.md specification
- ✅ Supports factory pattern properly
- ✅ Minimal code changes
- ✅ Backwards compatible (still works with direct object exports)

**Cons**:
- Requires updating runner phase order slightly
- Global context must be created before loading plugin

### Option 2: Change SDK to Return Plugin Definition

**Change**: Modify `sdk/factory.ts` to call the factory and return the result.

**Problem**: This won't work because `defineHayPlugin()` doesn't have access to the global context. The global context is created by the runner **after** the plugin is loaded.

**Conclusion**: Not viable.

### Option 3: Two-Phase Loading

**Change**: Load plugin factory, then call it with context.

**Implementation**:

```typescript
// Load factory
const pluginFactory = await loadPluginFactory(entryPath, pluginName);

// Create global context
const globalCtx = createGlobalContext(logger, registry, manifest);

// Call factory to get plugin definition
const pluginDefinition = pluginFactory(globalCtx);
```

**Pros**:
- Clear separation of concerns
- Matches spec intention

**Cons**:
- More code changes
- Slightly more complex

## Impact Assessment

### Files That Need Changes

**Option 1 (Recommended)**:

1. **`runner/plugin-loader.ts`**:
   - Update `loadPlugin()` signature to accept `HayGlobalContext`
   - Add factory function detection
   - Call factory if detected

2. **`runner/index.ts`**:
   - Reorder: Create global context before loading plugin
   - Pass global context to `loadPlugin()`

### Breaking Changes

- None if implemented correctly
- Should support both patterns:
  - Factory function (spec-compliant): `defineHayPlugin((ctx) => ({ ... }))`
  - Direct object (legacy): `export default { name: "X", ... }`

## Testing Checklist

After fix is implemented:

- [ ] Example plugin (Stripe) loads successfully
- [ ] `onInitialize` hook receives correct global context
- [ ] `onStart` hook executes with org runtime context
- [ ] HTTP server starts with registered routes
- [ ] `/metadata` endpoint returns correct schema
- [ ] MCP servers start successfully
- [ ] Auth validation works
- [ ] All hooks execute in correct order
- [ ] Graceful shutdown works

## Additional Issues Fixed During Phase 5

While testing Phase 5, several Phase 4 issues were discovered and fixed:

### 1. ✅ TypeScript Module Configuration

**Issue**: TypeScript was compiling to CommonJS, but `package.json` had `"type": "module"`.

**Fix**: Changed `tsconfig.json`:
```json
{
  "compilerOptions": {
    "module": "ES2022"  // Was: "commonjs"
  }
}
```

**Files modified**:
- `plugin-sdk-v2/tsconfig.json`
- `plugin-sdk-v2/package.json` (added `"type": "module"`)
- `examples/stripe/package.json` (added `"type": "module"`)

### 2. ✅ ES Module Imports Missing .js Extensions

**Issue**: ES modules require explicit `.js` extensions in import statements.

**Fix**: Added `.js` to all relative imports:
```typescript
// BEFORE:
import { parseArgs } from './bootstrap';

// AFTER:
import { parseArgs } from './bootstrap.js';
```

**Files modified**: All files in `runner/` and `sdk/` directories.

### 3. ✅ require.main === module Not Compatible with ES Modules

**Issue**: `require.main === module` doesn't work in ES modules.

**Fix**: Changed to ES module pattern:
```typescript
// BEFORE:
if (require.main === module) {
  main().catch(...);
}

// AFTER:
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(...);
}
```

**File modified**: `runner/index.ts`

### 4. ✅ Unused Import

**Issue**: `join` imported but never used in `runner/bootstrap.ts`.

**Fix**: Removed from import statement.

### 5. ✅ Argument Parsing Type Safety

**Issue**: TypeScript couldn't prove `argv[i]` wasn't undefined.

**Fix**: Added type guard:
```typescript
// BEFORE:
for (let i = 2; i < argv.length; i++) {
  const arg = argv[i];
  if (arg.startsWith('--plugin-path=')) { ... }
}

// AFTER:
for (let i = 2; i < argv.length; i++) {
  const arg = argv[i];
  if (typeof arg !== 'string') continue;
  if (arg.startsWith('--plugin-path=')) { ... }
}
```

**File modified**: `runner/bootstrap.ts`

## Recommendation

**Implement Option 1** - Update runner to call factory functions.

This is the cleanest solution that:
1. Matches the PLUGIN.md specification exactly
2. Requires minimal code changes
3. Maintains backwards compatibility
4. Properly separates concerns

**Estimated Effort**: 30-60 minutes

**Priority**: High - Required for Phase 5 example plugin to work

## Related Files

- `PLUGIN.md` - Lines 302-327 (spec for defineHayPlugin)
- `plugin-sdk-v2/sdk/factory.ts` - Factory implementation
- `plugin-sdk-v2/runner/plugin-loader.ts` - Plugin loading logic
- `plugin-sdk-v2/runner/index.ts` - Main runner orchestration
- `plugin-sdk-v2/examples/stripe/src/index.ts` - Example using defineHayPlugin

## Next Steps

1. Implement Option 1 fix in Phase 4 runner
2. Test with Stripe example plugin
3. Verify all hooks execute correctly
4. Update Phase 4 completion documentation
5. Re-test full plugin lifecycle

---

**Note**: Phase 5 deliverables (example plugin code) are complete and correct per spec. The issue is in Phase 4's runner implementation which was built before the factory pattern implications were fully understood.
