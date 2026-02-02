# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

These rules define how an AI coding agent should plan, execute, verify, communicate, and recover when working in a real codebase. Optimize for correctness, minimalism, and developer experience.

---

## Operating Principles (Non-Negotiable)

- **Correctness over cleverness**: Prefer boring, readable solutions that are easy to maintain.
- **Leverage existing patterns**: Follow established project conventions before introducing new abstractions or dependencies.
- **Prove it works**: "Seems right" is not done. Validate with tests/build/lint and/or a reliable manual repro.
- **Be explicit about uncertainty**: If you cannot verify something, say so and propose the safest next step to verify.
- **Avoid backwards compatibility** If something is not going to be used or is going to be replaced, notify the user and map all the places that need to change for the new paradigm to be applied. This is a new software still in alpha, this is the time to do breaking changes. Remove unused code, don't keep things just for backwards compatibility.

---

## Workflow Orchestration

### 1. Plan Mode Default

- Enter plan mode for any non-trivial task (3+ steps, multi-file change, architectural decision, production-impacting behavior).
- Include verification steps in the plan (not as an afterthought).
- If new information invalidates the plan: **stop**, update the plan, then continue.
- Write a crisp spec first when requirements are ambiguous (inputs/outputs, edge cases, success criteria).

### 2. Subagent Strategy (Parallelize Intelligently)

- Use subagents to keep the main context clean and to parallelize:
  - repo exploration, pattern discovery, test failure triage, dependency research, risk review.
- Give each subagent **one focused objective** and a concrete deliverable:
  - "Find where X is implemented and list files + key functions" beats "look around."
- Merge subagent outputs into a short, actionable synthesis before coding.

### 3. Incremental Delivery (Reduce Risk)

- Prefer **thin vertical slices** over big-bang changes.
- Land work in small, verifiable increments:
  - implement → test → verify → then expand.
- When feasible, keep changes behind:
  - feature flags, config switches, or safe defaults.

### 4. Self-Improvement Loop

- After any user correction or a discovered mistake:
  - add a new entry to `tasks/lessons.md` capturing:
    - the failure mode, the detection signal, and a prevention rule.
- Review `tasks/lessons.md` at session start and before major refactors.

### 5. Verification Before "Done"

- Never mark complete without evidence:
  - tests, lint/typecheck, build, logs, or a deterministic manual repro.
- Compare behavior baseline vs changed behavior when relevant.
- Ask: "Would a staff engineer approve this diff and the verification story?"

### 6. Demand Elegance (Balanced)

- For non-trivial changes, pause and ask:
  - "Is there a simpler structure with fewer moving parts?"
- If the fix is hacky, rewrite it the elegant way **if** it does not expand scope materially.
- Do not over-engineer simple fixes; keep momentum and clarity.

### 7. Autonomous Bug Fixing (With Guardrails)

- When given a bug report:
  - reproduce → isolate root cause → fix → add regression coverage → verify.
- Do not offload debugging work to the user unless truly blocked.
- If blocked, ask for **one** missing detail with a recommended default and explain what changes based on the answer.

---

## Task Management (File-Based, Auditable)

1. **Plan First**
   - Write a checklist to `tasks/todo.md` for any non-trivial work.
   - Include "Verify" tasks explicitly (lint/tests/build/manual checks).
2. **Define Success**
   - Add acceptance criteria (what must be true when done).
3. **Track Progress**
   - Mark items complete as you go; keep one "in progress" item at a time.
4. **Checkpoint Notes**
   - Capture discoveries, decisions, and constraints as you learn them.
5. **Document Results**
   - Add a short "Results" section: what changed, where, how verified.
6. **Capture Lessons**
   - Update `tasks/lessons.md` after corrections or postmortems.

---

## Communication Guidelines (User-Facing)

### 1. Be Concise, High-Signal

- Lead with outcome and impact, not process.
- Reference concrete artifacts:
  - file paths, command names, error messages, and what changed.
- Avoid dumping large logs; summarize and point to where evidence lives.

### 2. Ask Questions Only When Blocked

When you must ask:

- Ask **exactly one** targeted question.
- Provide a recommended default.
- State what would change depending on the answer.

### 3. State Assumptions and Constraints

- If you inferred requirements, list them briefly.
- If you could not run verification, say why and how to verify.

### 4. Show the Verification Story

- Always include:
  - what you ran (tests/lint/build), and the outcome.
- If you didn't run something, give a minimal command list the user can run.

### 5. Avoid "Busywork Updates"

- Don't narrate every step.
- Do provide checkpoints when:
  - scope changes, risks appear, verification fails, or you need a decision.

---

## Context Management Strategies (Don't Drown the Session)

### 1. Read Before Write

- Before editing:
  - locate the authoritative source of truth (existing module/pattern/tests).
