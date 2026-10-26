# Lessons Learned

## 2026-02-26: Security Review (HAY-80 branch)

### Inverted condition bug in sandbox env var blocklist

- **Failure mode**: `if (!baseEnv[varName]) delete sandboxEnv[varName]` — deletes only vars that DON'T exist (no-op), keeps dangerous vars
- **Detection signal**: Code review / security audit
- **Prevention**: Always test sandbox isolation with actual dangerous env vars present

### Pino redact `*` only covers 1 nesting level

- **Failure mode**: `*.password` catches `{a: {password}}` but NOT `{a: {b: {password}}}`
- **Prevention**: Generate paths at multiple depths (`field`, `*.field`, `*.*.field`)

### JWT access/refresh token confusion

- **Failure mode**: Same secret + no `type` claim = tokens are interchangeable
- **Prevention**: Always use separate signing secrets AND a `type` discriminator claim for different token types

### Timing-unsafe string comparison on HMAC signatures

- **Failure mode**: `===` leaks timing information on signature verification
- **Prevention**: Always use `crypto.timingSafeEqual()` for any secret/signature comparison

### Plugin manifest can request arbitrary host env vars

- **Failure mode**: Plugin `env` field in manifest could request `JWT_SECRET`, `DB_PASSWORD`, etc.
- **Prevention**: Maintain a deny-list of sensitive env vars that plugins can never access

### Password reset token O(n) argon2 scan

- **Failure mode**: `verifyResetToken` loads ALL users with pending resets and runs argon2 verify on each — O(n) expensive operations, potential DoS
- **Prevention**: Use SHA-256 for high-entropy tokens (256-bit random) instead of argon2. SHA-256 enables direct DB lookup. Argon2 is only needed for low-entropy secrets (passwords)

### optionalAuth swallows authorization errors

- **Failure mode**: `catch {}` suppresses ALL errors including FORBIDDEN, so a user with invalid org access silently becomes unauthenticated instead of getting an error
- **Prevention**: Only catch authentication failures; re-throw authorization errors (FORBIDDEN)

### Dynamic column names in SQL queries

- **Failure mode**: `entity.${userInput}` in TypeORM query builder allows SQL injection through filter/sort/search field names
- **Prevention**: Validate all dynamic identifiers against `/^[a-zA-Z_][a-zA-Z0-9_]*$/` before interpolation

### enabled_tools not enforced server-side

- **Failure mode**: LLM can call any tool regardless of the conversation's `enabled_tools` list — prompt injection could trigger unauthorized tool execution
- **Prevention**: Check `conversation.enabled_tools` before every tool execution in the orchestrator loop

### Plugin tRPC routers registered only at server boot

- **Failure mode**: A plugin built/installed/enabled while the server was running had no router in `pluginRouterRegistry` until an unrelated restart. `documentSources.listRoots` and the sync engine failed with "does not expose a router". nodemon only watches `server/**/*.ts`, so plugin `dist/*.cjs` builds never triggered a restart.
- **Detection signal**: tRPC BAD_REQUEST "Plugin 'X' does not expose a router with listRoots" despite the manifest having `autoActivate`+`trpcRouter` and `dist/router.cjs` existing on disk.
- **Prevention**: Registration must be self-healing, not boot-only. Added idempotent `pluginManagerService.ensurePluginRouterRegistered(pluginId)`; on-demand router consumers (listRoots, sync `resolveImporter`) call it before `getRouter`.

### `as unknown as` cast hid a broken client/server contract

