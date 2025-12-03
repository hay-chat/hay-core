# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## General Guidelines

1. Keep solutions minimal - avoid over-engineering and future-proofing
2. This is a new product, prioritize simplicity over complexity
3. Always check existing patterns in neighboring files before implementing new features
4. Never commit secrets or API keys to the repository
5. Follow existing code style and conventions in each part of the codebase
6. This is a new application under development. Avoid keeping old functions for backwards-compatibility, we don't need that now, you should aim at removing unused, redundant or unnecessary code if you find any. If you find any opportunities for future improvement, feel free to leave a comment in the code with a "TODO:"
7. Don't use `npm run dev` to run the application, assume the user is running the app already.
8. Always read the `.claude/FRONTEND.md` file before creating new frontend pages/elements.

## Architecture Overview

This is a full-stack TypeScript application with:

- **Frontend**: Nuxt 3 dashboard (Vue 3) with Tailwind CSS and shadcn/ui components, located in `/dashboard`
- **Backend**: Express server with tRPC API, TypeORM, and PostgreSQL with pgvector, located in `/server`
- **Database**: PostgreSQL with pgvector extension for embeddings and vector search
- **Authentication**: JWT-based with multiple strategies (Bearer, API Key, Basic Auth)
- **AI Integration**: OpenAI for embeddings and chat, LangChain for agents
- **UI Components**: shadcn-vue components with Radix Vue primitives (reka-ui)
- **Webchat**: Embeddable chat widget (Vite + TypeScript) located in `/webchat`
- **Plugin System**: Dynamic plugin loading from `/plugins` directory with MCP support

## Database Conventions - CRITICAL

**⚠️ IMPORTANT: Before making ANY database-related changes, you MUST read and follow `/server/database/DATABASE_CONVENTIONS.md`**

This includes:

- Creating or modifying entities
- Writing migrations
- Using raw SQL queries
- Adding indexes or constraints
- Any TypeORM configuration changes

The database uses snake_case naming with TypeORM's SnakeNamingStrategy for automatic conversion. Never mix naming conventions.

Key rules:
- **Database**: snake_case (e.g., `first_name`, `created_at`)
- **TypeScript**: camelCase (e.g., `firstName`, `createdAt`)
- TypeORM handles the automatic conversion via SnakeNamingStrategy

## Critical Development Commands

### Root-Level Commands (Monorepo)

```bash
# Development (runs both server and dashboard)
npm run dev

# Build everything
npm run build

# Testing
npm run test                    # Run all tests
npm run test:dashboard          # Dashboard tests only
npm run test:server             # Server tests only

# Code Quality
npm run lint                    # Lint all code
npm run lint:fix                # Fix linting issues
npm run typecheck               # Typecheck all packages
npm run typecheck:dashboard     # Dashboard only
npm run typecheck:server        # Server only

# Clean builds
npm run clean                   # Remove build artifacts
npm run clean:all               # Remove node_modules too

# tRPC type generation
npm run generate:trpc           # Generate tRPC types for frontend
```

### Database Management

```bash
cd server

# Run migrations
npm run migration:run

# Generate new migration
npm run migration:generate -- ./database/migrations/MigrationName

# Show migrations status
npm run migration:show

# Revert last migration
npm run migration:revert

# Check for pending migrations
npm run migration:ensure
```

### Testing

```bash
# Frontend tests (Vitest)
cd dashboard && npm test

# Server tests (Jest)
cd server && npm test
npm run test:watch              # Watch mode
npm run test:coverage           # With coverage
npm run test:unit               # Unit tests only
npm run test:integration        # Integration tests only
```

## Important Conventions

### Frontend (Dashboard)

1. **Navigation**: Avoid using `navigateTo()`, instead initiate a router and use `router.push()`
2. **API Calls**: Always use `Hay` for tRPC calls to the server

```ts
import { Hay } from "@/utils/api";
const response = await Hay.conversations.create();
```

3. **State Management**: Uses Pinia stores with persistence:
   - `auth.ts` - Authentication state and tokens
   - `user.ts` - User profile and organization
   - `app.ts` - Application-level state
   - `analytics.ts` - Analytics data
   - `organization.ts` - Organization settings

4. **Components**: Auto-imported from `/components` subdirectories
5. **Composables**: Auto-imported from `/composables` directory:
   - `useWebSocket.ts` - WebSocket connection management
   - `useNotifications.ts` - Toast notifications
   - `useFormValidation.ts` - Form validation helpers
   - `useConversationTakeover.ts` - Agent takeover functionality
   - And more...

