# Anti-Patterns & Pitfalls

Every item here is a **real mistake found in the current `plugins/core/*`**. The existing plugins
are NOT all best practice — treat this as the "don't do what we already did" list. File
references point at the offending code so you can see the smell.

## Metadata & packaging

- **Don't create a `manifest.json`.** Nothing reads it. `plugins/core/atlassian/manifest.json` is
  dead and even contradicts its own `package.json` (different category/type). Metadata lives only
  in `package.json` → `hay-plugin`.
- **Don't use a non-canonical `category`.** Stick to `integration | channel | tool | analytics`.
  `document_importer` (atlassian) works only via a special legacy path and would fail the SDK
  runner's own category validation.
- **Declare every dependency you import.** `zendesk` imports `axios` and `zod` in `mcp/` but
  omits them from `mcp` deps (resolved only transitively); `email-imap` imports
  `imapflow`/`mailparser`/`nodemailer` with no `package.json` at all. A clean install would break
  both. List exactly what you `import`.
- **Never ship a `dist/`-only plugin.** `email-imap` has no `src/` and no `package.json` — it
  can't be rebuilt or discovered, and a `dist/` clean deletes it. Always commit `src/` +
  `package.json`; `dist/` and `node_modules/` are gitignored build output.
- **Keep `package.json`, README, and code in agreement.** The former `email` plugin's README claimed
  `category: utility` / type `mcp-connector` while its `package.json` said `tool` / `mcp` and listed
  different env vars. Three contradicting contracts for one plugin.

## The `mcp/` dependency gap (read this before shipping Archetype A)

The runtime spawns your `mcp/index.js` but **never runs `npm install` inside `mcp/`**, and
`scripts/build-plugins.sh` only installs at the plugin root. `klaviyo` works around it by
committing `mcp/node_modules/`; `magento`, `woocommerce` and `wix` declare only
`@modelcontextprotocol/sdk` + `zod` in `mcp/package.json` and use native `fetch` (no axios), so
they need that install step too.

This is an **unresolved framework gap**, not a settled convention. Until the build is fixed, pick
one and state it in your plugin's README:

- **(pragmatic, works today)** commit a **pruned** `mcp/node_modules` (`npm install --omit=dev`
  in `mcp/`, then commit). This is klaviyo's de-facto approach. Keep deps minimal — declare only
  `@modelcontextprotocol/sdk` + what you use; native `fetch` over axios avoids a dep entirely.
- **(cleaner, needs a one-line build change)** add an `mcp/` install step to the plugin's `build`
  and gitignore `mcp/node_modules`. Preferable long-term — flag it to the maintainers.

Either way: **no vendored bloat** (see next).

## MCP server quality

- **Use `@modelcontextprotocol/sdk`. Don't hand-roll JSON-RPC.** An earlier `woocommerce/mcp`
  reinvented the protocol over raw `readline` — no `initialize` handshake, inconsistent with every
  other plugin. (Replaced; see `woocommerce/mcp/index.js` for the McpServer + stdio form.)
- **Give every tool a real schema — and one tool per support task, not per endpoint.** The old
  `woocommerce` auto-generated ~120 tools with `input_schema: { properties: {}, required: [] }`
  and even the **wrong key** (`input_schema` instead of `inputSchema`). The agent got zero
  parameter guidance and a tool list it could not pick from. Use zod schemas with `.describe()`
  on each param, and expose a prefixed semantic surface (`<platform>_get_order`,
  `<platform>_create_refund`, …) that composes several endpoints — shopify, woocommerce, wix,
  magento and spacebring follow this shape now. The full rules are in `tool-design.md`.
- **Don't make the agent chain lookups.** Spacebring v1 had `find_membership` → `list_resources`
  → `list_bookings` → `create_booking`: the agent carried UUIDs between four calls and did the
  overlap maths itself. One `spacebring_book_space` taking the member's email and the room's name
  does all of it, refuses a taken slot, and offers free alternatives.
- **Return MCP content envelopes.** `{ content: [{ type: "text", text }] }`, `isError: true` on
  failure — not bare payloads.
- **stdout is for JSON-RPC only.** Log to `console.error`. Writing logs to stdout corrupts the
  protocol stream.
