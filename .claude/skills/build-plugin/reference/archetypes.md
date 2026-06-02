# Plugin Archetypes

Pick the archetype that matches how the external platform exposes itself. Most platforms map
cleanly to one. Each links to a template and a real reference plugin.

---

## A. Local bundled MCP server (most common)

**When:** the platform has a REST/GraphQL API and you want to expose it to the agent as tools,
but there's no hosted MCP endpoint. You ship a small Node MCP server inside `mcp/`.

**Shape:** entry registers config + apiKey auth; `onStart` gates on creds then
`ctx.mcp.startLocalStdio({ command: "node", args: ["index.js"], cwd: "./mcp", env: { … } })`.
The `mcp/index.js` uses `@modelcontextprotocol/sdk` (`McpServer` + `StdioServerTransport`),
reads creds from `process.env`, and exposes tools.

**Reference: `klaviyo` — the gold standard.** Study `plugins/core/klaviyo/mcp/index.js`:

- First-party server using **native `fetch`** (no axios).
- A single `klaviyoApi(method, path, {query, body})` helper centralizing auth headers and query
  serialization.
- `ok()` / `fail()` helpers for consistent `{ content: [{type:"text"}], isError }` responses.
- `cleanResult()` strips JSON:API `relationships`/`links` to save agent tokens.
- Shared zod schema fragments (`fieldsSchema`, `filterSchema`, …) reused across tools.
- Rich tool descriptions with doc links and **cross-tool hints**
  ("To get performance data, use get_campaign_report").

**Reference for many tools: `zendesk`.** Splits tools by domain into `mcp/tools/*.js` (each
exporting `[{ name, description, schema, handler }]`), aggregated in `mcp/server.js` via
`allTools.forEach(t => server.tool(...))`, backed by one shared `ZendeskClient` singleton with a
central `request()` doing auth + error normalization. This scales past ~10 tools cleanly.

**Templates:** `templates/index.ts.tmpl` (Archetype A branch) + `templates/mcp-server.js.tmpl`.

> ⚠️ Bundled-MCP plugins have a real dependency-install gap — read
> `anti-patterns.md` → "The mcp/ dependency gap" before shipping, or your server won't start.

---

## B. Remote MCP connector

**When:** the platform already **hosts an MCP server** (e.g. Stripe, HubSpot). You write almost
no MCP code — just authenticate and point at their URL.

**Shape:** `onStart` reads the credential/token and calls
`ctx.mcp.startExternal({ id, url, authHeaders })`. No `mcp/` directory at all.

**Reference (API key): `stripe`.** `onValidateAuth` pings `GET /v1/balance`; `onStart` →
`ctx.mcp.startExternal({ url: "https://mcp.stripe.com", authHeaders: { Authorization: "Bearer sk_…" } })`.

**Reference (OAuth — the clean OAuth pattern): `hubspot`.** Declares
`register.auth.oauth2({ authorizationUrl, tokenUrl, scopes, clientId: ctx.config.field("clientId"),
clientSecret: ctx.config.field("clientSecret") })`; `onStart` reads
`ctx.auth.get().credentials.accessToken` and passes it as `authHeaders` to `startExternal`.
The platform runs the whole OAuth dance and refreshes tokens — the plugin never touches OAuth
endpoints directly.

**Template:** `templates/index.ts.tmpl` (Archetype B branch).

---

## C. Channel (messaging integration)

**When:** a two-way messaging platform (WhatsApp, Chatwoot, email, SMS) where users talk to the
agent. Inbound webhooks become Hay messages; Hay replies are delivered back.

**Shape:** `category: "channel"`, `capabilities: ["messages","customers"]`, plus a `channel:`
key. Register routes instead of (or alongside) MCP:

- `POST /webhook` (or `/messages`) — **verify signature → filter → `messages.receive`**.
- `POST /deliver` — send Hay's reply via the provider API.
- optional `POST /escalate` — human handoff; conversation-status sync.

Use a `PluginApiClient` (tRPC-over-HTTP via `HAY_API_URL`/`HAY_API_TOKEN`) to call back into
core. The inbound contract is `messages.receive({ from, content, channel, senderType?,
externalConversationId?, metadata })`.

**Reference (best signature verification): `chatwoot`.** `src/webhook.ts` does HMAC-SHA256 over
**raw bytes** (`x-original-body-base64`), with a 300s **replay window** and
`crypto.timingSafeEqual`. It also filters bot echoes/private notes/templates and syncs
conversation status. Prefer this over WhatsApp's approach (which delegates to the Twilio lib over
a re-encoded body and is more fragile).

**Reference (best inbound/outbound semantics): `email-imap`** (read `dist/` — see note below).
Marks an IMAP message `\Seen` **only after** successful processing (at-least-once), wraps each
message in its own try/catch, and reconstructs email threading (`In-Reply-To`/`References`).

**Template:** `templates/channel.ts.tmpl`. Build the `PluginApiClient` by copying the canonical
one from `plugins/core/email-imap/dist/plugin-api.js` (it is currently duplicated across channel
plugins — see anti-patterns; until it's an SDK export, copy the cleanest version).

> ⚠️ `email-imap` ships as `dist/`-only with **no `src/` and no `package.json`** — it is the repo's
> cautionary tale, not a layout to copy. Study its compiled logic, but give YOUR plugin a real
> `src/` + `package.json`.

---

## D. Document importer / retriever (advanced, non-standard)

**When:** you import documents from a source (Confluence, a wiki) into Hay's knowledge base
rather than exposing tools or a channel.

**Shape:** `category: "document_importer"`, `autoActivate: true`, `trpcRouter: "./src/router.ts"`,
and a `src/router.ts` implementing the `DocumentImporterContract`
(`listRoots`/`discover`/`fetchPage`/`listChanges`). This rides a **separate path** outside the
normal SDK worker model and is **tightly coupled to server internals**.

**Reference: `atlassian`.** Good parts to copy: the dual basic-or-OAuth `AuthConfig` discriminated
union (`authConfigFromCtx`), the `ConfluenceClient` HTTP client with a **real retry policy**
(429 `Retry-After`, exponential backoff on 5xx — the best HTTP-client pattern in the repo), and the
pure, never-throws `adf-to-markdown.ts` transform.

**Caveats (do NOT copy):** its dead `manifest.json`; `router.ts` importing `@server/*` internals
and decrypting config itself (leaky boundary); `JiraClient` lacking the retry policy
`ConfluenceClient` has. Treat this archetype as advanced — confirm the contract in
`server/services/*document*sync*` before starting.

---

## Choosing — quick guide

| The platform…                         | Archetype                          |
| ------------------------------------- | ---------------------------------- |
| has a REST API, no hosted MCP         | **A** local bundled MCP            |
| hosts its own MCP server              | **B** remote connector             |
| is two-way messaging (chat/email/SMS) | **C** channel                      |
| is a document source to ingest        | **D** document importer (advanced) |

When in doubt, **A** is the default for "let the agent use this platform's API."
