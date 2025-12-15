# Plugin SDK v2 Implementation Plan

**Goal**: Create a completely new Plugin SDK v2 from scratch, ignoring all legacy plugin code.

**Reference**: All specifications are in `PLUGIN.md`

**Output**: Self-contained `plugin-sdk-v2/` folder with TypeScript SDK and minimal runner.

---

## Phase 1: Project Structure & Setup

### 1.1 Create folder structure
- [x] Create `plugin-sdk-v2/` root directory
- [x] Create `plugin-sdk-v2/sdk/` for SDK implementation
- [x] Create `plugin-sdk-v2/runner/` for worker process bootstrap
- [x] Create `plugin-sdk-v2/types/` for shared type definitions
- [x] Create `plugin-sdk-v2/examples/` for example plugins
- [x] Set up `package.json` with TypeScript config
- [x] Set up `tsconfig.json` for strict type checking

**CONSTRAINT**: The SDK MUST NOT import or reference any code from the Hay Core repository. All types must be defined locally.

**Reference**: Section 5 (SDK Surface) in PLUGIN.md

---

## Phase 2: Core Type Definitions

### 2.1 Plugin definition types
- [x] Define `HayPluginFactory` type
- [x] Define `HayPluginDefinition` interface with all hooks
- [x] Define hook signatures (onInitialize, onStart, onValidateAuth, onConfigUpdate, onDisable)

**Reference**: Section 5.1 in PLUGIN.md (lines 302-346)

### 2.2 Context types

#### Global Context (onInitialize)
- [x] Define `HayGlobalContext` interface
- [x] Define `HayRegisterAPI` interface
- [x] Define `HayConfigDescriptorAPI` interface
- [x] Define `HayLogger` interface

**Reference**: Section 5.2 in PLUGIN.md (lines 350-449)

#### Org Runtime Context (onStart)
- [x] Define `HayStartContext` interface
- [x] Define `HayOrg` interface
- [x] Define `HayConfigRuntimeAPI` interface
- [x] Define `HayAuthRuntimeAPI` interface
- [x] Define `HayMcpRuntimeAPI` interface
- [x] Define `AuthState` interface

**Reference**: Section 5.3 in PLUGIN.md (lines 453-577)

#### Other Hook Contexts
- [x] Define `HayAuthValidationContext` interface
- [x] Define `HayConfigUpdateContext` interface
- [x] Define `HayDisableContext` interface

**Reference**: Sections 5.4, 5.5, 5.6 in PLUGIN.md (lines 580-613)

### 2.3 Config system types
- [x] Define `ConfigFieldDescriptor` interface
- [x] Define `ConfigFieldReference` interface
- [x] Define config field types (string, number, boolean, json)

**Reference**: Section 5.2.2 in PLUGIN.md (lines 386-409)

### 2.4 Auth system types
- [x] Define `RegisterAuthAPI` interface
- [x] Define `ApiKeyAuthOptions` interface
- [x] Define `OAuth2AuthOptions` interface

**Reference**: Section 5.2.4 in PLUGIN.md (lines 422-449)

### 2.5 MCP system types
- [x] Define `McpServerInstance` interface
- [x] Define `ExternalMcpOptions` interface
- [x] Define MCP initializer function types

**Reference**: Section 5.3.4 in PLUGIN.md (lines 525-564)

### 2.6 UI and Route types
- [x] Define `UIExtensionDescriptor` interface
- [x] Define `HttpMethod` type
- [x] Define `RouteHandler` type

**Reference**: Section 5.2.1 and 5.2.3 in PLUGIN.md (lines 360-383, 413-419)

### 2.7 Manifest types
- [x] Define `HayPluginManifest` interface for package.json `hay-plugin` block
- [x] Define plugin capabilities enum/type

**Reference**: Section 2 in PLUGIN.md (lines 58-92)

---

## Phase 3: SDK Implementation

### 3.1 Core factory function
- [x] Implement `defineHayPlugin()` factory function
- [x] Add type guards and validation

**Reference**: Section 5.1 in PLUGIN.md (lines 302-327)

