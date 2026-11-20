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
to it over loopback HTTP, authenticated with a per-worker secret: `/health`, `/metadata`, `/validate-auth`, `/config-update`, `/disable`,
`/mcp/list-tools`, `/mcp/call-tool`, plus any routes you register. Implications:

- The worker starts with the org's non-secret settings only (`HAY_ORG_SETTINGS`). Secret config
  fields (`encrypted: true`) and the connected account's credentials are **pulled from core** at
  start and before they expire, if the manifest declares them under `credentials` (below). You
  still read everything via `ctx.config` / `ctx.auth`, never from `process.env`: the worker has
  no host env, so a host-managed value is a config field with an `env:` fallback.
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
  "marketplaceCategory": "crm",      // marketplace section: channels | commerce | payments | crm | knowledge | security
  "capabilities": ["mcp", "auth"],   // see below (required)
  "env": ["ZENDESK_API_TOKEN"]       // allow-list for config-field env fallback (optional)
}
```

**`setup`** (optional) — `{ "businessTypes": ["store"], "group": "commerce", "handles": ["orders"] }`.
Lets in-app setup suggest the plugin. `group`: `commerce | shipping | payments | crm | helpdesk | marketing |
knowledge | booking`. `handles` (what customer requests the tools really fulfil): `orders | refunds |
order_changes | billing | subscriptions | bookings`. Declare a handle only if a tool does it: a
refund tool that just records a request and hands off does not handle `refunds`.

**Category** — the SDK and runner validate against exactly four:
`integration | channel | tool | analytics`.
(`document_importer` appears on the Atlassian plugin and rides a separate `autoActivate` +
`trpcRouter` path; it is **advanced/legacy** — do not use it for a normal plugin.)

**Capabilities** — `routes | mcp | auth | config | ui | cron | webchat | tickets` describe what the
plugin offers. These gate what it may ask core for, and **core enforces them**: the worker's API
token carries exactly the capabilities you declare, and every plugin API call is refused without
the one it needs.

| Declare | To call |
| ------- | ------- |
| `messages` | `messages.*`, `media.upload`, `webhooks.setRoutingKeys`, `channel.reportHealth`, `conversations.*`, `connection.revoke` |
| `auth` | `connection.revoke` (non-channel plugins) |
| `email` | `email.sendingDomain`, `POST /v1/plugin-api/send-email` |
| `privacy` | `privacy.eraseCustomer`, `privacy.exportCustomer` |
| `products` | `ctx.productSource` (catalog sync) |
| `disputes` | `ctx.disputes` |
| `state` | `ctx.state` (key/value store that survives restarts) |
| `customers`, `sources`, `mcp` | `customers.*`, `sources.register`, `mcp.register*` |

Declare what you use and nothing else; a missing one fails at runtime with FORBIDDEN.

**`env`** — an **allow-list** of host env var names a config field may fall back to via its
`env:` property. Leave `[]` unless self-hosters set credentials through `process.env`. Note the
host applies a deny-pattern (SECRET/PASSWORD/TOKEN/…). Core resolves the fallback and the worker
never sees the env var: a non-secret value arrives in its settings, a secret one by pull.

**`credentials`** — every secret the worker reads, each bound to a capability you also declare:

```json
"capabilities": ["mcp", "auth", "credentials"],
"credentials": [
  { "name": "apiKey", "source": "config", "capability": "mcp", "hosts": ["api.example.com"] },
  { "name": "auth",   "source": "auth",   "capability": "mcp", "hosts": ["api.example.com"] }
]
```

`source: "config"` names a secret (`encrypted: true`, not `serverOnly`) config field you read with
`ctx.config`; `"auth"` (one per plugin that registers an auth method) delivers the connected
account's credentials (OAuth access token, API keys) for `ctx.auth`. `hosts` must be entries of your
`network.egress`. Core hands a credential only to a worker holding its capability, refreshes an
expiring access token when it is pulled, **never delivers a refresh token**, and audits each issue.
A secret you read but did not declare is simply absent. Declaring any requires the `credentials`
capability.

## Packaging for upload

Core never installs dependencies for an uploaded or git-installed plugin. Build it, then
`tools/hay-cli/bin/hay plugin pack <dir>`: it bundles `hay-plugin.entry` (and the `main` of
`mcp/package.json`) with all dependencies inlined, leaves `@hay/plugin-sdk` external (the host
provides it), strips install fields from the packaged `package.json` files, and writes
`hay-pack.json` (sha256 and size of every file). Upload the ZIP; core verifies it on upload and
before each worker start. Native addons (`.node`) are refused. A git repo needs the same
`hay-pack.json` and listed files committed.

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

### Advanced and managed fields

Mark technical fields the merchant should not need (API version, auth mode, base URL) with
`advanced: true`: the plugin page moves them to the Advanced tab, which only shows in Advanced
mode. A field whose `env` var is set on the host is **managed by Hay.chat**: read-only and shown
on the Advanced tab (overridable only when the host sets `PLUGIN_ALLOW_MANAGED_OVERRIDE=true`).
A required field that is still empty always stays on the Setup tab.

## Setup checklist (`register.setup`) and status

The Setup tab is a numbered checklist. Declare it in `onInitialize`; without a declaration core
builds one: before-settings components, the Setup fields, Connect (if OAuth), after-settings
components, Verify (if MCP).

```ts
ctx.register.setup({
  steps: [
    { id: "store", kind: "fields", fields: ["shopDomain"] }, // config fields
    { id: "connect", kind: "connect" }, // the OAuth method
    { id: "webhooks", kind: "component", component: "AfterSettings" }, // a ui.page component
    { id: "app", kind: "external", url: "https://partners.example.com" },
    { id: "notify", kind: "fields", fields: ["recipients"], optional: true },
    { id: "verify", kind: "verify" }, // connection test (MCP)
  ],
  // Optional: report your own status (core calls POST /setup/status with config + auth, 5 s timeout)
  async status({ auth, config }) {
    const connected = !!auth.get();
    return {
      state: connected ? "connected" : "needs_action", // not_set_up | needs_action | connected | error
      account: config.getOptional<string>("shopDomain"), // shown as "Connected as …"
      steps: { connect: { done: connected } }, // steps you leave out are judged by core
    };
  },
});
```

Step titles live in i18n, not code: `setupSteps.<id>.title` (required) and `.description` in
`i18n/en.json` **and** `i18n/pt-BR.json`. The SDK test `core-plugin-labels.test.ts` fails without
them. Setup fields no `fields` step claims get a leading "Your details" step (or go to a step
declared with `kind: "fields"` and no `fields`). Steps that cannot apply are skipped (no OAuth
method, unknown component, no fields left).

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
