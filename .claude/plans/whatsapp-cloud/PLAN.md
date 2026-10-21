# Native WhatsApp (Meta Cloud API) channel — analysis & workplan

Status: **APPROVED 2026-10-21** (Roger's answers in §5). Next: Phase 1 in worktree `claude/whatsapp-cloud`. Supersedes `.claude/plans/WHATSAPP_INTEGRATION_ROADMAP.md` (paused Feb 2026, went with Twilio) and `WHATSAPP_INTEGRATION_STRATEGY.md`.
Research backing this plan lives in `research/` — read those files before implementing, do not re-research:

- `01-meta-cloud-api-tech-brief.md` — the API reference (ES v4, webhooks, send, media, templates, pricing, tokens, policy, gotchas). Authoritative.
- `02-strategy-twilio-vs-meta.md` — cost model, competitor flows, OSS reference implementations.
- `03-codebase-channel-plugins.md` — what Hay already has (Instagram plugin + core webhook routing/OAuth) and the gaps, with `file:line` pointers.
- `04-meta-dashboard-state.md` — real state of the Hay.chat Meta app (id `1869497150332050`).

## 1. Conclusion

Go direct as a **Meta Tech Provider** with **Embedded Signup v4 + coexistence**, replacing Twilio. Reasons, in order of weight:

1. **Cost structure.** Twilio charges $0.005/msg in both directions; after Meta's 2026-10-01 change that fee is 2–3× Meta's own cost in BR/US for a chatty bot (worked example: $460 Twilio overhead vs $140–280 Meta for 10k conversations). Direct, each customer's Messaging account gets 1,000 free service msgs/month and Meta bills the customer's own card — Hay carries no messaging COGS.
2. **Onboarding.** ES popup = ~3–5 min for the customer vs Twilio sender registration + console. Coexistence lets Brazilian SMBs keep the WhatsApp Business app on the phone — Intercom/Gorgias/Tidio can't do this.
3. **Readiness.** Hay's Meta app is already Live, business-verified (Oct 2025), has the WhatsApp use case + Facebook Login for Business added, legal URLs set, and a test number. The only Meta blocker is App Review for Advanced Access on two permissions.
4. **Code reuse.** ~70% of the plumbing exists from the Instagram plugin: core HMAC verification + `hub.challenge` handshake + per-org routing table, OAuth service, encrypted auth state, dedupe, `/deliver`. The plugin is a sibling of `plugins/core/instagram`.
5. **Policy.** Meta's AI-provider ban (Jan 2026) targets general-purpose assistants; business-specific support bots with a human escalation path are explicitly allowed. Hay already has human handoff.

Not doing: BSP middle path (360dialog etc. — still needs Tech Provider status, adds €/number), Twilio ISV program (same App Review, same fee), unofficial clients (Baileys — ban risk), Hosted ES as the primary flow (needs `business_management` + system-user token; keep as a fallback only).

## 2. Design decisions (proposed — confirm before the build session)

| #   | Decision                  | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Why                                                                                                                                                                                                 |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Plugin identity           | New plugin dir `plugins/core/whatsapp-cloud`, npm `hay-channel-whatsapp-meta`, **channel slug stays `whatsapp`**. Twilio plugin is sunset after migration (alpha product: no long-term dual support).                                                                                                                                                                                                                                                                           | Keeps agents/conversations/customers/analytics keyed on one channel; avoids a `whatsapp-cloud` slug leaking into UI.                                                                                |
| D2  | Slug conflict in core     | Make `findPluginIdByChannel` org-aware: resolve the _enabled plugin instance_ for `(org, channel)`, not the first plugin with that slug.                                                                                                                                                                                                                                                                                                                                        | Lets Twilio and Cloud coexist per org during migration with no flag day. Small change, unit-testable.                                                                                               |
| D3  | Customer identity         | `external_id` = `+<wa_id>` (E.164 with `+`, which is exactly what the Twilio plugin stores today — `webhook.ts:61` strips `whatsapp:` from `whatsapp:+55...`). Always persist `contacts[].user_id` (BSUID) and `profile.name` in `external_metadata.whatsapp`. If `from`/`wa_id` is absent (username users, 2026+), fall back to `external_id = whatsapp:bsuid:<user_id>` and send with `recipient`.                                                                            | Twilio-era customers keep their identity; BSUID is portfolio-scoped so it can't be the primary key across tenants.                                                                                  |
| D4  | Webhook routing           | Route by `phone_number_id`. Extend core `routeKeyPath` to support a nested path (`entry[].changes[].value.metadata.phone_number_id`) with `entry[].id` (WABA/Messaging-account id) as a second key for account-level webhooks (`account_update`, template events — those can't be overridden per number). `onConnected` registers both keys.                                                                                                                                    | `entry.id` alone can't separate two numbers on one WABA; account-level webhooks only carry the WABA id. Core change is ~40 lines + tests in `webhook-router.service.ts`.                            |
| D5  | Embedded Signup transport | FB JS SDK popup inside the plugin's dashboard settings page (`register.ui.page`), `FB.login` with `config_id`, `response_type:'code'`, `extras:{setup:{}}` (v4 — no `featureType`/`sessionInfoVersion`). Dashboard posts `{code, waba_id, phone_number_id, event}` to a **new core tRPC procedure** that exchanges the code (needs `META_APP_SECRET`, which workers never see), stores the business token in `authState`, then calls the worker's `/on-connected` with the ids. | The ES `code` has a 30-second TTL; the existing redirect-based `oauth.service` can't carry `waba_id`/`phone_number_id`. Reuse `storeTokens`/`runOnConnected`; add a `completeWithCode` entry point. |
| D6  | Manual / BYO-token mode   | Keep a second auth path: paste permanent system-user token + `phone_number_id` + `waba_id` (like Chatwoot/Typebot).                                                                                                                                                                                                                                                                                                                                                             | Lets dev + design partners run before App Review (onboarding cap is 10 customers/7 days until then) and is a permanent escape hatch.                                                                |
| D7  | Token lifecycle           | Business token config set to **never expire**; omit `tokenRefresh`. Mark disconnected on `account_update: PARTNER_APP_UNINSTALLED / PARTNER_REMOVED / ACCOUNT_OFFBOARDED` and on Graph error 190. Fix `revokeOAuth` to clear `plugin_webhook_routes` and stop the worker (existing bug).                                                                                                                                                                                        |                                                                                                                                                                                                     |
| D8  | Registration              | After ES: `POST /{waba}/subscribed_apps`, then `POST /{phone}/register` with a per-org random 6-digit PIN stored encrypted in authState — **skip when `is_on_biz_app` (coexistence)**. Show `health_status` + `primary_funding_id` (payment method) in the settings page with copy "Meta bills you directly for messages".                                                                                                                                                      | Without `/register` every send fails with 133010; without a card the customer stops at the free tier.                                                                                               |
| D9  | Media                     | Core gains `attachments` on `pluginApi.messages.receive` and on the `/deliver` payload. Inbound: plugin downloads via `GET /{media_id}` → 5-min URL → core `storageService` → dashboard renders. Outbound: upload to `/{phone}/media`, send by id. Voice notes (OGG/opus) are first-class in Brazil → transcription in phase 3.                                                                                                                                                 | Webhook media ids expire in 7 days, URLs in 5 min: download immediately.                                                                                                                            |
| D10 | Statuses, read, typing    | New `pluginApi.messages.updateStatus({providerMessageId, status, error?})`; plugin forwards `statuses[]`. Mark-as-read + `typing_indicator` once when the orchestrator starts generating (core emits a "processing started" event the delivery service forwards to `/typing`).                                                                                                                                                                                                  | Cheap UX wins; also where `failed` + 131047 becomes a visible "24h window closed" state.                                                                                                            |
| D11 | Templates                 | Phase 3: sync `GET /{waba}/message_templates` into a table per plugin instance, subscribe `message_template_status_update`, human-agent template picker when the window is closed, proactive `messages.send` via templates. The AI agent never initiates, so the window is normally open.                                                                                                                                                                                       | Templates belong to Hay's Messaging account per customer — **zero templates after onboarding/migration**; must be created under Hay.                                                                |
| D12 | Pair rate limit           | Orchestrator must send one coalesced message per turn (1 msg / 6 s per user → 131056). Verify current behaviour; interactive buttons (≤3) only via explicit agent tools later.                                                                                                                                                                                                                                                                                                  |                                                                                                                                                                                                     |
| D13 | Twilio migration          | No number "migration" exists under Meta's new account model: customer re-runs ES and _shares_ the number → Hay gets its own Messaging account; display name/quality/tier carry over, templates don't. Twilio and Hay can be attached simultaneously (throughput/tier shared); inbound fan-out across two partners is **undocumented — test with one customer before promising parallel running**.                                                                               |                                                                                                                                                                                                     |
| D14 | Testing                   | Meta test number (`phone_number_id 976350592236691`) + manual mode from day 1; unit tests for payload normalisation/signature/routing (neither existing channel plugin has tests — this one must).                                                                                                                                                                                                                                                                              |                                                                                                                                                                                                     |

## 3. Workplan

Sizes are rough build-session estimates (one focused Claude session ≈ half a day). Phases 0 and A run in parallel with code.

### Phase 0 — Meta console (Roger, manual, start now)

- [ ] Open the "pending review" alerts in WhatsApp Manager; fix the missing payment method on Hay's own WABA (needed for demo/App Review videos).
- [x] Facebook Login for Business → Configurations → config "Hay.chat Wpp Embedded Signup", login variation Embedded Signup, product WhatsApp Cloud API only, token never expires, permissions `whatsapp_business_messaging` + `whatsapp_business_management` → `config_id` **1666846881828080** (done 2026-10-21).
- [ ] WhatsApp → Configuration: set callback URL `https://<prod-api>/v1/plugins/<pluginId>/webhook` + verify token (`META_VERIFY_TOKEN`); subscribe fields `messages, account_update, account_alerts, phone_number_quality_update, phone_number_name_update, message_template_status_update, template_category_update, business_capability_update, history, smb_app_state_sync, smb_message_echoes`. (Can only be finished once Phase 2 is deployed — the GET handshake must answer.)
- [ ] Enable 2FA on the admin account, add a second admin.
- [ ] Open the "Tech Provider Integration" tab; complete Tech Provider onboarding.
- [ ] Add `META_VERIFY_TOKEN` to prod env (Infisical). `META_WHATSAPP_ES_CONFIG_ID` already saved 2026-10-21.

### Phase 1 — Core enablers (1 PR, ~1 session)

1. `findPluginIdByChannel` → org-aware resolution (`plugin-manager.service.ts:971`) + tests. (D2)
2. Nested `routeKeyPath` support + multi-key descriptors in `webhook-router.service.ts` / `types/webhook-routing.ts`; per-org filtering of `changes[]` in `forwardToOrg`. Tests in `webhook-router.service.test.ts`. (D4)
3. `oauth.completeWithCode` tRPC procedure: exchange code (`GET /oauth/access_token`, no redirect_uri) → `storeTokens` → `runOnConnected(extras)`. `onConnected` hook gains an `extras` arg in the SDK. (D5)
4. `pluginApi.messages.updateStatus` + `Message` status fields update by `provider_message_id`. (D10)
5. `revokeOAuth` clears routes + stops worker. (D7)
6. Raise body limit on `/v1/plugins/*/webhook` to ≥3 MB (Meta payload max).
7. `attachments[]` on `pluginApi.messages.receive` (plugin passes already re-hosted URLs via a new `pluginApi.media.upload` → `storageService`) and on the `/deliver` payload (`message.attachments`). (D9)
8. Delete `plugins/core/whatsapp` (Twilio), its env vars in `.env.example`/docs, and the Twilio-specific `24h_window_expired` copy if any — no customers use it, and the new plugin takes the dir name `plugins/core/whatsapp` and slug `whatsapp`. (D1/D13)
   Acceptance: Instagram flow unchanged (tests green), new procedures unit-tested.

### Phase 2 — Plugin v1: onboarding + text + media/voice (~3 sessions)

`plugins/core/whatsapp` (npm `hay-channel-whatsapp-meta`) cloned from instagram:

- `graph-client.ts` on `graph.facebook.com/v26.0`: `sendText`, `sendTemplate` (stub), `markReadTyping`, `subscribeApp(waba)`, `registerPhone(pin)`, `getPhone(fields)`, `getWaba(fields)`, `getMedia`, `uploadMedia`; typed `GraphApiError`.
- `webhook.ts`: iterate **every** `entry[]/changes[]`; normalise `text`, `interactive.button_reply/list_reply` (→ title text + payload in metadata), `button`, `location`, `contacts`, `reaction`, `request_welcome`, `referral`/`context` into `messages.receive` with `metadata.mid=wamid`; `statuses[]` → `updateStatus`; media types (`image`,`video`,`audio`,`document`,`sticker`) → `GET /{media_id}` → download with Bearer → `media.upload` → `attachments[]` (caption as content); voice notes additionally transcribed (reuse the orchestrator's STT if one exists, else OpenAI transcription) so the agent can answer them; `account_update` → disconnect handling.
- `deliver.ts`: text + attachments (upload to `/{phone}/media`, send by id) with `+` E.164 / `recipient` BSUID; 131047 → `24h_window_expired`; 131056/130429 → 5xx (retry); 190 → mark disconnected.
- Onboarding UI (`AfterSettings.vue`): ES v4 popup (FB SDK loaded on click, only on this page), progress states, manual-token tab (also the self-hosting path), post-connect health card (number, display name/status, `health_status`, quality, tier) and a **payment-method card**: when `primary_funding_id` is absent show a deep link to the customer's WhatsApp Manager billing page and re-check on return — Meta has no API to add a card, so this is the one unavoidable trip out of Hay.
- `onConnected`: subscribe app, register phone (unless coexistence), store `phone_number_id`/`waba_id`, return routing keys + account label.
- i18n en + pt-BR; unit tests for normaliser, signature path, deliver error mapping.
  Acceptance: end-to-end on the Meta test number incl. an image and a voice note both ways; dashboard renders image/audio/document in the conversation view; a coexistence onboarding with a real Business-app number; webhook dedupe verified by replaying a payload.

### Phase A — App Review (Roger, after Phase 2 is deployable, ~1–3 weeks Meta time)

- Record video 1 (send from Hay UI → received on phone), video 2 (template created via Hay or WhatsApp Manager). Submit `whatsapp_business_messaging` + `whatsapp_business_management` with Tech Provider "allowed usage" text. Until approved: design partners via app roles / manual mode (cap 10/7 days).

### Phase 3 — Templates & window state (~2 sessions)

Template table + sync + status webhooks; conversation `window_expires_at` from last inbound timestamp; dashboard shows "window closed — send a template"; human-agent picker; proactive sends; agent handoff message fallback to a utility template when outside the window.

### Phase 4 — Coexistence extras (~1 session)

`smb_message_echoes` → messages authored by the business from the phone (so the AI doesn't double-answer); optional 6-month `history` import.

### Backlog (not planned)

Flows, Calling API, Payments BR (Pix) via `order_details`, Block API, No-Storage / Local-Storage (BR data residency) toggle, interactive buttons as agent tools, Marketing Messages API.

## 4. Risks

- **App Review latency / rejection** — mitigated by manual mode + app-role testers; keep videos single-permission and the allowed-usage text literal.
- **Account model migration in flight at Meta (WAAC split, `messaging_account_id` required H1 2027)** — model `waba_id` as "messaging account id" from day 1; keep ids in metadata, don't bake "WABA owns number" into schema.
- **Username users with no phone** — D3 fallback; test with a username-enabled account.
- **Billing confusion** — customers now pay Meta directly; onboarding copy + pricing page must say so; 1,000 free service msgs/number/month.
- **Pair rate limit 131056** on multi-message agent turns — audit orchestrator output before launch.

## 5. Roger's answers (2026-10-21)

1. **Twilio has zero customers** → delete the Twilio plugin in Phase 1; no migration runbook; new plugin reuses dir `plugins/core/whatsapp` and slug `whatsapp`.
2. **Slug/core**: keep `whatsapp`, make `findPluginIdByChannel` org-aware (D2 as recommended).
3. **Media in v1** because of voice notes → core attachments moved into Phase 1, media + transcription in Phase 2.
4. **FB JS SDK in dashboard**: fine — load on click, only on the WhatsApp settings page; allowlist `connect.facebook.net` if a CSP is ever added.
5. **No platform fee.** Keep the customer inside Hay as much as possible: everything except adding the card happens in the ES popup or Hay UI; the card gets a deep link + status re-check (Meta has no API for it).
6. **Twilio is dead**; no parallel running.

## 6. Self-hosting

Must stay possible (Roger's requirement). Two supported paths, both already in the plan:
- **Manual mode (D6)**: the self-hoster creates their own Meta app ("Direct Integrator" — no App Review, no Tech Provider status), generates a permanent system-user token with `whatsapp_business_messaging` + `whatsapp_business_management`, and pastes token + `phone_number_id` + `waba_id` into Hay. They set their own callback URL + verify token in their app dashboard. Core must therefore accept `META_VERIFY_TOKEN`/`META_APP_SECRET` from env in any deployment (already true) and the manual path must not require Hay's `config_id`.
- **Own Tech Provider**: set `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN` and a new `META_WHATSAPP_ES_CONFIG_ID` env var; the ES popup then runs against their app. They do their own App Review. Document both in the plugin README.