6. **UI Components**: Use shadcn-vue components from `/components/ui` directory:
   - `Button.vue` - Has `:loading` prop for loading states
   - `Input.vue` - Extended with `type="search"`, `label`, `icon-start` props
   - `Page.vue` - Standard page layout with title/description
   - `Card*.vue` - Card components
   - `Dialog*.vue` - Modal dialogs
   - See `.claude/FRONTEND.md` for usage patterns

7. **Styling**: Tailwind CSS with custom animations and class-variance-authority for component variants

### Backend (Server)

1. **Routes**: All API routes are under `/v1` prefix using tRPC in `/server/routes/v1/`:
   - `agents/` - AI agent management
   - `auth/` - Authentication endpoints
   - `conversations/` - Chat conversations
   - `customers/` - Customer management
   - `documents/` - Document/knowledge base
   - `plugins/` - Plugin management
   - `organizations/` - Organization management
   - And more...

2. **Authentication**: Handled via middleware with JWT tokens and organization context

3. **Database**: Uses TypeORM with migrations (never use `synchronize: true` in production)
   - Entities in `/server/entities/`
   - Migrations in `/server/database/migrations/`

4. **Services** (`/server/services/`):
   - `plugin-manager.service.ts` - Plugin lifecycle management
   - `plugin-instance-manager.service.ts` - Plugin instance management
   - `websocket.service.ts` - WebSocket connections
   - `email.service.ts` - Email sending (MJML templates)
   - `scheduler.service.ts` - Cron job scheduling
   - `privacy.service.ts` - GDPR/privacy compliance
   - `oauth.service.ts` - OAuth flow handling
   - And more...

5. **Orchestrator** (`/server/orchestrator/`): AI conversation orchestration with layered architecture:
   - `perception.layer.ts` - Analyze user input (intent, sentiment)
   - `retrieval.layer.ts` - Find relevant documents and playbooks
   - `execution.layer.ts` - Generate AI responses and execute actions
   - See `/server/orchestrator/ARCHITECTURE.md` for details

6. **Vector Store**: PostgreSQL with pgvector for embedding storage and similarity search

### API Communication

- Frontend connects to backend via tRPC at `http://localhost:3001/v1`
- Authentication token passed as `Authorization: Bearer <token>` header
- Organization ID passed as `x-organization-id` header
- CORS configured for `http://localhost:3000` in development

## Project Structure

```
/
├── dashboard/                  # Nuxt 3 frontend application
│   ├── pages/                 # File-based routing
│   ├── components/            # Vue components (auto-imported)
│   │   ├── ui/               # shadcn-vue UI components
│   │   ├── layout/           # Layout components (sidebar, nav)
│   │   ├── auth/             # Authentication components
│   │   ├── conversations/    # Conversation-related components
│   │   ├── plugins/          # Plugin UI components
│   │   └── tiptap/           # Rich text editor components
│   ├── stores/               # Pinia state management
│   ├── composables/          # Vue composables (auto-imported)
│   ├── utils/                # Utility functions (auto-imported)
│   │   └── api.ts           # tRPC client (Hay export)
│   ├── layouts/              # Nuxt layouts
│   ├── middleware/           # Route middleware
│   └── types/                # TypeScript type definitions
│
├── server/                    # Express + tRPC backend
│   ├── routes/v1/            # tRPC API routes
│   ├── entities/             # TypeORM entities
│   ├── database/             # Database config and migrations
│   │   ├── migrations/       # Database migrations
│   │   └── data-source.ts    # TypeORM data source
│   ├── services/             # Business logic services
│   ├── orchestrator/         # AI conversation orchestration
│   ├── repositories/         # Data access layer
│   ├── trpc/                 # tRPC configuration
│   │   ├── middleware/       # tRPC middleware
│   │   └── procedures/       # tRPC procedures
│   ├── lib/auth/             # Authentication strategies
│   ├── prompts/              # AI prompt templates
│   ├── templates/            # Email templates (MJML)
│   └── tests/                # Server tests (Jest)
│
├── plugins/                   # Plugin ecosystem
│   ├── base/                 # Plugin schema and base types
│   │   └── plugin-manifest.schema.json
│   ├── shopify/              # E-commerce plugin example
│   ├── stripe/               # Payment plugin example
│   ├── zendesk/              # Support plugin example
│   └── ...                   # Other plugins
│
├── webchat/                   # Embeddable chat widget
│   └── src/                  # Vite + TypeScript source
│
├── scripts/                   # Build and utility scripts
│   └── build-plugins.sh      # Plugin build script
│
├── .claude/                   # Claude Code configuration
│   ├── FRONTEND.md           # Frontend development guidelines
│   ├── PLUGIN_GENERATION_*.md # Plugin generation docs
│   ├── commands/             # Custom slash commands
│   └── agents/               # Custom agent definitions
│
├── docs/                      # Documentation
├── gdpr-audit/                # GDPR compliance audit
└── tests/                     # E2E tests (Playwright)
```

