# Documentation Audit

Audit every doc file in the `docs/` submodule against the hay-core codebase. Spawn one agent per file, collect results, and open a PR if any fixes were needed.

## Step 1 — Initialize

1. Ensure the docs submodule is checked out: `git submodule update --init --remote docs`
2. Create a working branch: `git checkout -b docs/audit-YYYYMMDD` (use today's date)
3. Run `git log --oneline -20` to note recent codebase changes

## Step 2 — Spawn one agent per doc file

Launch all agents in parallel. Each agent receives:

- The doc file path
- Specific verification instructions (see below)
- The shared verification checklist

**Each agent MUST return a structured report** (do NOT ask agents to edit files — they report only):

```
FILE: <path>
STATUS: UP_TO_DATE | NEEDS_UPDATE | MAJOR_REWRITE
ISSUES:
- <description> | doc line: <N> | expected: <what doc says> | actual: <what code does>
- ...
SUGGESTED_FIXES:
- <concise description of what to change in the doc>
- ...
```

### Verification checklist (include in every agent prompt)

Every agent must verify these for its assigned doc:

- **File paths**: Does the file/directory still exist at that path?
- **Function/method names**: Does the function exist with the documented signature?
- **API routes/endpoints**: Do the tRPC procedures exist with the documented input/output?
- **Entity fields/schemas**: Do database columns match?
- **Config options**: Do referenced config keys exist in env.ts or settings types?
- **Types/interfaces**: Do TypeScript types match what's documented?
- **Service classes**: Do services exist with documented methods?
- **Behavioral descriptions**: Does code actually behave as described (flow order, fallback logic, thresholds)?
- **Code examples**: Would examples compile against the current API?
- **Dependencies**: Are referenced packages in package.json?
- **Dead references**: Links to removed or renamed files/services/features

### Agent assignments

Each agent prompt should follow this template:

```
You are auditing ONE documentation file against the hay-core codebase. Do NOT edit any files. Read the doc completely, then verify every concrete claim (file paths, function names, API routes, entity fields, config values, types, behavioral descriptions, code examples) against the actual code. Use Glob to check paths, Grep to find functions/classes, and Read to verify implementations.

Return your findings in this exact format:
FILE: <path>
STATUS: UP_TO_DATE | NEEDS_UPDATE | MAJOR_REWRITE
ISSUES:
- <description> | doc line: <N> | expected: <what doc says> | actual: <what code does>
SUGGESTED_FIXES:
- <what to change>

If no issues found, return STATUS: UP_TO_DATE with empty ISSUES.

Your assigned file: <path>
Specific focus areas: <from list below>
```

#### Technical docs (Priority 1)

1. **`docs/technical/architecture.md`**
   Focus: Tech stack list, system components, event bus patterns (`eventBus.emit` signatures), data flow, caching strategy, security layers.
   Check against: `/server/main.ts`, `/server/services/`, `/server/trpc/`, `/server/config/env.ts`, `package.json`

2. **`docs/technical/context-api.md`**
   Focus: Three integration paths, API endpoints (`/v1/conversations/{id}/secrets`, `/v1/customers/{id}/context`), `HayChat.init()` and `HayChat.addContext()` signatures, `x-hay-secret` MCP annotation.
   Check against: `/server/routes/v1/conversations/`, `/server/routes/v1/customers/`, `/webchat/src/`, conversation entity

3. **`docs/technical/guardrails.md`**
   Focus: Two-stage system (CompanyInterestGuardrailService, ConfidenceGuardrailService), prompt file names in `/server/prompts/execution/`, confidence tiers/thresholds (0.8, 0.5), config fields, message metadata fields.
   Check against: `/server/orchestrator/`, `/server/prompts/`, organization settings types

4. **`docs/technical/contributing/orchestrator.md`**
   Focus: `processConversation()` flow (count actual phases), state transitions, inactivity thresholds, title generation triggers, escalation keywords, similarity threshold (0.7), lock duration (30s), message limit (last 20). **Check if doc mentions the old polling approach — orchestrator now uses RabbitMQ.**
   Check against: `/server/orchestrator/index.ts`, `/server/orchestrator/*.layer.ts`, `/server/workers/orchestrator.worker.ts`

5. **`docs/technical/contributing/plugin-system-development.md`**
   Focus: Four core services and file paths, method signatures, DB schema (plugin_registry, plugin_instances columns), request flow, MCP transport protocols, instance pool defaults (10 max, 5-min timeout).
   Check against: `/server/services/plugin-*.service.ts`, `/server/services/mcp-client-factory.service.ts`, `/server/entities/`

6. **`docs/technical/contributing/pagination.md`**
   Focus: File paths (`/server/types/list-input.ts`, `/server/trpc/middleware/pagination.ts`, `/server/repositories/base.repository.ts`, `/server/trpc/procedures/list.ts`), input/output types, entity-specific schemas, max limit=100.
   Check against: actual file locations and type definitions

7. **`docs/technical/contributing/testing.md`**
   Focus: `tests/global-setup.ts` path, test user pattern (`hay-e2e-%@test.com`), `tests/helpers/auth.ts`, test file names, playwright.config.ts, URL token auth.
   Check against: `/tests/`, `playwright.config.ts`

8. **`docs/technical/contributing/vector-store.md`**
   Focus: `VectorStoreService` methods, embeddings table schema, HNSW index, 1536 dims, `text-embedding-3-small` model, distance metrics.
   Check against: `/server/services/vector-store.service.ts`, embedding entities/migrations

#### Plugin docs (Priority 2)

9. **`docs/technical/plugins/api-reference.md`**
   Focus: Manifest schema vs `/plugins/base/plugin-manifest.schema.json`, tRPC endpoints in `/server/routes/v1/plugins/`, plugin types enum, auth types, configSchema field types, UIExtensions, directory paths.
   Check against: schema file, route definitions, existing plugins

10. **`docs/technical/plugins/channel-architecture.md`**
    Focus: Webhook route pattern (`/v1/webhooks/:pluginId/:organizationId`), handler logic, message processing flow, agent routing, MCP tool signatures, signature validation, DB schema (Conversation.channel, Customer.external_metadata, Source entity).
    Check against: webhook routes, conversation/customer entities, source entity

11. **`docs/technical/plugins/channel-registration.md`**
    Focus: Source model fields, naming regex, `trpc.sources.*` API, test mode behavior, delivery state logic, core sources list, validation rules.
    Check against: source entity, source routes, message service

12. **`docs/technical/plugins/getting-started.md`**
    Focus: Tutorial steps, `@hay/plugin-sdk` exists, referenced APIs (`registerSettings`, `registerRoute`).
    Check against: `/packages/plugin-sdk/`, existing plugins

13. **`docs/technical/plugins/quick-reference.md`**
    Focus: Manifest examples, `Hay.plugins.*` calls, backend service imports, env var mapping, commands.
    Check against: `/dashboard/utils/api.ts`, `/server/routes/v1/plugins/`

#### User guide (Priority 3)

14. **`docs/user-guide/index.md`** — Feature claims match actual capabilities
15. **`docs/user-guide/agents.md`** — Agent fields match agent entity and dashboard form
16. **`docs/user-guide/conversations.md`** — Status list matches ConversationStatus enum, filter options match UI
17. **`docs/user-guide/quick-start.md`** — Setup flow matches onboarding
18. **`docs/user-guide/playbooks.md`** — Playbook fields match entity and form
19. **`docs/user-guide/documents.md`** — Supported formats, upload methods
20. **`docs/user-guide/integrations.md`** — Listed integrations exist as plugins
21. **`docs/user-guide/analytics.md`** — Analytics features match dashboard pages
22. **`docs/user-guide/dashboard.md`** — Dashboard layout matches actual pages
23. **`docs/user-guide/settings.md`** — Settings options match organization settings types
24. **`docs/user-guide/data-retention.md`** — Retention features match implementation
25. **`docs/user-guide/best-practices.md`** — Recommendations still valid
26. **`docs/user-guide/faq.md`** — Answers accurate
27. **`docs/user-guide/troubleshooting.md`** — Steps still work

#### Meta docs (Priority 4)

28. **`docs/technical/philosophy.md`** — Principles align with current practices
29. **`docs/technical/index.md`** — Links work, tech stack list accurate

## Step 3 — Collect results and apply fixes

After all agents return:

1. Parse each agent's report
2. Separate into: `UP_TO_DATE` (no action), `NEEDS_UPDATE` (apply fixes), `MAJOR_REWRITE` (flag for manual review)
3. For `NEEDS_UPDATE` files: apply the suggested fixes by editing the doc files in `docs/`
4. For `MAJOR_REWRITE` files: do NOT rewrite — list them in the PR description for manual attention

## Step 4 — Create PR (only if changes were made)

If any doc files were modified:

1. Stage changes in the docs submodule: `cd docs && git add -A && git checkout -b docs/audit-YYYYMMDD && git commit`
2. Stage the submodule pointer in hay-core: `cd .. && git add docs`
3. Create a PR to the **hay-docs** repo with:
   - Title: `docs: audit fixes YYYY-MM-DD`
   - Body: summary table of all findings + list of files needing manual rewrite

If no changes were needed, report "All documentation is up to date" and skip the PR.

## Important rules

- **Agents are read-only** — they search and report, they do NOT edit files
- **Main agent applies fixes** — based on agent reports, after reviewing all of them
- **Read full files** — agents must read the entire doc, not just headers
- **Grep to verify** — use Grep for function/class names, Glob for paths
- **Don't assume** — if doc says "8 phases", count actual phases in code
- **Preserve doc style** — match existing markdown formatting and tone when fixing
- **Don't add scope** — fix what's wrong, don't add new sections
- **Flag removals** — if a feature was removed entirely, note it prominently
- **Skip cosmetic issues** — focus on factual accuracy, not prose style
