# Phase 4 Runner Fix: Factory Function Support

**Date**: 2025-12-15
**Status**: ✅ Complete

## Summary

Fixed the Phase 4 runner to properly handle the factory function pattern specified in PLUGIN.md. The runner now correctly loads plugins that use `defineHayPlugin()` by calling the factory function with the global context.

## Changes Made

### 1. Updated `runner/plugin-loader.ts`

**Changes**:
- Added `globalContext` parameter to `loadPlugin()` function
- Added factory function detection: `typeof pluginDefinition === 'function'`
- Call factory with global context if detected
- Maintains backwards compatibility with direct object exports

**Code**:
```typescript
export async function loadPlugin(
  entryPath: string,
  pluginName: string,
  globalContext: HayGlobalContext  // ← NEW
): Promise<HayPluginDefinition> {
  // ... load module

  let pluginDefinition = pluginModule.default;

  // Check if export is a factory function
  if (typeof pluginDefinition === 'function') {
    pluginDefinition = pluginDefinition(globalContext);
  }

  // ... validate and return
}
```

### 2. Updated `runner/index.ts`

**Changes**:
- Reordered initialization to create global context **before** loading plugin
- Pass global context to `loadPlugin()`
- Declare `registry` variable earlier in scope

**Before**:
```typescript
state.plugin = await loadPlugin(validated.entryPath, manifest.displayName);
const registry = new PluginRegistry();
const globalCtx = createGlobalContext(logger, registry, manifest);
```

**After**:
```typescript
registry = new PluginRegistry();
const globalCtx = createGlobalContext(logger, registry, manifest);
state.plugin = await loadPlugin(validated.entryPath, manifest.displayName, globalCtx);
```

## Test Results

Tested with Stripe example plugin:

```bash
node dist/runner/index.js \
  --plugin-path=examples/stripe \
  --org-id=test-org \
  --port=48001 \
  --mode=test
```

### ✅ All Tests Passing

1. **Plugin Loading**:
   - ✅ Manifest loaded successfully
   - ✅ Plugin code loaded (factory function called)
   - ✅ Plugin definition created with correct structure

2. **Lifecycle Hooks**:
   - ✅ `onInitialize` executed and registered all components
   - ✅ `onStart` executed for org runtime
   - ✅ `onDisable` executed on shutdown

3. **Registrations**:
   - ✅ Config schema (3 fields: apiKey, webhookSecret, enableTestMode)
   - ✅ Auth method (API key)
   - ✅ HTTP routes (POST /webhook, GET /health)
   - ✅ UI extensions (2 slots)

4. **HTTP Server**:
   - ✅ Server started on port 48001
   - ✅ `GET /health` returns `{"status":"ok","plugin":"stripe"}`
   - ✅ `GET /metadata` returns full plugin metadata

5. **Graceful Shutdown**:
   - ✅ `onDisable` hook executed
   - ✅ HTTP server stopped cleanly
   - ✅ No errors or warnings

## Backwards Compatibility

The fix maintains full backwards compatibility:

- **Factory functions** (spec-compliant): Automatically detected and called
- **Direct object exports** (legacy): Still work as before

## Files Modified

1. [plugin-sdk-v2/runner/plugin-loader.ts](plugin-sdk-v2/runner/plugin-loader.ts)
2. [plugin-sdk-v2/runner/index.ts](plugin-sdk-v2/runner/index.ts)

## Related Documentation

- [PHASE_4_RUNNER_ISSUE.md](PHASE_4_RUNNER_ISSUE.md) - Detailed issue analysis
- [PLUGIN.md](../PLUGIN.md) - Plugin specification
- [PHASE_5_COMPLETE.md](PHASE_5_COMPLETE.md) - Example plugin implementation

## Next Steps

The runner is now fully functional and ready for integration with the main Hay application. The fix enables:

1. ✅ Plugin development using the spec-compliant factory pattern
2. ✅ Full access to global context in plugin initialization
3. ✅ Proper separation of concerns (plugin loading vs initialization)
4. ✅ All lifecycle hooks working as intended

---

**Implementation Time**: ~15 minutes
**Lines Changed**: ~20 lines across 2 files
**Test Coverage**: Full end-to-end test with Stripe example plugin
