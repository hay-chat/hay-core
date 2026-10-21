# Phase 2 kickoff prompt (paste into a fresh session in hay-core)

ultrathink

We're building the native Meta WhatsApp Cloud API channel for Hay. Phase 1 (core enablers) is MERGED
(PR #99) and deployed to prod; the Meta console is configured. Do NOT re-research Meta's API or the
channel architecture, and do not redo Phase 1.

Read, in this order:

1. WIP.md (top entry)
2. .claude/plans/whatsapp-cloud/PLAN.md — §2 decisions D1–D14 are final; §3 "Phase 2" is your spec;
   §5 Roger's answers; §6 self-hosting (manual-token mode is mandatory).
3. .claude/plans/whatsapp-cloud/research/03-codebase-channel-plugins.md — the Instagram plugin is the
   template (plugins/core/instagram); note what Phase 1 added in core:
   - plugins.oauth.completeWithCode (ES code exchange in core) → SDK onConnected(ctx, extras)
   - routeKeyPath.nested (route by entry[].changes[].value.metadata.phone_number_id + entry[].id)
   - pluginApi messages.updateStatus, messages.receive attachments[], media.upload
   - /deliver payload carries attachments; raw webhook bytes arrive as req.rawBody (5 MB)
   - config fields can be `serverOnly: true` (use it for clientSecret)
4. .claude/plans/whatsapp-cloud/research/01-meta-cloud-api-tech-brief.md — delegate section reads to
   subagents (A2 Embedded Signup v4, B1 webhooks, B2 sending, B3 media, C1 tokens, Gotchas); don't
   load it whole into the main context.

Facts already settled (do not change):

- Plugin dir plugins/core/whatsapp, npm hay-channel-whatsapp-meta, **plugin id hay-channel-whatsapp-meta**
  (Meta's deauthorize/data-deletion callbacks already point at
  https://eu.hay.chat/v1/plugins/hay-channel-whatsapp-meta/{deauthorize,data-deletion}), channel slug `whatsapp`.
- Embedded Signup config_id 1666846881828080 (env META_WHATSAPP_ES_CONFIG_ID, already in prod via
  Infisical), FB Login for Business "Login with JS SDK" ON, allowed domain https://eu.hay.chat.
  Local testing of the popup needs an https origin (ngrok/cloudflared) added to that allowlist.
- META_APP_ID / META_APP_SECRET / META_VERIFY_TOKEN exist in prod. The app secret must never reach the
  worker: declare clientSecret with `serverOnly: true`, do the code exchange via completeWithCode.
- Graph API v26.0 on graph.facebook.com. Meta test number phone_number_id 976350592236691.
- App Review not submitted yet → only app-role users can complete ES; manual-token mode (D6) is how
  design partners and self-hosters connect, so build it in the same slice as ES.

Work in a worktree: claude/whatsapp-plugin (use /tree new whatsapp-plugin), branched from master.

Deliverable = PLAN.md §3 Phase 2, in thin vertical slices, one PR-able commit each:

1. Plugin skeleton cloned from instagram: manifest, config (serverOnly clientSecret, env-backed
   META\_\* fields), webhookRouting with nested routeKeyPath, graph-client.ts (sendText, sendTemplate
   stub, markReadTyping, subscribeApp, registerPhone, getPhone, getWaba, getMedia, uploadMedia, typed
   GraphApiError), onConnected (subscribe app, register phone unless coexistence, return routing keys
   [waba_id, phone_number_id] + account label). Verify extras (waba_id/phone_number_id) against the
   Graph API with the stored token before trusting them.
2. Inbound webhook.ts: iterate every entry[]/changes[]; normalise text/interactive/button/location/
   contacts/reaction/referral/context → messages.receive with metadata.mid=wamid and external_id per D3
   (+E.164, BSUID fallback); statuses[] → updateStatus; account_update → disconnect handling.
3. Media: image/video/audio/document/sticker → GET /{media_id} → download → media.upload →
   attachments[] (caption as content); voice notes transcribed (reuse the orchestrator STT if one
   exists, else OpenAI transcription) so the agent can answer them.
4. deliver.ts: text + attachments (upload to /{phone}/media, send by id); 131047 → 24h_window_expired;
   131056/130429 → 5xx; 190 → mark disconnected.
5. Onboarding UI (AfterSettings.vue, read .claude/FRONTEND.md first): ES v4 popup (FB SDK loaded on
   click, only on this page; FB.login with config_id, response_type 'code', extras:{setup:{}}), post
   {code, waba_id, phone_number_id} to plugins.oauth.completeWithCode; manual-token tab; health card
   (number, display name, health_status, quality, tier); payment-method card with deep link to
   business.facebook.com/settings/whatsapp-business-accounts/<waba>?business_id=<biz>&tab=whatsapp_settings
   and re-check on return. i18n en + pt-BR.
6. README (cloud + self-hosting manual mode + own-Tech-Provider env vars), docs/user-guide/
   integrations/whatsapp.md finish (docs is a git submodule).
   Every slice ships with unit tests (normaliser, signature path, deliver error mapping, onConnected
   extras verification) — neither existing channel plugin has tests; this one must (D14). Run
   npm run typecheck, npm run lint, npm run test:server before claiming anything; report failures verbatim
   (5 integration suites need a live Postgres and fail on master — known).

Strategy: keep the main context thin; fan out subagents for the tech-brief reads and for independent
slices (2 and 4 are independent of 5). Checkpoint WIP.md after each landed slice. If a PLAN.md decision
turns out wrong, stop and tell me before working around it; add the lesson to tasks/lessons.md.

Done = plugin builds and loads, Instagram untouched, tests green, PR open with a summary referencing
PLAN.md, and a short list of what I must do next: set the webhook callback URL + verify token in the
Meta console (needs the deployed plugin to answer the GET handshake), subscribe the webhook fields
listed in PLAN.md Phase 0, then record the App Review videos (Phase A).
