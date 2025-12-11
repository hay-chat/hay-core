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
- [ ] Define `HayGlobalContext` interface
- [ ] Define `HayRegisterAPI` interface
- [ ] Define `HayConfigDescriptorAPI` interface
- [ ] Define `HayLogger` interface

**Reference**: Section 5.2 in PLUGIN.md (lines 350-449)

#### Org Runtime Context (onStart)
- [ ] Define `HayStartContext` interface
- [ ] Define `HayOrg` interface
- [ ] Define `HayConfigRuntimeAPI` interface
- [ ] Define `HayAuthRuntimeAPI` interface
- [ ] Define `HayMcpRuntimeAPI` interface
- [ ] Define `AuthState` interface

**Reference**: Section 5.3 in PLUGIN.md (lines 453-577)

#### Other Hook Contexts
- [ ] Define `HayAuthValidationContext` interface
- [ ] Define `HayConfigUpdateContext` interface
- [ ] Define `HayDisableContext` interface

**Reference**: Sections 5.4, 5.5, 5.6 in PLUGIN.md (lines 580-613)

### 2.3 Config system types
- [ ] Define `ConfigFieldDescriptor` interface
- [ ] Define `ConfigFieldReference` interface
- [ ] Define config field types (string, number, boolean, json)

**Reference**: Section 5.2.2 in PLUGIN.md (lines 386-409)

### 2.4 Auth system types
- [ ] Define `RegisterAuthAPI` interface
- [ ] Define `ApiKeyAuthOptions` interface
- [ ] Define `OAuth2AuthOptions` interface

**Reference**: Section 5.2.4 in PLUGIN.md (lines 422-449)

### 2.5 MCP system types
- [ ] Define `McpServerInstance` interface
- [ ] Define `ExternalMcpOptions` interface
- [ ] Define MCP initializer function types

**Reference**: Section 5.3.4 in PLUGIN.md (lines 525-564)

### 2.6 UI and Route types
- [ ] Define `UIExtensionDescriptor` interface
- [ ] Define `HttpMethod` type
- [ ] Define `RouteHandler` type

**Reference**: Section 5.2.1 and 5.2.3 in PLUGIN.md (lines 360-383, 413-419)

### 2.7 Manifest types
- [ ] Define `HayPluginManifest` interface for package.json `hay-plugin` block
- [ ] Define plugin capabilities enum/type

**Reference**: Section 2 in PLUGIN.md (lines 58-92)

---

## Phase 3: SDK Implementation

### 3.1 Core factory function
- [ ] Implement `defineHayPlugin()` factory function
- [ ] Add type guards and validation

**Reference**: Section 5.1 in PLUGIN.md (lines 302-327)

### 3.2 Logger implementation
- [ ] Implement `HayLogger` class
- [ ] Support debug, info, warn, error levels
- [ ] Add metadata support
- [ ] Add org/plugin context to log messages (e.g., `[org:abc123][plugin:stripe]`)
- [ ] Format output for stdout/stderr (runner will capture)

**Reference**: Section 5.3.5 in PLUGIN.md (lines 569-577)

### 3.3 Register API implementation

#### Config Registration
- [ ] Implement `register.config()` method
- [ ] Validate config schema
- [ ] Validate `env` fields against manifest allowlist
- [ ] Store config schema for metadata endpoint

**Reference**: Section 7.1 in PLUGIN.md (lines 663-698)

#### Auth Registration
- [ ] Implement `register.auth.apiKey()` method
- [ ] Implement `register.auth.oauth2()` method
- [ ] Validate auth options
- [ ] Store auth methods registry

**Reference**: Section 6 in PLUGIN.md (lines 616-658)

#### Route Registration
- [ ] Implement `register.route()` method
- [ ] Store route definitions
- [ ] Validate HTTP methods

**Reference**: Section 5.2.1 in PLUGIN.md (lines 360-383)

#### UI Registration
- [ ] Implement `register.ui()` method
- [ ] Store UI extension descriptors

**Reference**: Section 5.2.3 in PLUGIN.md (lines 413-419)

### 3.4 Config descriptor API
- [ ] Implement `config.field()` method for creating field references
- [ ] Return ConfigFieldReference objects
- [ ] This API is ONLY available in HayGlobalContext (onInitialize)

**CONSTRAINT**: This is for schema definition only, NOT for reading values.

**Reference**: Section 5.2.2 in PLUGIN.md (lines 386-409)

### 3.5 Runtime config API
- [ ] Implement `config.get()` method with resolution pipeline
- [ ] Implement org config → env var fallback logic
- [ ] Implement `config.getOptional()` method
- [ ] Implement `config.keys()` method
- [ ] Validate env var access against manifest allowlist
- [ ] This API is ONLY available in org runtime contexts (onStart, onValidateAuth, etc.)

