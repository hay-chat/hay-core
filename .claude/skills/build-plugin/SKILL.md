---
name: build-plugin
description: Build a new Hay plugin from scratch that connects an external platform (REST API, hosted MCP server, messaging channel, or document source). Use when the user wants to create/scaffold a Hay plugin, integrate a new service/SaaS into Hay, expose a platform's API to the agent as tools, add a messaging channel, or asks "how do I build a plugin". Covers the SDK contract, the four archetypes, copy-paste templates, and the anti-patterns to avoid.
---

# Build a Hay Plugin

This skill is the authoritative, code-verified guide for building a new Hay plugin. It supersedes
the older `plugins/PLUGIN_DEVELOPMENT_GUIDE.md` (stale) and the `generate-plugin` command (which
generates from an existing MCP repo). Use **this** when building from scratch to connect a platform.

> The existing `plugins/core/*` are a mix of good and rough. This skill distills what's actually
> correct against the SDK and explicitly flags what NOT to copy. When in doubt, prefer the
> patterns named here over whatever a given plugin happens to do.

## The 30-second model

A plugin = **a `package.json` with a `hay-plugin` block** + **`src/index.ts` whose default export
is `defineHayPlugin(...)`**. The plugin ID is the npm package name. It runs as a **separate HTTP
worker** that core spawns per org and talks to over HTTP. You declare config/auth/UI/routes in
`onInitialize`, then wire up MCP or pollers in `onStart`. **There is no `manifest.json`.**

Full contract (lifecycle, metadata fields, config/auth/MCP/UI APIs, build): **`reference/contract.md`**.

## Workflow

### 1. Scope the integration

Answer these before writing code:

- **What platform**, and how does it expose itself? (REST API? hosted MCP server? messaging webhooks? document source?)
- **What should the agent be able to do?** List the concrete actions → these become tools or the channel's message flow.
- **Auth method?** API key / OAuth2 / basic. What credentials does the user supply?
- **Plugin name** → npm name `hay-plugin-<name>` (channels: `hay-channel-<name>-<provider>`).

### 2. Pick the archetype (full detail + reference plugins in `reference/archetypes.md`)

| The platform…                 | Archetype                           | Reference to copy                                 | Avoid                                            |
| ----------------------------- | ----------------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| has a REST API, no hosted MCP | **A. Local bundled MCP**            | **klaviyo** (clean), **zendesk** (many tools)     | magento, woocommerce                             |
| hosts its own MCP server      | **B. Remote connector**             | **hubspot** (OAuth), **stripe** (API key)         | stripe's stale `.md` docs                        |
| is two-way messaging          | **C. Channel**                      | **chatwoot** (verify), **email-imap** (semantics) | email (mock), whatsapp (no idempotency)          |
| is a document source          | **D. Document importer** (advanced) | **atlassian** ConfluenceClient + adf-to-markdown  | atlassian's manifest.json + `@server/*` coupling |

### 3. Scaffold from templates (in `templates/`)

- `package.json.tmpl`, `tsconfig.json.tmpl` — always.
- `index.ts.tmpl` — entry for archetypes A & B.
- `channel.ts.tmpl` — entry for archetype C.
- `mcp-server.js.tmpl` — the `mcp/index.js` for archetype A.
- `vite.config.ui.ts.tmpl` — only if you ship a settings UI (`capability "ui"`).

Replace every `<placeholder>`, strip the trailing NOTES comments, and delete templates for
archetypes you're not using.

### 4. Implement, following the named good patterns

- `onValidateAuth`: do a **real API round-trip** and throw user-facing messages (klaviyo/zendesk).
- `onStart`: **gate on credentials** — missing creds → log + return, never crash the worker.
- MCP server: native `fetch`, one shared `api()` request helper, `ok()`/`fail()` responses, zod
  schemas with `.describe()`, rich tool descriptions with cross-tool hints (klaviyo).
- HTTP client (archetype D or any direct API calls): retry with `Retry-After` on 429 + exponential
  backoff on 5xx (atlassian `ConfluenceClient`).
- Channel inbound: verify signature over **raw bytes** with replay window + `timingSafeEqual`,
  filter bot/echo/empty, **dedupe on provider message id**, always `200` on success (chatwoot).
- Channel outbound: non-retryable provider errors → `200 { success:false }` (no retry storms).

### 5. Check against the anti-patterns

Read **`reference/anti-patterns.md`** — every item is a real mistake in the current codebase.
The high-frequency ones: no `manifest.json`; declare every imported dep; no committed secrets/TLS
bypass/cruft; use the MCP SDK with real schemas; `onConfigUpdate`/`onDisable` actually
re-init/tear down; `strict: true`.

### 6. Build & verify

```bash
# from repo root (so the @hay/plugin-sdk file: link resolves):
npm install --workspace=plugins/core/<name>
npm run build  --workspace=plugins/core/<name>
npm run typecheck:server   # plugin types compile against the SDK
```

- Confirm `dist/index.js` exists and (if UI) `dist/ui.js` + `dist/style.css`.
- For archetype A, ensure the `mcp/` server **actually starts** — handle the dependency-install
  gap (see `anti-patterns.md` → "The mcp/ dependency gap"); only klaviyo runs out of the box today.
- Start the worker for your org and confirm `/metadata` and `/mcp/list-tools` return your tools.

## Pre-ship checklist

- [ ] `package.json` has `hay-plugin` (entry, displayName, canonical category, capabilities, env); **no `manifest.json`**.
- [ ] `src/index.ts` default-exports `defineHayPlugin`; ESM (`"type":"module"`); `strict:true`.
- [ ] Every secret config field is `encrypted:true`; nothing logs credentials.
- [ ] `onValidateAuth` does a live round-trip; `onStart` gates on creds; `onDisable` tears down; no `onEnable`.
- [ ] Every imported dependency is declared in the relevant `package.json`.
- [ ] (Archetype A) `mcp/` uses `@modelcontextprotocol/sdk`, real zod schemas, `console.error` logging, and a documented dependency-install approach.
- [ ] (Channel) signature verified, inbound deduped, non-retryable errors return `200 {success:false}`.
- [ ] No committed cruft: no `.git`/vendored repos, `node_modules` bloat, `test-results/`, design `.md` TODOs, or creds in fixtures.
- [ ] `npm run build` + `typecheck` pass; tools appear in `/mcp/list-tools`.

## Reference map

- `reference/contract.md` — the enforced SDK contract (lifecycle, metadata, config/auth/MCP/UI, build).
- `reference/archetypes.md` — the four archetypes, which reference plugin to copy, what to avoid.
- `reference/anti-patterns.md` — real mistakes in `plugins/core/*`, with file pointers.
- `templates/` — copy-paste scaffolding.