- **Failure mode**: Agent create/update rejected every payload for ~3 months. Commit 561f3fd ("eliminate all eslint any") retyped Tiptap instruction fields from `z.any()` to `z.array(z.unknown())`, but the editor sends a document object `{type:"doc",content:[]}`. The dashboard's `toInstructionsInput` used `(value ?? {blocks:[]}) as unknown as InstructionsInput`, so the double cast silenced the type error that would have caught it at build time.
- **Detection signal**: tRPC BAD_REQUEST with no server-side log line; the UI showed only a generic "please try again" toast.
- **Prevention**: When replacing `any` with a concrete type, derive the type from the actual runtime payload (check the producer), don't guess from the column name — `instructions` sounds plural but is a single document. Never bridge a client/server shape mismatch with `as unknown as`; if a cast is needed, narrow with a runtime check first (`value?.type === "doc"`). Declare the shape once in a shared module and let both sides infer from it.

### Silent tRPC failures — no onError handler

- **Failure mode**: `createExpressMiddleware` was mounted without `onError`, so every failed procedure (validation, auth, unhandled throw) went back to the client and was never written to the logs. A production incident had zero server-side evidence.
- **Detection signal**: grepping `hay-server-out.log` for the failing procedure name returns nothing at all, while the client clearly receives an error.
- **Prevention**: Always attach `onError` when mounting a tRPC adapter. Log `path`, `type`, `code` and the error; omit `input`, which can carry customer data.

### Type-guessing a jsonb column duplicated the bug downstream

- **Failure mode**: The same wrong "instructions is an array" assumption appeared in `orchestrator/run.ts`, which gated both human-handoff branches on `Array.isArray(instructions) && length > 0`. Always false for a Tiptap doc, so agents' configured escalation instructions silently never ran and the default handoff always fired — no error, just missing behaviour.
- **Detection signal**: A configured feature that never takes effect, with no log line, and a truthiness/shape check sitting between the config and the behaviour.
- **Prevention**: When you fix a shape mismatch, grep for every consumer of that column before closing. Encode the "is this populated" question as one shared predicate (`hasTiptapContent`) rather than re-deriving it per call site.

### Env-backed config secrets leaked into plugin workers

- **Failure mode**: `DENIED_ENV_PATTERNS` in plugin-runner only filters the `manifest.permissions.env` passthrough. A config field with `env: "META_APP_SECRET"` is resolved by `resolveConfigForWorker` and serialised into `HAY_ORG_CONFIG`, so the Meta app secret reached every Instagram worker even though the plugin never reads it — only core needs it for token exchange/refresh.
- **Detection signal**: a config field whose only consumer is core (`register.auth.oauth2({ clientSecret: config.field(...) })`) with no `ctx.config.get()` of that key in the plugin, yet it appears in the worker's `HAY_ORG_CONFIG` / `/on-connected` body.
- **Prevention**: Mark such fields `serverOnly: true`; `stripServerOnlyFields` is applied to every payload that leaves core for a worker (`resolveConfigForWorker`, `/on-connected`). Treat "the deny list covers env vars" as insufficient — config resolution is a second channel to the worker and must be filtered independently.

### Raw webhook body forwarded inside an HTTP header

- **Failure mode**: The plugin proxy and webhook router passed the original request bytes to workers as `x-original-body-base64`. Node's default `maxHeaderSize` is 16 KB, so any webhook above ~12 KB got a 431 from the worker — well below Meta's 3 MB payloads — while every body-parser limit looked generous.
- **Detection signal**: "Raise the body limit" did nothing; the worker answered 431/413 before parsing.
- **Prevention**: Transport bulk data as the request body, never as a header. Raw bytes now go to the worker verbatim under the original content type and the SDK runner captures them with a parser `verify` hook (`req.rawBody`). When a limit seems to be in the wrong place, trace the whole hop chain (core → proxy → worker) before changing numbers.

### Public plugin proxy forwarded worker-internal routes