**CONSTRAINT**: Must NOT be callable from onInitialize. Enforce separation between descriptor and runtime APIs.

**Reference**: Section 7.2 and 5.3.2 in PLUGIN.md (lines 476-503, 694-698)

### 3.6 Runtime auth API
- [ ] Implement `auth.get()` method
- [ ] Return AuthState with methodId and credentials

**Reference**: Section 5.3.3 in PLUGIN.md (lines 505-521)

### 3.7 MCP runtime API
- [ ] Implement `mcp.startLocal()` method
- [ ] Implement `mcp.startExternal()` method
- [ ] Track running MCP instances
- [ ] Implement automatic cleanup on shutdown

**Reference**: Section 8 and 5.3.4 in PLUGIN.md (lines 525-564, 701-750)

---

## Phase 4: Runner Implementation

### 4.1 Worker process bootstrap
- [ ] Create runner entry point script
- [ ] Parse command-line args (plugin path, org ID, port)
- [ ] Load plugin manifest from package.json
- [ ] Validate manifest structure

**Reference**: Section 3.1 in PLUGIN.md (lines 96-132)

### 4.2 Plugin loader
- [ ] Load plugin entry file
- [ ] Call `defineHayPlugin()` to get plugin definition
- [ ] Validate plugin definition structure
- [ ] Handle load errors gracefully

**Reference**: Section 3.1 in PLUGIN.md (lines 96-132)

### 4.3 Global hook execution
- [ ] Create HayGlobalContext instance
- [ ] Execute `onInitialize()` hook
- [ ] Collect registered config, auth, routes, UI
- [ ] Handle hook errors

**Reference**: Section 4.1 in PLUGIN.md (lines 168-193)

### 4.4 HTTP server setup
- [ ] Create Express HTTP server
- [ ] Implement GET `/metadata` endpoint
- [ ] Mount plugin-registered routes
- [ ] Start server on allocated port
- [ ] Add error handling and graceful shutdown

**Reference**: Section 3.2 in PLUGIN.md (lines 116-132)

### 4.5 Metadata endpoint
- [ ] Return config schema
- [ ] Return auth methods registry
- [ ] Return UI extensions
- [ ] Return route metadata
- [ ] Return MCP descriptors (if any)
- [ ] Format as JSON response with exact structure from spec

**Format**: Must match the exact structure expected by Hay Core (see Critical Constraint #5)

**Reference**: Section 3.2 in PLUGIN.md (lines 116-132)

### 4.6 Org runtime initialization
- [ ] Create HayStartContext instance
- [ ] Load org config from storage/env
- [ ] Load org auth state
- [ ] Execute `onStart()` hook
- [ ] Handle MCP server startup
- [ ] Handle hook errors

**Reference**: Section 4.2 and 3.3 in PLUGIN.md (lines 195-223, 133-157)

### 4.7 Hook orchestration
- [ ] Implement `onValidateAuth()` execution
- [ ] Implement `onConfigUpdate()` execution
- [ ] Implement `onDisable()` execution
- [ ] Add proper error handling for each hook

**Reference**: Sections 4.3, 4.4, 4.5 in PLUGIN.md (lines 225-295)

### 4.8 Shutdown handling
- [ ] Graceful shutdown on SIGTERM/SIGINT
- [ ] Stop all MCP servers
- [ ] Call `onDisable()` hook
- [ ] Close HTTP server
- [ ] Cleanup resources

**Reference**: Section 4.5 in PLUGIN.md (lines 276-295)

### 4.9 Mock integration layer (for testing)
- [ ] Create mock org config object
- [ ] Create mock auth state
- [ ] Create test script that calls `onStart()` manually
- [ ] Verify MCP start works
- [ ] Verify routes are registered
- [ ] Verify `/metadata` output

**Purpose**: This allows testing the SDK without Hay Core integration. Keep it simple and isolated.

---

## Phase 5: Example Plugin

### 5.1 Create Stripe example
- [ ] Create `examples/stripe/` directory
- [ ] Create `package.json` with `hay-plugin` manifest
- [ ] Implement full plugin with all hooks
- [ ] Include mock Stripe client
- [ ] Include mock MCP server
- [ ] Add comments explaining each part

**Reference**: Section 9 in PLUGIN.md (lines 753-911)

---

## Phase 6: Documentation & Testing

### 6.1 Documentation
- [ ] Create `plugin-sdk-v2/README.md` with getting started guide
- [ ] Document all SDK APIs
- [ ] Document runner usage
- [ ] Add architecture diagrams (optional)

### 6.2 Basic testing
- [ ] Test plugin loading
- [ ] Test hook execution order
- [ ] Test config resolution (org → env fallback)
- [ ] Test auth registration and validation
- [ ] Test MCP lifecycle
- [ ] Test HTTP server and routes
- [ ] Test metadata endpoint

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
