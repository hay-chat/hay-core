# WhatsApp Cloud API — Phase 1 core enablers (branch claude/whatsapp-cloud)

Plan: `.claude/plans/whatsapp-cloud/PLAN.md` §3 Phase 1 (decisions D1–D14 final). Codebase map:
`.claude/plans/whatsapp-cloud/research/03-codebase-channel-plugins.md`.

## Checklist (one commit per item)

- [ ] 1. `findPluginIdByChannel` org-aware (D2) + callers in `channel-delivery.service.ts`
  - AC: given org A with plugin X enabled and org B with plugin Y enabled, both `channel:"whatsapp"`, delivery for org A resolves X, org B resolves Y; no enabled instance → undefined. Unit tests.
- [ ] 2. Nested `routeKeyPath` + multi-key descriptors in `webhook-router.service.ts` / SDK `types/webhook-routing.ts`; per-org filtering of `changes[]` in `forwardToOrg` (D4)
  - AC: a Meta WhatsApp payload with two `changes[]` for two orgs' `phone_number_id`s is split so each worker receives only its own `changes[]`; `entry[].id` (WABA) still routes account-level events; Instagram descriptor (`entry`/`id`) behaves exactly as today. Tests in `webhook-router.service.test.ts`.
- [ ] 3. `oauth.completeWithCode` tRPC procedure (D5): exchange ES code (`GET /oauth/access_token`, no `redirect_uri`) in core → `storeTokens` → `runOnConnected(extras)`; SDK `onConnected` gains `extras`
  - AC: procedure requires an enabled instance + oauth2 plugin; token exchange uses `META_APP_SECRET` only in core; extras reach the worker `/on-connected` and the plugin hook; errors map to TRPCError. Unit tests for the service path.
- [ ] 4. `pluginApi.messages.updateStatus({providerMessageId, status, error?})` (D10)
  - AC: updates the `Message` by `provider_message_id` scoped to org; unknown id → no-op result; emits the WebSocket/Redis event the dashboard already uses for delivery state. Tests.
- [ ] 5. `revokeOAuth` clears `plugin_webhook_routes` + stops the worker (D7)
  - AC: after revoke, `findByKey` for that instance's keys returns nothing and the worker is stopped. Tests.
- [ ] 6. ≥3 MB body limit on `/v1/plugins/*/webhook`
  - AC: a 2.5 MB JSON webhook POST is accepted (raw body kept for HMAC); default limit elsewhere unchanged. Test.
- [ ] 7. `attachments[]` on `pluginApi.messages.receive` + `pluginApi.media.upload` (storageService) + `attachments` on `/deliver` payload (D9)
  - AC: receive persists `Message.attachments`; media.upload accepts base64 + mime + filename, stores via storageService, returns `{id,url,name,type,size}` shape; delivery payload carries `message.attachments`. Tests.
- [ ] 8. Delete `plugins/core/whatsapp` (Twilio) + every reference (env vars, `.env.example`, docs, i18n, docker, scripts)
  - AC: `grep -ri twilio` returns only plan/research files and historical migrations; typecheck + tests green.
- [ ] Verify: `npm run typecheck`, `npm run test:server`; Instagram router tests unchanged.
- [ ] WIP.md + CONTEXT.md checkpoint after each item; push + PR referencing PLAN.md.

## Working notes

- `META_APP_SECRET` must never reach a worker (DENIED_ENV_PATTERNS) — code exchange lives in core.
- No backwards-compat shims; no new dependencies; no plugin ids hardcoded in core.
- Worktree: `../hay-core-whatsapp-cloud` (branch `claude/whatsapp-cloud`).

## Results

(pending)
