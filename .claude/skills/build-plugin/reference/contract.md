# The Hay Plugin Contract

The single source of truth is **`@hay/plugin-sdk`** (`packages/plugin-sdk/`). Everything
below is what the loader and runner actually enforce — verified against the SDK and the
real plugins, not the (stale) older guides.

## What makes something a plugin

A directory under `plugins/core/<name>/` (or `plugins/custom/{orgId}/<name>/`) is recognized
as a plugin **iff its `package.json` has a `hay-plugin` key**
(`server/services/plugin-manager.service.ts:152`). The **plugin ID is the npm `name`**
(`:160`) — e.g. `hay-plugin-zendesk`. There is **no `manifest.json`** in the current model;
nothing reads one. (Atlassian historically shipped one; it is dead weight — see anti-patterns.)

## The entry module

`package.json` → `hay-plugin.entry` (e.g. `./dist/index.js`) must have a **default export**
that is `defineHayPlugin(factory)`:

```ts
import { defineHayPlugin } from "@hay/plugin-sdk";
export default defineHayPlugin((globalCtx) => ({ name: "My Plugin" /* hooks */ }));
```

- `defineHayPlugin` is the **only** factory. There is no `createPlugin`/`definePlugin`.
- The factory receives a `HayGlobalContext` (`globalCtx.logger`, etc.) and returns a
  `HayPluginDefinition`.
- The **only required field is `name`** (non-empty string). Everything else is optional hooks.
- The package must be **ESM** (`"type": "module"`) and compiled to ESM (not CommonJS) — the
  loader dynamically `import()`s it.

## How it runs

A plugin is **not** loaded in-process. Per `(orgId, pluginId)` the platform lazily spawns a
**separate HTTP worker** (the SDK runner: `node packages/plugin-sdk/dist/runner/index.js
--plugin-path=… --org-id=… --port=… --mode=production`), idle-killed after ~5 min. Core talks
to it over HTTP: `/health`, `/metadata`, `/validate-auth`, `/config-update`, `/disable`,
`/mcp/list-tools`, `/mcp/call-tool`, plus any routes you register. Implications:

- Config and auth are injected as env JSON (`HAY_ORG_CONFIG`, `HAY_ORG_AUTH`); you read them
  via `ctx.config` / `ctx.auth`, never from `process.env` directly in the entry.
- Each worker gets a scoped JWT (`HAY_API_TOKEN` + `HAY_API_URL`) for calling back into core
  (used by channels — see archetypes).

## Lifecycle hooks (all optional except presence of `name`)

| Hook                             | When                                      | Do                                                                                                                                                   |
| -------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onInitialize(ctx)`              | once per worker, before HTTP starts       | **Declarative only**: `register.config`, `register.auth.*`, `register.ui.page`, `register.route`. No network, no MCP.                                |
| `onStart(ctx)`                   | per-org runtime start                     | Read `ctx.config`/`ctx.auth`, **gate on credentials**, start MCP (`ctx.mcp.*`) or pollers. Must not crash the worker — missing creds → log + return. |
| `onValidateAuth(ctx) => boolean` | when creds change (`POST /validate-auth`) | Do a **real API round-trip**; `return true` or `throw new Error(userFacingMessage)`.                                                                 |
| `onConfigUpdate(ctx)`            | config edits (`POST /config-update`)      | Re-initialize any client/state you hold. The platform restarts MCP servers for you.                                                                  |
| `onDisable(ctx)`                 | disable + SIGTERM/SIGINT                  | Stop pollers, close sockets/transports, null state.                                                                                                  |

**`onEnable` exists in the types but the runner never calls it — do not implement it.**

## `hay-plugin` metadata block

```jsonc
"hay-plugin": {
  "entry": "./dist/index.js",        // compiled entry (required)
  "displayName": "Zendesk",          // human name (required)
  "category": "integration",         // see below (required)
  "capabilities": ["mcp", "auth"],   // see below (required)
  "env": ["ZENDESK_API_TOKEN"]       // allow-list for config-field env fallback (optional)
}
```

**Category** — the SDK and runner validate against exactly four:
`integration | channel | tool | analytics`.
(`document_importer` appears on the Atlassian plugin and rides a separate `autoActivate` +
`trpcRouter` path; it is **advanced/legacy** — do not use it for a normal plugin.)

**Capabilities** — SDK set: `routes | mcp | auth | config | ui`. The runner additionally
accepts the channel/retriever strings `messages | customers | sources`. Capabilities are
**declarative** — there is no hard enforcement that you implement what you declare; they drive
marketplace classification and the worker's JWT scope. Declare what you actually use.

**`env`** — an **allow-list** of host env var names a config field may fall back to via its
`env:` property. Leave `[]` unless self-hosters set credentials through `process.env`. Note the
host applies a deny-pattern (SECRET/PASSWORD/TOKEN/…); per-org secrets reach the worker through
`HAY_ORG_CONFIG`, not raw env.

## Config & auth descriptors (registered in `onInitialize`)

```ts
ctx.register.config({
  apiKey: {
    type: "string", // "string" | "number" | "boolean" | "json"
    label: "API Key",
    description: "Where to find it…",
    required: true,
    encrypted: true, // secrets MUST set this — stored encrypted, masked in UI/logs
    // env: "SERVICE_API_KEY" // optional host-env fallback; name must be in hay-plugin.env
  },
});