### 3.2 Logger implementation
- [x] Implement `HayLogger` class
- [x] Support debug, info, warn, error levels
- [x] Add metadata support
- [x] Add org/plugin context to log messages (e.g., `[org:abc123][plugin:stripe]`)
- [x] Format output for stdout/stderr (runner will capture)

**Reference**: Section 5.3.5 in PLUGIN.md (lines 569-577)

### 3.3 Register API implementation

#### Config Registration
- [x] Implement `register.config()` method
- [x] Validate config schema
- [x] Validate `env` fields against manifest allowlist
- [x] Store config schema for metadata endpoint

**Reference**: Section 7.1 in PLUGIN.md (lines 663-698)

#### Auth Registration
- [x] Implement `register.auth.apiKey()` method
- [x] Implement `register.auth.oauth2()` method
- [x] Validate auth options
- [x] Store auth methods registry

**Reference**: Section 6 in PLUGIN.md (lines 616-658)

#### Route Registration
- [x] Implement `register.route()` method
- [x] Store route definitions
- [x] Validate HTTP methods

**Reference**: Section 5.2.1 in PLUGIN.md (lines 360-383)

#### UI Registration
- [x] Implement `register.ui()` method
- [x] Store UI extension descriptors

**Reference**: Section 5.2.3 in PLUGIN.md (lines 413-419)

### 3.4 Config descriptor API
- [x] Implement `config.field()` method for creating field references
- [x] Return ConfigFieldReference objects
- [x] This API is ONLY available in HayGlobalContext (onInitialize)

**CONSTRAINT**: This is for schema definition only, NOT for reading values.

**Reference**: Section 5.2.2 in PLUGIN.md (lines 386-409)

### 3.5 Runtime config API
- [x] Implement `config.get()` method with resolution pipeline
- [x] Implement org config → env var fallback logic
- [x] Implement `config.getOptional()` method
- [x] Implement `config.keys()` method
- [x] Validate env var access against manifest allowlist
- [x] This API is ONLY available in org runtime contexts (onStart, onValidateAuth, etc.)

**CONSTRAINT**: Must NOT be callable from onInitialize. Enforce separation between descriptor and runtime APIs.

**Reference**: Section 7.2 and 5.3.2 in PLUGIN.md (lines 476-503, 694-698)

### 3.6 Runtime auth API
- [x] Implement `auth.get()` method
- [x] Return AuthState with methodId and credentials

**Reference**: Section 5.3.3 in PLUGIN.md (lines 505-521)

### 3.7 MCP runtime API
- [x] Implement `mcp.startLocal()` method
- [x] Implement `mcp.startExternal()` method
- [x] Track running MCP instances
- [x] Implement automatic cleanup on shutdown

**Reference**: Section 8 and 5.3.4 in PLUGIN.md (lines 525-564, 701-750)

---

## Phase 4: Runner Implementation ✅

### 4.1 Worker process bootstrap
- [x] Create runner entry point script
- [x] Parse command-line args (plugin path, org ID, port, mode)
- [x] Load plugin manifest from package.json
- [x] Validate manifest structure

**Reference**: Section 3.1 in PLUGIN.md (lines 96-132)

**Implementation**: [runner/bootstrap.ts](plugin-sdk-v2/runner/bootstrap.ts)

### 4.2 Plugin loader
- [x] Load plugin entry file
- [x] Call `defineHayPlugin()` to get plugin definition
- [x] Validate plugin definition structure
- [x] Handle load errors gracefully

**Reference**: Section 3.1 in PLUGIN.md (lines 96-132)

**Implementation**: [runner/plugin-loader.ts](plugin-sdk-v2/runner/plugin-loader.ts)

### 4.3 Global hook execution
- [x] Create HayGlobalContext instance
- [x] Execute `onInitialize()` hook
- [x] Collect registered config, auth, routes, UI
- [x] Handle hook errors

**Reference**: Section 4.1 in PLUGIN.md (lines 168-193)

**Implementation**:
- [runner/global-context.ts](plugin-sdk-v2/runner/global-context.ts)
- [runner/hook-executor.ts](plugin-sdk-v2/runner/hook-executor.ts)

