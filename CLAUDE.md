# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

This is a full-stack TypeScript application with:

- **Frontend**: Nuxt 3 dashboard (Vue 3) with Tailwind CSS and shadcn/ui components, located in `/dashboard`
- **Backend**: Express server with tRPC API, TypeORM, and PostgreSQL with pgvector, located in `/server`
- **Database**: PostgreSQL with pgvector extension for embeddings and vector search
- **Authentication**: JWT-based with multiple strategies (Bearer, API Key, Basic Auth)
- **AI Integration**: OpenAI for embeddings and chat, LangChain for agents
- **UI Components**: shadcn-vue components with Radix Vue primitives

## Database Conventions - CRITICAL

**⚠️ IMPORTANT: Before making ANY database-related changes, you MUST read and follow `/server/database/DATABASE_CONVENTIONS.md`**

This includes:

- Creating or modifying entities
- Writing migrations
- Using raw SQL queries
- Adding indexes or constraints
- Any TypeORM configuration changes

The database uses snake_case naming with TypeORM's SnakeNamingStrategy for automatic conversion. Never mix naming conventions.

## Critical Development Commands

### Running the Application

```bash
# Start both backend and frontend - Always use this for debugging
npm run dev

# Kill ports if needed
npm run kill-ports
```

### Database Management

```bash
# Run migrations
cd server
npm run migration:run

# Generate new migration
npm run migration:generate -- ./database/migrations/MigrationName

# Show migrations status
npm run migration:show

# Revert last migration
npm run migration:revert
```

### Code Quality

```bash
# Frontend
cd dashboard
npm run lint          # Run ESLint
npm run lint:fix      # Fix ESLint issues
npm run typecheck     # Run TypeScript type checking (nuxt typecheck)

# Backend
cd server
npm run typecheck     # Type check TypeScript files
```

### Testing

```bash
# Frontend tests (Vitest)
cd dashboard && npm test
```

### Additional Commands

```bash
# Generate tRPC types for frontend
cd dashboard && npm run generate:trpc
```

## Important Conventions

### Frontend (Dashboard)

1. **Navigation**: Avoid using `navigateTo()`, instead initiate a router and use `router.push()`
2. **API Calls**: Always use `Hay` for tRPC calls to the server

```ts
import { Hay } from "@/utils/api";
const response = await Hay.conversations.create();
```

3. **State Management**: Uses Pinia stores with persistence (auth, user, organization)
4. **Components**: Auto-imported from `/components` subdirectories
5. **Composables**: Auto-imported from `/composables` directory
6. **UI Components**: Use shadcn-vue components from `/components/ui` directory
7. **Styling**: Tailwind CSS with custom animations and class-variance-authority for component variants

### Backend (Server)

1. **Routes**: All API routes are under `/v1` prefix using tRPC
2. **Authentication**: Handled via middleware with JWT tokens and organization context
3. **Database**: Uses TypeORM with migrations (never use `synchronize: true` in production)
4. **Vector Store**: PostgreSQL with pgvector for embedding storage and similarity search
5. **Orchestrator Service**: Modular service architecture in `/server/services/orchestrator/` for conversation management
6. **Naming Strategy**: Custom database naming strategy for consistent column naming

### API Communication

- Frontend connects to backend via tRPC at `http://localhost:3001/v1`
- Authentication token passed as `Authorization: Bearer <token>` header
- Organization ID passed as `x-organization-id` header
- CORS configured for `http://localhost:3000` in development

## Project Structure

```
/
├── dashboard/              # Nuxt 3 frontend application
│   ├── pages/             # File-based routing
│   ├── components/        # Vue components (auto-imported)
│   │   ├── ui/           # shadcn-vue UI components
│   │   ├── layout/       # Layout components
│   │   └── auth/         # Authentication components
│   ├── stores/            # Pinia state management
│   ├── composables/       # Vue composables (auto-imported)
│   └── utils/             # Utility functions (auto-imported)
│
└── server/                # Express + tRPC backend
    ├── routes/v1/         # tRPC API routes
    ├── entities/          # TypeORM entities
    ├── database/          # Database config and migrations
    │   ├── migrations/    # Database migrations
    │   └── naming-strategy.ts  # Custom naming strategy
    ├── services/          # Business logic services
    │   └── orchestrator/  # Modular orchestrator services
    ├── repositories/      # Data access layer
    └── lib/auth/          # Authentication strategies
```

## Environment Setup

Copy `.env.example` to `.env` and configure:

- **Database**: PostgreSQL with pgvector extension (required)
  - `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`
  - Ensure pgvector extension is installed: `CREATE EXTENSION IF NOT EXISTS vector;`
- **JWT Configuration**: Generate secure random strings for production
  - `JWT_SECRET`, `JWT_REFRESH_SECRET`
- **OpenAI**: Required for AI features
  - `OPENAI_API_KEY`
  - Models: `text-embedding-3-small` for embeddings, `gpt-4o` for chat
- **CORS**: Configure allowed origins for frontend access
  - Default: `http://localhost:3001,http://localhost:5173`

## General Guidelines

1. Keep solutions minimal - avoid over-engineering and future-proofing
2. This is a new product, prioritize simplicity over complexity
3. Always check existing patterns in neighboring files before implementing new features
4. Never commit secrets or API keys to the repository
5. Follow existing code style and conventions in each part of the codebase

- This is a new application under development. Avoid keeping old functions for backwads-compatibility, we don't need that now, you should aim at removing unused, redundant or unnecessary code if you find any. If you find any opportunities for future improvement, feel free to leave a comment in the code with a "TODO:"

## Plugins

- Plugins are loaded dynamically and should be built on-demand when needed.
- Plugins are loaded from the `plugins/` directory.
- The core source code should NEVER know previously about the existence of plugins, if it does, it should be removed. That means that we should never prepare to use some specific plugin, we should only use the plugin manager service to load and use plugins. For new APIs or pages we should always have a way to dinamically load the plugin and use it - never hardcode the plugin ID in the source code.

I need you to analyse the codebase and make sure that the above conventions are followed.
Our most advance plugin so far is the cloud plugin. This plugin will help us do the billing and usage tracking on the cloud managed version of Hay. So we really can NOT have any hardcoded references to the cloud plugin in the core source code - although this apply to all plugins.
We need to verify that this is also true for the database migrations. Plugins can create new tables and migrations, but we should never put those tables previously in the core source code. (I'm not sure but I think the plugin/cloud has tables in the core source code)
Once you identified all the issues, please provide a detailed report with the issues and the proposed solutions.
