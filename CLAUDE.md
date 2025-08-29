# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

This is a full-stack TypeScript application with:
- **Frontend**: Nuxt 3 dashboard (Vue 3) with Tailwind CSS, located in `/dashboard`
- **Backend**: Express server with tRPC API, TypeORM, and PostgreSQL with pgvector, located in `/server`
- **Database**: PostgreSQL with pgvector extension for embeddings and vector search
- **Authentication**: JWT-based with multiple strategies (Bearer, API Key, Basic Auth)
- **AI Integration**: OpenAI for embeddings and chat, LangChain for agents

## Critical Development Commands

### Running the Application

```bash
# Start both frontend and backend (from root)
npm run dev

# Or run separately:
# Backend (port 3000)
cd server && npm run dev

# Frontend (port 5173)  
cd dashboard && npm run dev
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
npm run type-check    # Run TypeScript type checking (nuxt typecheck)

# Backend (no linting configured yet)
cd server
npx tsc --noEmit     # Type check TypeScript files
```

### Testing

```bash
# Frontend tests
cd dashboard && npm test
```

## Important Conventions

### Frontend (Dashboard)

1. **Navigation**: Avoid using `navigateTo()`, instead initiate a router and use `router.push()`
2. **API Calls**: Always use `HayApi` for tRPC calls to the server, not `$api` methods
3. **State Management**: Uses Pinia stores with persistence (auth, user, organization)
4. **Components**: Auto-imported from `/components` subdirectories
5. **Composables**: Auto-imported from `/composables` directory

### Backend (Server)

1. **Routes**: All API routes are under `/v1` prefix using tRPC
2. **Authentication**: Handled via middleware with JWT tokens and organization context
3. **Database**: Uses TypeORM with migrations (never use `synchronize: true` in production)
4. **Vector Store**: PostgreSQL with pgvector for embedding storage and similarity search

### API Communication

- Frontend connects to backend via tRPC at `http://localhost:3000/v1`
- Authentication token passed as `Authorization: Bearer <token>` header
- Organization ID passed as `x-organization-id` header
- CORS configured for `http://localhost:5173` in development

## Project Structure

```
/
├── dashboard/          # Nuxt 3 frontend application
│   ├── pages/         # File-based routing
│   ├── components/    # Vue components (auto-imported)
│   ├── stores/        # Pinia state management
│   ├── composables/   # Vue composables (auto-imported)
│   └── utils/         # Utility functions (auto-imported)
│
└── server/            # Express + tRPC backend
    ├── routes/v1/     # tRPC API routes
    ├── entities/      # TypeORM entities
    ├── database/      # Database config and migrations
    ├── services/      # Business logic services
    ├── repositories/  # Data access layer
    └── lib/auth/      # Authentication strategies
```

## Environment Setup

Copy `.env.example` to `.env` and configure:
- Database credentials (PostgreSQL required)
- JWT secrets (generate secure random strings for production)
- OpenAI API key for AI features
- Ensure pgvector extension is installed in PostgreSQL

## General Guidelines

1. Keep solutions minimal - avoid over-engineering and future-proofing
2. This is a new product, prioritize simplicity over complexity
3. Always check existing patterns in neighboring files before implementing new features
4. Never commit secrets or API keys to the repository
5. Follow existing code style and conventions in each part of the codebase