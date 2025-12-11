# Hay Plugin SDK v2

**Status**: 🚧 Under Development - Phase 1 Complete

A self-contained SDK for building Hay plugins with MCP (Model Context Protocol) support.

## Overview

This is a clean-slate implementation of the Hay Plugin SDK, designed to be:

- **Self-contained**: No dependencies on Hay Core codebase
- **Type-safe**: Strict TypeScript with complete type definitions
- **MCP-first**: Built-in support for local and external MCP servers
- **Multi-tenant**: Each organization gets isolated plugin instances

## Project Structure

```
plugin-sdk-v2/
├── types/        # Type definitions (Phase 2)
├── sdk/          # SDK implementation (Phase 3)
├── runner/       # Worker process and HTTP server (Phase 4)
├── examples/     # Example plugins (Phase 5)
├── package.json  # Package configuration
└── tsconfig.json # TypeScript configuration
```

## Development Status

### ✅ Phase 1: Project Structure & Setup (COMPLETE)
- [x] Folder structure created
- [x] package.json configured
- [x] tsconfig.json with strict type checking
- [x] Module placeholders created

### 🔲 Phase 2: Core Type Definitions
- [ ] Plugin definition types
- [ ] Context types (global & org runtime)
- [ ] Config system types
- [ ] Auth system types
- [ ] MCP system types
- [ ] UI and route types
- [ ] Manifest types

### 🔲 Phase 3: SDK Implementation
- [ ] Core factory function
- [ ] Logger implementation
- [ ] Register API implementation
- [ ] Config descriptor API
- [ ] Runtime config API
- [ ] Runtime auth API
- [ ] MCP runtime API

### 🔲 Phase 4: Runner Implementation
- [ ] Worker process bootstrap
- [ ] Plugin loader
- [ ] Global hook execution
- [ ] HTTP server setup
- [ ] Metadata endpoint
- [ ] Org runtime initialization
- [ ] Hook orchestration
- [ ] Shutdown handling
- [ ] Mock integration layer

### 🔲 Phase 5: Example Plugin
- [ ] Stripe example plugin

### 🔲 Phase 6: Documentation & Testing
- [ ] API documentation
- [ ] Basic testing

### 🔲 Phase 7: Validation & Polish
- [ ] Type safety validation
- [ ] Error handling
- [ ] Code quality review

## Critical Constraints

1. **NO Core Integration**: This SDK does NOT include Hay Core integration
2. **NO Core Type Dependencies**: All types are defined locally
3. **Strict Hook Separation**: Descriptor APIs vs Runtime APIs are strictly separated
4. **Worker Lifecycle Boundaries**: Runner only handles specific hooks
5. **Metadata Format Compliance**: `/metadata` endpoint follows exact spec

## Reference Documentation

- **[PLUGIN.md](../PLUGIN.md)** - Complete plugin system specification
- **[PLUGIN_SDK_V2_PLAN.md](../PLUGIN_SDK_V2_PLAN.md)** - Implementation plan

## Installation (Not Yet Available)

```bash
npm install @hay/plugin-sdk-v2
```

## Quick Start (Coming Soon)

```typescript
import { defineHayPlugin } from '@hay/plugin-sdk-v2';

export default defineHayPlugin((ctx) => ({
  name: 'My Plugin',

  onInitialize() {
    // Register config, auth, routes, UI
  },

  async onStart(ctx) {
    // Start MCP servers, connect to services
  }
}));
```

## License

MIT