// API key:
ctx.register.auth.apiKey({ id: "service-apikey", label: "…", configField: "apiKey" });

// OAuth2 (clientId/clientSecret reference config fields — the platform runs the flow):
ctx.register.auth.oauth2({
  id: "service-oauth",
  label: "…",
  authorizationUrl: "https://…/authorize",
  tokenUrl: "https://…/token",
  scopes: ["…"],
  clientId: ctx.config.field("clientId"),
  clientSecret: ctx.config.field("clientSecret"),
});
```

Runtime: `ctx.config.get<T>("key")` / `ctx.config.getOptional<T>("key")`,
`ctx.auth.get(): { methodId, credentials } | null` (apiKey → `{ apiKey }`,
oauth → `{ accessToken, refreshToken?, expiresAt? }`; tokens auto-refreshed by core).

## MCP wiring (in `onStart`) — three modes

```ts
// A) Local bundled server over stdio (most common):
await ctx.mcp.startLocalStdio({ id, command: "node", args: ["index.js"], cwd: "./mcp", env: { … } });
// B) Remote server the provider hosts:
await ctx.mcp.startExternal({ id, url: "https://mcp.example.com", authHeaders: { Authorization: `Bearer ${key}` } });
// C) In-process instance (advanced; returns an object with listTools/callTool/stop):
await ctx.mcp.startLocal(id, async (mcpCtx) => myServerInstance);
```

`cwd` resolves relative to the plugin dir. The platform restarts these on config change and
stops them on disable. Core then caches tools via `GET /mcp/list-tools`.

## UI extension

`ctx.register.ui.page({ id, title, component: "./components/settings/AfterSettings.vue",
slot: "after-settings" | "before-settings" | "standalone" })`. Components are built **separately**
by Vite into a **UMD `dist/ui.js`** with Vue externalized; the dashboard injects the script and
resolves the component by its **export name** from a global named
`convertPluginIdToGlobalVar(pluginId)`. See `templates/vite.config.ui.ts.tmpl`.

## Build & packaging

- `"type": "module"`, `"main": "dist/index.js"`.
- `"@hay/plugin-sdk": "file:../../../packages/plugin-sdk"` (note `packages/` — older guides
  omit it and are wrong).
- tsconfig emits ESM, `strict: true`, `exclude: ["node_modules","dist","mcp"]`.
- Build scripts: MCP-only plugin → `"build": "tsc"`. With UI →
  `"build": "npm run build:ui && npm run build:mcp"` (ui uses `vite build`, mcp uses `tsc`).
- Core builds core plugins from repo root via `npm --workspace=plugins/core/<name>` so the
  SDK `file:` link resolves. `scripts/build-plugins.sh` batch-builds all `core/*` plugins.

## Canonical directory layout

```
plugins/core/<name>/
├── package.json          # name = hay-plugin-<name>; "type":"module"; hay-plugin block
├── tsconfig.json         # ESM, strict, exclude mcp
├── thumbnail.jpg         # icon (core hardcodes ./thumbnail.jpg)
├── src/index.ts          # default export = defineHayPlugin(...)   [REQUIRED]
├── mcp/                  # local stdio MCP server (plain JS) — if capability "mcp" (local)
│   ├── index.js
│   └── package.json      # declare @modelcontextprotocol/sdk + your deps
├── components/           # Vue UI — if capability "ui"
│   ├── index.ts          # barrel: export { default as AfterSettings } from "./settings/AfterSettings.vue"
│   └── settings/AfterSettings.vue
├── vite.config.ui.ts     # builds components → dist/ui.js (UMD, vue external) — if "ui"
├── i18n/                 # optional en.json, pt-BR.json
└── dist/                 # build output (gitignored): index.js (+ ui.js, style.css)
```