- **Don't vendor a third-party repo wholesale.** `magento/mcp/` used to be a live clone of
  `boldcommerce/magento2-mcp` with `.git/`, a 35KB GPL `LICENSE`, `memory-bank/` (Cline AI
  context), `mcp-instructions/`, `.clinerules`, and a test script all committed. It was replaced
  by an original implementation. Vendor only the server code you run — and check the licence.

## Security

- **Never disable TLS verification.** The vendored `magento/mcp/mcp-server.js` shipped
  `new https.Agent({ rejectUnauthorized: false })` ("for development"). This is MITM-exploitable
  in production. (Removed with the rewrite.)
- **Never retry a non-idempotent request after a timeout or 5xx.** A refund POST that times out
  may still have been processed; retrying it refunds twice. Retry 429 for any method, 5xx and
  network errors for GET only (see `woocommerce/mcp/lib/client.js`).
- **Never commit secrets** — including in test fixtures. `chatwoot/test/widget.html` committed a
  real-looking live Chatwoot `websiteToken` + account id. (This file is being removed.)
- **Don't log credentials.** `hubspot/src/index.ts` logs a token preview + length and dumps
  `authState.credentials` on error. Log presence/shape, never values.
- **Mark every secret `encrypted: true`** in its config field.

## Cruft that shouldn't be committed

- Design/TODO docs that drift from the code: `stripe` ships `OAUTH_TODO.md`, `OAUTH_SETUP.md`,
  `IMPLEMENTATION_SUMMARY.md` describing a `manifest.json` + dual-auth architecture that **no
  longer exists** — the code is API-key-only. Docs that lie are worse than none.
- Test artifacts: `hubspot/test-results/.last-run.json` (records a _failed_ run). gitignore these.
- Throwaway verify scripts with hardcoded personal creds: `atlassian/scripts/verify-*.ts`
  hardcode a personal email/site and read a token from `atlassian token.txt`. Not tests — don't
  commit.

## Lifecycle & correctness

- **`onConfigUpdate` that only logs = config edits silently need a restart.** `chatwoot` does this
  with its own client. If you hold client/state in closure vars,
  re-initialize them in `onConfigUpdate`. (Pure `startLocalStdio`/`startExternal` plugins are
  fine — the platform restarts those.)
- **`onDisable` must fully tear down.** `email-imap` nulls its SMTP sender but never `.close()`s
  the nodemailer transport. Stop pollers, close sockets/transports/clients.
- **Webhooks need idempotency.** Channel platforms retry webhooks; `chatwoot` captures
  the provider message id only as metadata with no dedup, so a retried webhook double-posts. Pass
  the provider message id and dedupe on it.
- **Suppress retry storms on non-retryable failures.** Return `200 { success: false, error }` for
  permanent provider errors (e.g. WhatsApp's 24h-window `63016`, Chatwoot 4xx) so Hay records the
  failure instead of the provider hammering your webhook.
- **Don't ship mock success paths.** The former `email` plugin's `send-email` returned
  `{ success: true, messageId: "mock-…" }` and sent nothing. If it's not implemented, fail
  loudly or don't register the tool.
- **One implementation per plugin.** The former `email` plugin had a shipped mock entry AND an
  orphaned, _real_ `mcp/index.js` that was never built or spawned. Keep exactly one; delete the other.

## Boundaries & types

- **Don't reach into `server/dist` from a plugin.** The former `email/mcp/index.js` imported
  `../../../../server/dist/services/plugin-api/plugin-api-client.js`. Use the SDK / the HTTP
  plugin-api, not deep relative paths into the host build.
- **`strict: true`, avoid `any`.** Most plugins ship `tsconfig strict:false` + `catch (e: any)`
  everywhere, which defeats the SDK's typed config/auth APIs.
- **`document_importer` plugins coupling to `@server/*`** (atlassian `router.ts` decrypting config
  itself) is a leaky boundary — minimize it.

## Known shared gap (not your fault, but plan around it)

The `PluginApiClient` (tRPC-over-HTTP to core) is **duplicated byte-for-byte** across channel
plugins. It should be an SDK export. Until then, copy the cleanest version
(`plugins/core/email-imap/dist/plugin-api.js`) and note the duplication.
