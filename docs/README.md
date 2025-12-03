# Hay Documentation

> **Complete documentation for the Hay platform**

## Getting Started

- **[CLAUDE.md](../CLAUDE.md)** - Main development guide and conventions
- **[.claude/FRONTEND.md](../.claude/FRONTEND.md)** - Frontend development guidelines

## Plugin Development

Comprehensive guides for building and extending plugins:

### For Plugin Developers

- **[PLUGIN_API.md](./PLUGIN_API.md)** ⭐ - **Complete plugin API reference**
  - Plugin architecture and system overview
  - Manifest.json structure and all configuration options
  - MCP integration guide
  - Configuration and secrets management
  - UI extensions and customization
  - Channel registration
  - Best practices and troubleshooting
  - Building new features

- **[PLUGIN_QUICK_REFERENCE.md](./PLUGIN_QUICK_REFERENCE.md)** - **Quick reference guide**
  - Fast lookup for common patterns
  - Code snippets and examples
  - Minimal manifest templates
  - API usage examples
  - Common issues and solutions

- **[PLUGIN_CHANNEL_REGISTRATION.md](./PLUGIN_CHANNEL_REGISTRATION.md)** - **Channel registration guide**
  - How to register communication channels
  - Source model and categories
  - Message creation with sources
  - Test mode behavior

- **[PLUGIN_GENERATION_WORKFLOW.md](../.claude/PLUGIN_GENERATION_WORKFLOW.md)** - **Plugin generation workflow**
  - Complete workflow for generating plugins from MCP servers
  - Step-by-step instructions
  - Required information checklist
  - Decision trees for common scenarios

### For Platform Developers

- **[PLUGIN_SYSTEM_DEVELOPMENT.md](./PLUGIN_SYSTEM_DEVELOPMENT.md)** - **Extending the plugin system**
  - System architecture deep dive
  - Adding new capabilities
  - Extending plugin types
  - Adding platform APIs
  - Improving MCP support
  - Security enhancements
  - Performance optimization
  - Testing strategy

## Database

- **[DATABASE_CONVENTIONS.md](../server/database/DATABASE_CONVENTIONS.md)** ⚠️ - **CRITICAL: Read before any DB changes**
  - Naming conventions (snake_case in DB, camelCase in TypeScript)
  - Entity creation guidelines
  - Migration best practices
  - TypeORM configuration

## Architecture

- **[orchestrator.service.md](./orchestrator.service.md)** - AI conversation orchestration
  - Perception, retrieval, and execution layers
  - How the AI orchestrator works
  - Integration with plugins

- **[README-VECTOR-STORE.md](./README-VECTOR-STORE.md)** - Vector store implementation
  - PostgreSQL with pgvector
  - Embedding storage and retrieval
  - Similarity search

## Features

- **[PAGINATION.md](./PAGINATION.md)** - Pagination implementation guide
- **[PAGINATION_IMPLEMENTATION_SUMMARY.md](./PAGINATION_IMPLEMENTATION_SUMMARY.md)** - Pagination summary
- **[GUARDRAILS.md](./GUARDRAILS.md)** - AI guardrails system
- **[HANDOFF_GUARDRAIL_DESIGN.md](./HANDOFF_GUARDRAIL_DESIGN.md)** - Handoff guardrail design

## Integration Guides

- **[WHATSAPP_INTEGRATION_STRATEGY.md](./WHATSAPP_INTEGRATION_STRATEGY.md)** - WhatsApp integration strategy

## Legacy Documentation

- **[Open Ai Plugin.md](./Open%20Ai%20Plugin.md)** - Historical OpenAI plugin documentation

---

## Quick Links

### Most Important for New Developers

1. [CLAUDE.md](../CLAUDE.md) - Start here
2. [PLUGIN_API.md](./PLUGIN_API.md) - If building plugins
3. [DATABASE_CONVENTIONS.md](../server/database/DATABASE_CONVENTIONS.md) - Before touching database

### Development Workflow

```bash
# 1. Set up environment
cp .env.example .env
# Edit .env with your configuration

# 2. Install dependencies
npm install

# 3. Run migrations
cd server && npm run migration:run

# 4. Start development
npm run dev
```

### Building a Plugin

```bash
# 1. Create plugin directory
mkdir -p plugins/core/my-plugin
cd plugins/core/my-plugin

# 2. Create manifest.json (see PLUGIN_API.md for structure)

# 3. Create package.json and install dependencies
npm init -y
npm install

# 4. Build plugin
npm run build

# 5. Test in dashboard
# Navigate to plugins page and enable your plugin
```

### Common Commands

```bash
# Development
npm run dev                      # Run both server and dashboard
npm run dev:server              # Server only
npm run dev:dashboard           # Dashboard only

# Testing
npm test                        # Run all tests
npm run test:server             # Server tests
npm run test:dashboard          # Dashboard tests

# Type checking
npm run typecheck               # Check all
npm run typecheck:server        # Server only
npm run typecheck:dashboard     # Dashboard only

# Database
cd server
npm run migration:run           # Run migrations
npm run migration:generate -- ./database/migrations/Name  # Generate migration
npm run migration:revert        # Revert last migration

# Build
npm run build                   # Build everything
npm run build:server            # Server only
npm run build:dashboard         # Dashboard only
```

---

## Documentation Standards

When adding new documentation:

1. **Location**:
   - General docs → `/docs`
   - Claude-specific → `/.claude`
   - Database → `/server/database`
   - Plugin examples → `/plugins/{plugin}/README.md`

2. **Format**:
   - Use Markdown (.md)
   - Include table of contents for long documents
   - Add code examples
   - Include diagrams where helpful (mermaid)

3. **Style**:
   - Clear, concise writing
   - Use examples liberally
   - Link to related docs
   - Include troubleshooting section
   - Add "Last Updated" date

4. **Updates**:
   - Update this README when adding new docs
   - Update CLAUDE.md if relevant to AI assistant
   - Cross-reference related documentation
   - Keep examples up to date with code

---

## Getting Help

- **Issues**: Open an issue in the repository
- **Documentation**: Start with this README
- **Examples**: Browse `/plugins/core` for plugin examples
- **Code**: Read the source code (it's well-commented)

---

**Last Updated**: 2025-12-03