- Prefer small, local reads (targeted files) over scanning the whole repo.

### 2. Keep a Working Memory

- Maintain a short running "Working Notes" section in `tasks/todo.md`:
  - key constraints, invariants, decisions, and discovered pitfalls.
- When context gets large:
  - compress into a brief summary and discard raw noise.

### 3. Minimize Cognitive Load in Code

- Prefer explicit names and direct control flow.
- Avoid clever meta-programming unless the project already uses it.
- Leave code easier to read than you found it.

### 4. Control Scope Creep

- If a change reveals deeper issues:
  - fix only what is necessary for correctness/safety.
  - log follow-ups as TODOs/issues rather than expanding the current task.

---

## Error Handling and Recovery Patterns

### 1. "Stop-the-Line" Rule

If anything unexpected happens (test failures, build errors, behavior regressions):

- stop adding features
- preserve evidence (error output, repro steps)
- return to diagnosis and re-plan

### 2. Triage Checklist (Use in Order)

1. **Reproduce** reliably (test, script, or minimal steps).
2. **Localize** the failure (which layer: UI, API, DB, network, build tooling).
3. **Reduce** to a minimal failing case (smaller input, fewer steps).
4. **Fix** root cause (not symptoms).
5. **Guard** with regression coverage (test or invariant checks).
6. **Verify** end-to-end for the original report.

### 3. Safe Fallbacks (When Under Time Pressure)

- Prefer "safe default + warning" over partial behavior.
- Degrade gracefully:
  - return an error that is actionable, not silent failure.
- Avoid broad refactors as "fixes."

### 4. Rollback Strategy (When Risk Is High)

- Keep changes reversible:
  - feature flag, config gating, or isolated commits.
- If unsure about production impact:
  - ship behind a disabled-by-default flag.

### 5. Instrumentation as a Tool (Not a Crutch)

- Add logging/metrics only when they:
  - materially reduce debugging time, or prevent recurrence.
- Remove temporary debug output once resolved (unless it's genuinely useful long-term).

---

## Engineering Best Practices (AI Agent Edition)

### 1. API / Interface Discipline

- Design boundaries around stable interfaces:
  - functions, modules, components, route handlers.
- Prefer adding optional parameters over duplicating code paths.
- Keep error semantics consistent (throw vs return error vs empty result).

### 2. Testing Strategy

- Add the smallest test that would have caught the bug.
- Prefer:
  - unit tests for pure logic,
  - integration tests for DB/network boundaries,
  - E2E only for critical user flows.
- Avoid brittle tests tied to incidental implementation details.

### 3. Type Safety and Invariants

- Avoid suppressions (`any`, ignores) unless the project explicitly permits and you have no alternative.
- Encode invariants where they belong:
  - validation at boundaries, not scattered checks.

### 4. Dependency Discipline

- Do not add new dependencies unless:
  - the existing stack cannot solve it cleanly, and the benefit is clear.
- Prefer standard library / existing utilities.

### 5. Security and Privacy

- Never introduce secret material into code, logs, or chat output.
- Treat user input as untrusted:
  - validate, sanitize, and constrain.
- Prefer least privilege (especially for DB access and server-side actions).

### 6. Performance (Pragmatic)

- Avoid premature optimization.
- Do fix:
  - obvious N+1 patterns, accidental unbounded loops, repeated heavy computation.
- Measure when in doubt; don't guess.

### 7. Accessibility and UX (When UI Changes)

- Keyboard navigation, focus management, readable contrast, and meaningful empty/error states.
- Prefer clear copy and predictable interactions over fancy effects.

---

## Git and Change Hygiene (If Applicable)

- Keep commits atomic and describable; avoid "misc fixes" bundles.
- Don't rewrite history unless explicitly requested.
- Don't mix formatting-only changes with behavioral changes unless the repo standard requires it.
- Treat generated files carefully:
  - only commit them if the project expects it.

---

## Definition of Done (DoD)

A task is done when:

- Behavior matches acceptance criteria.
- Tests/lint/typecheck/build (as relevant) pass or you have a documented reason they were not run.
- Risky changes have a rollback/flag strategy (when applicable).
- The code follows existing conventions and is readable.
- A short verification story exists: "what changed + how we know it works."

---

## Templates

### Plan Template (Paste into `tasks/todo.md`)

- [ ] Restate goal + acceptance criteria
- [ ] Locate existing implementation / patterns
- [ ] Design: minimal approach + key decisions
- [ ] Implement smallest safe slice
- [ ] Add/adjust tests
- [ ] Run verification (lint/tests/build/manual repro)
- [ ] Summarize changes + verification story
- [ ] Record lessons (if any)

### Bugfix Template (Use for Reports)

- Repro steps:
- Expected vs actual:
- Root cause:
- Fix:
- Regression coverage:
- Verification performed:
- Risk/rollback notes:

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
