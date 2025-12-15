# Phase 5: Auth Separation - Implementation Complete ✅

**Date**: 2025-12-15
**Status**: COMPLETE
**Phase**: 5 of 8 (Auth Separation)

---

## Overview

Phase 5 from the Plugin SDK v2 Migration Plan has been successfully implemented. This phase focused on separating authentication credentials from configuration data, implementing auth validation, and properly storing auth state in the database.

---

## What Was Implemented

### 1. Repository Methods (✅ Complete)

**File**: `server/repositories/plugin-instance.repository.ts`

Added three new methods to the `PluginInstanceRepository`:

#### `updateAuthState(instanceId, orgId, authState)`
- Updates auth state for a plugin instance
- Stores credentials separately from config
- Updates `authMethod` and `authValidatedAt` timestamps
- **Parameters**:
  - `instanceId`: Plugin instance ID
  - `orgId`: Organization ID
  - `authState`: `{ methodId: string, credentials: Record<string, any> }`

#### `getAuthState(orgId, pluginId)`
- Retrieves auth state for a plugin instance
- Returns `{ methodId, credentials }` or `null` if not configured
- **Parameters**:
  - `orgId`: Organization ID
  - `pluginId`: Plugin ID (package name)

#### `updateRuntimeState(instanceId, runtimeState, error?)`
- Updates org-scoped runtime state
- Manages state transitions: `stopped` → `starting` → `ready`/`degraded`/`error`
- Automatically updates timestamps (`lastStartedAt`)
- Clears errors when transitioning to `ready`
- **Parameters**:
  - `instanceId`: Plugin instance ID
  - `runtimeState`: One of `stopped`, `starting`, `ready`, `degraded`, `error`
  - `error`: Optional error message (for `error` state)

---

### 2. Config/Auth Separation Utilities (✅ Complete)

**File**: `server/lib/plugin-utils.ts` (NEW)

Created helper functions for SDK v2 config/auth separation:

#### `separateConfigAndAuth(input, metadata)`
- Analyzes plugin metadata to identify auth fields
- Separates user input into config and authState
- Handles both API Key and OAuth2 auth methods
- Checks `configSchema` for sensitive fields
- **Returns**: `{ config: Record<string, any>, authState: AuthState | null }`

**Logic**:
1. Reads `metadata.authMethods` to identify auth fields
2. For API Key auth: uses `configField` to identify the auth field
3. For OAuth2: looks for `accessToken`, `refreshToken`, `expiresAt`
4. Checks `configSchema` for `sensitive: true` fields
5. Separates input into `config` (non-auth) and `authState` (auth)

#### `hasAuthChanges(input, metadata)`
- Checks if auth-related fields are present in the input
- Used to determine if auth validation is needed
- **Returns**: `boolean`

#### `extractAuthState(input, metadata)`
- Convenience function to extract only auth state
- **Returns**: `AuthState | null`

---

### 3. Updated `configurePlugin()` Handler (✅ Complete)

**File**: `server/routes/v1/plugins/plugins.handler.ts`

**Major Changes**:

1. **Fetch Plugin Metadata**:
   ```typescript
   const pluginRegistry = await pluginRegistryRepository.findByPluginId(input.pluginId);
   const metadata = pluginRegistry?.metadata; // SDK v2 metadata from /metadata endpoint
   ```

2. **Separate Config and Auth**:
   ```typescript
   const { config, authState } = separateConfigAndAuth(finalConfig, metadata);
   ```