## Environment Setup

Copy `.env.example` to `.env` and configure:

### Required Configuration

- **Database**: PostgreSQL with pgvector extension
  - `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`
  - Ensure pgvector extension is installed: `CREATE EXTENSION IF NOT EXISTS vector;`

- **Redis**: For caching and rate limiting
  - `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`

- **JWT Configuration**: Generate secure random strings for production
  - `JWT_SECRET`, `JWT_REFRESH_SECRET`

- **OpenAI**: Required for AI features
  - `OPENAI_API_KEY`
  - Models: `text-embedding-3-small` for embeddings, `gpt-4o` for chat

### Optional Configuration

- **SMTP**: Email sending configuration
- **Stripe**: Payment processing (for billing plugin)
- **Plugin OAuth**: Per-plugin OAuth configuration (e.g., `STRIPE_OAUTH_CLIENT_ID`)

## Plugins

Plugins extend Hay's functionality with MCP (Model Context Protocol) support.

### Key Principles

- Plugins are loaded dynamically and should be built on-demand when needed
- Plugins are loaded from the `plugins/` directory
- The core source code should NEVER know previously about the existence of plugins
- Never hardcode plugin IDs in the source code
- Use the plugin manager service to load and use plugins dynamically

### Plugin Structure

Each plugin contains:
```
plugins/{plugin-name}/
├── manifest.json       # Plugin configuration (follows plugin-manifest.schema.json)
├── package.json        # NPM package config
├── mcp/                # MCP server code (if local)
├── components/         # Vue components for UI extensions
└── public/             # Static assets
```

### Plugin Types

- `channel` - Communication channel integration
- `mcp-connector` - External MCP server connection
- `retriever` - Data retrieval capabilities
- `playbook` - Workflow automation
- `workflow` - Advanced workflow capabilities
- `analytics` - Analytics and reporting

### Plugin Documentation

**Comprehensive guides for plugin development:**

- **[docs/PLUGIN_API.md](docs/PLUGIN_API.md)** - Complete plugin API reference with architecture, manifest structure, best practices, and troubleshooting
- **[docs/PLUGIN_QUICK_REFERENCE.md](docs/PLUGIN_QUICK_REFERENCE.md)** - Fast reference for common development tasks and code patterns
- **[docs/PLUGIN_CHANNEL_REGISTRATION.md](docs/PLUGIN_CHANNEL_REGISTRATION.md)** - Guide for registering communication channels
- **[.claude/PLUGIN_GENERATION_WORKFLOW.md](.claude/PLUGIN_GENERATION_WORKFLOW.md)** - Workflow for generating plugins from MCP servers

### Plugin Generation

See `.claude/PLUGIN_GENERATION_WORKFLOW.md` for creating plugins from MCP servers.

Use `/generate-plugin` slash command to generate plugins automatically.

## Testing

### Dashboard (Vitest)
```bash
cd dashboard
npm test                        # Run tests
npm run test:watch             # Watch mode
```

### Server (Jest)
```bash
cd server
npm test                        # Run all tests
npm run test:unit               # Unit tests (services)
npm run test:integration        # Integration tests (routes)
npm run test:coverage           # With coverage report
```

### E2E (Playwright)
```bash
npx playwright test             # Run E2E tests
```

## Key Files Reference

- `/dashboard/utils/api.ts` - tRPC client configuration (`Hay` export)
- `/server/main.ts` - Server entry point
- `/server/trpc/index.ts` - tRPC router setup
- `/server/database/data-source.ts` - Database configuration
- `/server/orchestrator/index.ts` - AI orchestrator entry
- `/plugins/base/plugin-manifest.schema.json` - Plugin manifest schema

## Debugging

Set these environment variables for debugging:

```bash
LOG_LEVEL=debug                 # Enable debug logging
DEBUG_MODULES="perception,retrieval,execution"  # Filter debug modules
```

Avoid setting `DEBUG=true` as it enables ALL debug logging including OpenAI SDK.