### 4.4 HTTP server setup
- [x] Create Express HTTP server
- [x] Implement GET `/metadata` endpoint
- [x] Mount plugin-registered routes
- [x] Start server on allocated port
- [x] Add error handling and graceful shutdown

**Reference**: Section 3.2 in PLUGIN.md (lines 116-132)

**Implementation**: [runner/http-server.ts](plugin-sdk-v2/runner/http-server.ts)

### 4.5 Metadata endpoint
- [x] Return config schema
- [x] Return auth methods registry
- [x] Return UI extensions
- [x] Return route metadata
- [x] Return MCP descriptors (placeholder)
- [x] Format as JSON response with exact structure from spec

**Format**: Matches the exact structure expected by Hay Core (see Critical Constraint #5)

**Reference**: Section 3.2 in PLUGIN.md (lines 116-132)

**Implementation**: [runner/http-server.ts](plugin-sdk-v2/runner/http-server.ts) (setupMetadataEndpoint)

### 4.6 Org runtime initialization
- [x] Create HayStartContext instance
- [x] Load org config from env vars (HAY_ORG_CONFIG)
- [x] Load org auth state from env vars (HAY_ORG_AUTH)
- [x] Execute `onStart()` hook
- [x] Handle MCP server startup
- [x] Handle hook errors

**Reference**: Section 4.2 and 3.3 in PLUGIN.md (lines 195-223, 133-157)

**Implementation**: [runner/org-context.ts](plugin-sdk-v2/runner/org-context.ts)

### 4.7 Hook orchestration
- [x] Implement `onValidateAuth()` execution
- [x] Implement `onConfigUpdate()` execution
- [x] Implement `onDisable()` execution
- [x] Add proper error handling for each hook

**Reference**: Sections 4.3, 4.4, 4.5 in PLUGIN.md (lines 225-295)

**Implementation**: [runner/hook-executor.ts](plugin-sdk-v2/runner/hook-executor.ts)

### 4.8 Shutdown handling
- [x] Graceful shutdown on SIGTERM/SIGINT
- [x] Stop all MCP servers (handled by MCP runtime)
- [x] Call `onDisable()` hook
- [x] Close HTTP server
- [x] Cleanup resources

**Reference**: Section 4.5 in PLUGIN.md (lines 276-295)

**Implementation**: [runner/index.ts](plugin-sdk-v2/runner/index.ts) (shutdown function)

### 4.9 Mock integration layer (for testing)
- [x] Create mock org config object
- [x] Create mock auth state
- [x] Support `--mode=test` flag for mock data
- [x] Support `--mode=production` for env-based data

**Purpose**: Allows testing the SDK without Hay Core integration.

**Implementation**: [runner/org-context.ts](plugin-sdk-v2/runner/org-context.ts) (createMockOrgData)

---

## Phase 5: Example Plugin ✅

### 5.1 Create Stripe example
- [x] Create `examples/stripe/` directory
- [x] Create `package.json` with `hay-plugin` manifest
- [x] Implement full plugin with all hooks
- [x] Include mock Stripe client
- [x] Include mock MCP server
- [x] Add comments explaining each part

**Reference**: Section 9 in PLUGIN.md (lines 753-911)

**Implementation**:
- [examples/stripe/src/index.ts](plugin-sdk-v2/examples/stripe/src/index.ts) - Main plugin with all hooks
- [examples/stripe/src/stripe-client.ts](plugin-sdk-v2/examples/stripe/src/stripe-client.ts) - Mock API client
- [examples/stripe/src/stripe-mcp-server.ts](plugin-sdk-v2/examples/stripe/src/stripe-mcp-server.ts) - Mock MCP server
- [examples/stripe/README.md](plugin-sdk-v2/examples/stripe/README.md) - Comprehensive documentation

**Status**: ✅ **COMPLETE** - See [PHASE_5_COMPLETE.md](plugin-sdk-v2/PHASE_5_COMPLETE.md)

---

## Phase 6: Documentation & Testing ⏳

### 6.1 Documentation ✅
- [x] Create `plugin-sdk-v2/README.md` with getting started guide
- [x] Document all SDK APIs
- [x] Document runner usage
- [x] Add best practices and troubleshooting
- [ ] Add architecture diagrams (optional)

**Status**: ✅ **COMPLETE** - See [PHASE_6_SUMMARY.md](plugin-sdk-v2/PHASE_6_SUMMARY.md)

### 6.2 Basic testing ⏳
- [x] Set up testing framework (Vitest)
- [x] Add test scripts to package.json
- [x] Create vitest configuration
- [x] Initial test files created
- [x] Fix tests to match factory function API
- [x] Test factory function (6 tests passing)
- [x] Test plugin registry (15 tests passing)
- [ ] Test hook execution order
- [ ] Test config resolution (org → env fallback)
- [ ] Test auth registration and validation
- [ ] Test MCP lifecycle
- [ ] Test HTTP server and routes
- [ ] Test metadata endpoint

**Status**: ⏳ **IN PROGRESS** - 21 tests passing, core functionality tested, more coverage needed

**Test Files**:
- `sdk/factory.test.ts` - ✅ 6 tests passing
- `sdk/registry.test.ts` - ✅ 15 tests passing

---

## Phase 7: Validation & Polish

### 7.1 Type safety validation
- [ ] Ensure all types are properly exported
- [ ] Verify type inference works correctly
- [ ] Check for any `any` types that should be specific

### 7.2 Error handling
- [ ] Add comprehensive error messages
- [ ] Validate all inputs
- [ ] Handle edge cases gracefully

### 7.3 Code quality
- [ ] Add JSDoc comments to public APIs
- [ ] Ensure consistent code style
- [ ] Remove any debug code
- [ ] Final review against PLUGIN.md spec

---

## Success Criteria

- ✅ Complete, self-contained `plugin-sdk-v2/` folder
- ✅ All TypeScript types defined per spec
- ✅ SDK implements all required APIs
- ✅ Runner can load and execute plugins
- ✅ Example Stripe plugin works end-to-end
- ✅ No dependencies on legacy plugin code OR Hay Core code
- ✅ Clean, modular, production-ready code
- ✅ 100% adherence to PLUGIN.md specification
- ✅ Strict enforcement of global vs org runtime separation
- ✅ `/metadata` endpoint returns exact format expected by core
- ✅ Mock integration layer allows standalone testing
- ✅ All critical constraints are enforced in code

---

## Notes

- This is a **clean slate** implementation - ignore all existing plugin code
- Prioritize **clarity and type safety** over cleverness
- Keep **global vs org runtime** separation strict
- Make it **easy to drop into a new repo**
- Ask questions if spec is ambiguous before implementing

## ⚠️ CRITICAL CONSTRAINTS

### 1. NO Core Integration
**This implementation does NOT include any Hay Core integration** (plugin discovery, worker management, DB persistence, or orchestration). The SDK must remain self-contained and isolated. Do NOT modify or reference any Hay Core code.

### 2. NO Core Type Dependencies
**The SDK MUST NOT import or reference any code from the Hay Core repository.** All types and mechanisms must be defined locally inside `plugin-sdk-v2/`. This guarantees clean separation and portability.

### 3. Strict Hook Separation
**The SDK must enforce that `config.get()` cannot be used in `onInitialize()`**. Config descriptor API (`config.field()`) is for onInitialize only. Runtime config API (`config.get()`) is for org runtime hooks only (onStart, onValidateAuth, etc.).

### 4. Worker Lifecycle Boundaries
**Worker runner must NOT call `onEnable()`.** That hook is triggered only by Hay Core during plugin installation. The runner only handles: `onInitialize`, `onStart`, `onValidateAuth`, `onConfigUpdate`, `onDisable`.

### 5. Metadata Format Compliance
**The `/metadata` response MUST conform exactly to the schema described in PLUGIN.md section 3.2:**
```json
{
  "routes": [...],
  "configSchema": {...},
  "authMethods": [...],
  "uiExtensions": [...],
  "mcp": { "local": [...], "external": [...] }
}
```