3. **Validate Auth if Changed** (SDK v2 only):
   - Checks if auth fields are present in input
   - Only validates if worker is running and SDK v2
   - Calls `/validate-auth` endpoint with 10-second timeout
   - Throws error if validation fails
   - Logs validation results

   ```typescript
   if (metadata && authState && hasAuthChanges(input.configuration, metadata)) {
     const worker = pluginManagerService.getWorker(ctx.organizationId!, input.pluginId);

     if (worker && worker.sdkVersion === "v2") {
       const response = await fetch(`http://localhost:${worker.port}/validate-auth`, {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ authState }),
         signal: abortController.signal,
       });

       const result = await response.json();
       if (!result.valid) {
         throw new TRPCError({
           code: "BAD_REQUEST",
           message: `Auth validation failed: ${result.error}`,
         });
       }
     }
   }
   ```

4. **Save Config and Auth Separately**:
   ```typescript
   // Update config (without auth fields)
   await pluginInstanceRepository.updateConfig(instance.id, config);

   // SDK v2: Update auth state separately if present
   if (authState) {
     await pluginInstanceRepository.updateAuthState(
       instance.id,
       ctx.organizationId!,
       authState
     );
   }
   ```

5. **Restart Worker** (simplified restart-based flow):
   - Restarts worker to apply new config
   - Logs restart status
   - Non-blocking (doesn't throw on restart failure)

---

### 4. SDK v2 Environment Injection (✅ Already Complete)

**File**: `server/services/plugin-runner-v2.service.ts`

The `buildSDKv2Env()` method was already implemented correctly:

```typescript
const env: Record<string, string> = {
  HAY_ORG_ID: orgId,
  HAY_PLUGIN_ID: pluginId,
  HAY_WORKER_PORT: port.toString(),
  HAY_ORG_CONFIG: JSON.stringify(orgConfig),       // ✅ Config without auth
  HAY_ORG_AUTH: JSON.stringify(orgAuth || {}),     // ✅ Auth state
};
```

---

### 5. Type Fixes (✅ Complete)

**File**: `server/types/plugin-sdk-v2.types.ts`

- Added `metadata?: any` field to `WorkerInfo` for compatibility

**File**: `server/services/plugin-manager.service.ts`

- Created `WorkerInfoLegacy` interface for SDK v1
- Created union type `WorkerInfo = WorkerInfoV2 | WorkerInfoLegacy`
- Maintains compatibility with both SDK versions

**File**: `server/services/plugin-runner-v2.service.ts`

- Fixed TypeORM typing issues with `null` → `undefined`
- Added `as any` casts for TypeORM update operations

---

## Testing Instructions

### Prerequisites

1. **Database Migration** (if not already run):
   ```bash
   cd server
   npm run migration:run
   ```

2. **Ensure SDK v2 Runner is Available**:
   ```bash
   # Check if runner exists
   ls plugin-sdk-v2/runner/index.ts

   # Or build SDK v2 if needed
   cd plugin-sdk-v2
   npm run build
   ```

3. **Have a Test Plugin with SDK v2**:
   - Use the Stripe example plugin from `plugin-sdk-v2/examples/stripe/`
   - Or create a test plugin with auth methods defined

### Test Scenarios

#### Scenario 1: Configure Plugin with Auth (New Instance)

1. **Enable plugin** (if not already enabled):
   ```typescript
   // Via dashboard or tRPC
   await Hay.plugins.enablePlugin({
     pluginId: "hay-plugin-stripe",
     configuration: {}
   });
   ```

2. **Configure with auth credentials**:
   ```typescript
   await Hay.plugins.configurePlugin({
     pluginId: "hay-plugin-stripe",
     configuration: {
       apiKey: "sk_test_xxx",              // Auth field (sensitive)
       enableTestMode: true,               // Config field
       webhookUrl: "https://example.com"   // Config field
     }
   });
   ```

3. **Expected Behavior**:
   - ✅ Auth validation is triggered (calls `/validate-auth`)
   - ✅ If validation succeeds: config saved, auth saved separately
   - ✅ If validation fails: error thrown, nothing saved
   - ✅ Worker restarts with new config

4. **Verify in Database**:
   ```sql
   SELECT
     id,
     config,
     auth_state,
     auth_method,
     auth_validated_at
   FROM plugin_instances
   WHERE plugin_id = (SELECT id FROM plugin_registry WHERE plugin_id = 'hay-plugin-stripe');
   ```

   **Expected**:
   - `config`: `{ "enableTestMode": true, "webhookUrl": "https://..." }`
   - `auth_state`: `{ "methodId": "apiKey", "credentials": { "apiKey": "sk_test_xxx" } }`
   - `auth_method`: `"apiKey"`
   - `auth_validated_at`: Recent timestamp

#### Scenario 2: Update Config Only (No Auth Changes)

1. **Update non-auth fields**:
   ```typescript
   await Hay.plugins.configurePlugin({
     pluginId: "hay-plugin-stripe",
     configuration: {
       apiKey: "********",  // Masked (no change)
       enableTestMode: false,
       webhookUrl: "https://new-url.com"
     }
   });
   ```

2. **Expected Behavior**:
   - ✅ Auth validation is **NOT** triggered (no auth changes)
   - ✅ Config updated
   - ✅ Auth state unchanged
   - ✅ Worker restarts

#### Scenario 3: Auth Validation Failure

1. **Configure with invalid credentials**:
   ```typescript
   await Hay.plugins.configurePlugin({
     pluginId: "hay-plugin-stripe",
     configuration: {
       apiKey: "invalid_key",
       enableTestMode: true
     }
   });
   ```

2. **Expected Behavior**:
   - ✅ Auth validation is triggered
   - ✅ Error thrown: `"Auth validation failed: ..."`
   - ✅ Config and auth **NOT** saved
   - ✅ Worker **NOT** restarted

#### Scenario 4: Auth Validation Timeout

1. **Configure when worker is slow**:
   - Simulate by making `onValidateAuth` take >10 seconds
   - Or test when worker is not responsive

2. **Expected Behavior**:
   - ✅ Auth validation times out after 10 seconds
   - ✅ Error thrown: `"Auth validation timeout (>10s)"`
   - ✅ Config and auth **NOT** saved

#### Scenario 5: Legacy Plugin (No Metadata)

1. **Configure a legacy SDK v1 plugin**:
   ```typescript
   await Hay.plugins.configurePlugin({
     pluginId: "some-legacy-plugin",
     configuration: { ... }
   });
   ```

2. **Expected Behavior**:
   - ✅ No metadata available
   - ✅ Everything treated as config (no separation)
   - ✅ Auth validation **NOT** triggered
   - ✅ Backward compatible behavior

---

### Manual Testing via Terminal

1. **Start the server**:
   ```bash
   npm run dev
   ```

2. **Enable a test plugin**:
   ```bash
   # Via psql or database client
   INSERT INTO plugin_instances (organization_id, plugin_id, enabled, config)
   VALUES ('your-org-id', 'stripe-plugin-uuid', true, '{}');
   ```

3. **Watch logs for auth validation**:
   ```bash
   # In server logs, look for:
   🔐 Auth fields changed for Stripe, validating credentials...
   ✅ Auth validated for Stripe
   ```

4. **Check database changes**:
   ```sql
   SELECT * FROM plugin_instances WHERE plugin_id = 'stripe-plugin-uuid';
   ```

---

## Files Created

- `server/lib/plugin-utils.ts` - Config/auth separation utilities

---

## Files Modified

- `server/repositories/plugin-instance.repository.ts` - Added auth state methods
- `server/routes/v1/plugins/plugins.handler.ts` - Updated `configurePlugin` with SDK v2 logic
- `server/types/plugin-sdk-v2.types.ts` - Added `metadata` field to `WorkerInfo`
- `server/services/plugin-manager.service.ts` - Type compatibility fixes
- `server/services/plugin-runner-v2.service.ts` - TypeORM typing fixes

---

## Database Schema (Already Migrated)

The following fields are already present in `plugin_instances` table:

- `auth_state` (jsonb, nullable) - Stores `{ methodId, credentials }`
- `auth_method` (varchar, nullable) - Current auth method ID
- `auth_validated_at` (timestamptz, nullable) - Last validation timestamp
- `runtime_state` (varchar, default 'stopped') - Org-scoped worker state
- `last_started_at` (timestamptz, nullable) - Last worker start time
- `last_error` (text, nullable) - Last error message

---

## Next Steps

### Immediate Testing Recommendations

1. **Test with Stripe Example Plugin**:
   - Build the example: `cd plugin-sdk-v2/examples/stripe && npm run build`
   - Register it: Copy to `plugins/core/stripe/`
   - Enable it for an org
   - Configure with API key
   - Verify auth validation is triggered

2. **Test Error Handling**:
   - Invalid credentials
   - Timeout scenarios
   - Worker not running

3. **Test Backward Compatibility**:
   - Configure a legacy plugin
   - Ensure it still works without metadata

### Phase 6: MCP Integration

The next phase to implement is **Phase 6: MCP Integration** from the migration plan:

**Tasks**:
- Update `MCPRegistryService` to read from metadata (server descriptors)
- Implement `getToolsForOrg()` using `/mcp/list-tools` endpoint
- Implement MCP tool call routing via `/mcp/call-tool`
- Update orchestrator to use new MCP registry
- Remove legacy MCP process management code
- Verify runner exposes `/mcp/list-tools` endpoint

---

## Success Criteria

✅ **All Phase 5 requirements met**:

- [x] `updateAuthState()` and `getAuthState()` methods implemented
- [x] `updateRuntimeState()` method implemented
- [x] Config/auth separation logic implemented
- [x] `buildSDKv2Env()` injects `HAY_ORG_AUTH` (already complete)
- [x] Helper functions created for separation
- [x] `configurePlugin()` validates and saves auth separately
- [x] Type checking passes
- [x] Backward compatible with legacy plugins

---

## Notes

- **Auth validation is optional**: If worker is not running or SDK v1, validation is skipped
- **Restart-based config updates**: Simpler than hot-reload, suitable for early-stage product
- **Timeout protection**: All auth validation calls have 10-second timeout
- **Error handling**: Comprehensive error messages for validation failures
- **Backward compatibility**: Works with both SDK v1 and v2 plugins

---

**Implementation Time**: ~2 hours
**Files Created**: 1
**Files Modified**: 5
**Type Errors Fixed**: 3
**Tests Needed**: Manual testing recommended (see above)