- **Failure mode**: `/v1/plugins/:pluginId/*` forwarded every path to the org's worker given only `?organizationId=` (org ids are public in widget embeds), so `/mcp/call-tool`, `/deliver`, `/on-connected` and other runner control endpoints were callable from the internet, and a caller-supplied `x-hay-webhook-verified: true` made channel workers trust unsigned webhooks.
- **Detection signal**: a route that core only ever calls over `localhost:<port>` (channel-delivery, oauth.service) but whose path is also reachable through a generic proxy with no auth; a "trust me" header that the proxy does not strip.
- **Prevention**: the public proxy denies the runner's control segments, the channel contract routes and `/ui/*` (`isWorkerInternalPath`), and strips internal trust headers. Any new worker-internal route or header must be added there; plugin UI calls go through the authenticated `plugins.callUiRoute`.

### "Shared Meta app" env vars were the Instagram app's credentials

- **Failure mode**: PLAN.md and the WhatsApp plugin assumed `META_APP_ID`/`META_APP_SECRET` were the Meta app (1869497150332050). They hold the Instagram Business Login app id/secret (1478077373981180), which Instagram OAuth needs. Every WhatsApp webhook failed core's signature check, and Embedded Signup would have exchanged codes with the wrong client.
- **Detection signal**: Meta's dashboard "Test" webhook logs `Shared webhook signature verification failed` while the GET handshake (verify token only) passes; the env app id differs from the app id in the dashboard URL.
- **Prevention**: Before reusing provider credentials across plugins, compare the env value with the app id the provider console shows for that product. WhatsApp now reads `META_WHATSAPP_APP_ID`/`META_WHATSAPP_APP_SECRET`.

### Playwright specs assume dev servers on :3000/:3001 that this host does not run

- **Failure mode**: `playwright.config.ts` has `reuseExistingServer: true`, and something was listening on both ports, so a spec run would have "reused" AdGuard (3000) and an unrelated Next.js app (3001) and failed with misleading 401/404s. Hay itself runs here only as Docker images built from master, with no `.env` for a local stack.
- **Detection signal**: `curl -sI localhost:3000` redirects to `/login.html` (not the Nuxt app); `ss -ltnp` shows a non-Hay process on the port; `docker ps` lists `hay-server`/`hay-dashboard` on 8088/8089 instead.
- **Prevention**: before running e2e, confirm what owns the ports and that a build of the branch under test is what answers. If a branch changes the UI, the spec can only prove it against a dev server started from that branch; report "not run" with the reason rather than a result from the wrong server.

### Dashboard `vitest run` collects Playwright specs

- **Failure mode**: `dashboard/tests/*.spec.ts` are Playwright specs but match Vitest's default include, so `npx vitest run` reports 3 failed files / 0 tests ("Playwright Test did not expect test.describe()") even on a clean tree.
- **Detection signal**: every failing file is under `dashboard/tests/` and the error names Playwright, not an assertion.
- **Prevention**: treat that output as pre-existing noise, not a regression; the real fix is excluding `tests/**` in the dashboard Vitest config (TODO, out of scope for the pause-switch PR).

### Stacked a branch on a base that had already merged
- **Failure mode**: `claude/billing-usage-limits` was created off the local `claude/agent-pause` branch while a parallel session merged agent-pause into master with different SHAs. `git rebase origin/master` then tried to replay the base's commits and conflicted on code this branch never touched.
- **Detection signal**: `git merge-base --is-ancestor <base> origin/master` is false although the base's work is in master; `git log origin/master` shows a "Merge branch '<base>'" commit.
- **Prevention**: Before stacking, `git fetch` and check whether the base already landed; if the base merges mid-task, rebase with `git rebase --onto origin/master <old-base-sha>` so only this branch's own commits replay.

### Stripe fixes a customer's currency with the first subscription
- **Failure mode**: the plans page offered the currency selector whenever no *live* subscription existed, so a cancelled EUR customer could pick USD and Checkout failed with a Stripe error on every retry.
- **Detection signal**: any flow that reuses `stripeCustomerId` and lets the user choose a currency.
- **Prevention**: lock the currency as soon as the account has ever had a subscription (or read `customer.currency`); changing currency needs a new Stripe customer.

