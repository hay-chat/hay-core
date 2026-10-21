# WhatsApp Cloud API — Phase 2 plugin (branch claude/whatsapp-plugin)

Spec: `.claude/plans/whatsapp-cloud/PLAN.md` §3 Phase 2 (D1–D14 final, §5 answers, §6 self-hosting).
Plugin: `plugins/core/whatsapp`, npm + plugin id `hay-channel-whatsapp-meta`, channel `whatsapp`,
UMD global `WhatsappMetaPlugin`, Graph `https://graph.facebook.com/v26.0`.

## Checklist (one commit each)

- [x] 0. Security: public proxy blocks worker-internal paths + strips `x-hay-webhook-verified` (also PR #100)
- [x] C1. Core: `onConnected` may return `credentials` (merged into encrypted authState) + `oauth2.connectFlow: "client"`
- [x] C2. Core: authenticated `plugins.callUiRoute` → worker `/ui/*` (public proxy blocks `ui`); plugin UI props `api` + `locale`
- [x] C3. Core: `pluginApi.connection.revoke` + `pluginApi.media.upload({ transcribe })` (OpenAI STT in core)
- [x] 1. Plugin skeleton: manifest, config, webhookRouting (nested), graph-client, manual-mode signature/handshake, onStart/onConnected
- [x] 2. Inbound normaliser: text/interactive/button/location/contacts/reaction/request_welcome/context/referral, statuses → updateStatus, account_update → revoke
- [x] 3. Media inbound: GET /{media_id} → download → media.upload (voice → transcribe) → attachments[]
- [x] 4. deliver.ts: text + attachments, error mapping (131047 / 131056 / 130429 / 190)
- [x] 5. Onboarding UI: ES v4 popup, manual tab, health card, payment card, en + pt-BR
- [x] 6. README + docs/user-guide/integrations/whatsapp.md (docs submodule)
- [x] Verify: `npm run typecheck`, `npm run lint`, `npm run test:server`, plugin `npm test`, plugin build loads

Acceptance: plugin builds + loads; Instagram unchanged; unit tests for normaliser, signature path, deliver
error mapping, onConnected extras verification; PR open referencing PLAN.md.

## Contracts (agents: build against these exactly)

- **onConnected result** `{ routingKeys?, account?, credentials?: Record<string,string> }`. Core merges
  `credentials` into `authState.credentials` (encrypted). Reserved keys core ignores: `accessToken`,
  `refreshToken`, `expiresAt`, `connectedAt`, `tokenType`, `scope`. Worker reads them back via
  `ctx.auth.get().credentials` on every start.
- **`oauth2.connectFlow?: "redirect" | "client"`** (default redirect). `"client"`: dashboard OAuth card hides
  Connect/Reconnect (status + Disconnect stay); `plugins.oauth.initiate` rejects with BAD_REQUEST.
- **`plugins.callUiRoute`** (authenticated): `{ pluginId, method: "GET"|"POST", path, body? }`,
  `path` matches `^/ui/[a-z0-9/-]*$`; instance must exist + be enabled for the caller's org; starts the
  worker, forwards JSON, returns `{ status: number, data: unknown }`. Public proxy 404s first segment `ui`.
- **Plugin UI props**: `plugin, config, apiBaseUrl, api` (the dashboard `Hay` tRPC client), `locale` (string).
- **`pluginApi.connection.revoke({ reason })`** → `{ revoked: true }`; core runs `oauthService.revokeOAuth`
  after responding (the call stops the calling worker).
- **`pluginApi.media.upload({ data, mimeType, filename, transcribe? })`** → attachment `{id,name,url,type,size}`
  plus `transcript?: string` when `transcribe` and STT succeeded (absent otherwise, never throws for STT).
  `mimeType` must be bare (strip `; codecs=opus`).

## Working notes

- `META_APP_SECRET`/`OPENAI_*`/`*TOKEN*` env never reach workers (DENIED_ENV_PATTERNS).
- Manual mode (D6/§6) = config fields (showWhen `connectionMode === "manual"`): token, phoneNumberId, wabaId,
  appSecret, verifyToken. Webhook = per-org URL `/v1/plugins/hay-channel-whatsapp-meta/webhook?organizationId=<org>`;
  worker answers the GET handshake and verifies `x-hub-signature-256` over `req.rawBody` itself. No routing keys,
  no Hay config_id needed. ES mode = shared URL, core verifies, worker trusts `x-hay-webhook-verified`.
- Customer identity (D3): `from = "+<wa_id>"`; no wa_id → `whatsapp:bsuid:<user_id>`; BSUID + profile name in metadata.
- Agents share one worktree: never run git, never `npm install`; only edit files you own.

## Results

Commits on `claude/whatsapp-plugin` (one per slice): proxy security fix (also PR #100); C1 onConnected credentials +
connectFlow; C2 plugins.callUiRoute + UI props; C3 connection.revoke + media.upload transcribe; plugin skeleton;
webhooks.setRoutingKeys (core) + manual-mode route claim (plugin) — added after finding that a manual token from the
app whose callback is the shared URL (Hay's test number) would never route; deliver; media; inbound normaliser + README;
OAuth card refresh event; settings UI; docs submodule (hay-docs branch claude/whatsapp-plugin).

Verification: `npm run typecheck` exit 0; `npm run lint` exit 0; `npm run test:server` 635 passed / 73 failed — the
same 5 DB-only integration suites as master; plugin vitest 104/104; SDK vitest 123 passed / 5 failed (known
sdk/register.test.ts baseline); plugin + Instagram build; worker smoke (runner boots, manual handshake 200/403,
signed POST 200, unsigned 403, /ui/status). NOT done: anything against real Meta (needs deploy + console webhook),
browser run of the ES popup (needs https origin), migration 1784400000000 still unrun.

Follow-ups: core has no delivery retry (503 rate_limited just fails the reply); typing indicator / read receipts (D10)
need a core "processing started" hook; config option labels not translated (plugin `config` i18n); BSUID re-keying on
`user_changed_user_id`; STT uses the platform OpenAI key, not the org provider (HAY-251).
