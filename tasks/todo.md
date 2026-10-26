# Approval-mode delivery on every channel (claude/approval-delivery)

## Goal

"Require Approval" holds AI replies as `deliveryState=queued`. Approving flips them to `sent` but
nothing republishes the message, so `channelDeliveryService` (which only reacts to `message_received`
events) never posts it to the WhatsApp / Instagram / Chatwoot plugin, and webchat only sees it on
its 10 s poll. Make approval deliver the reply on every channel, in real time.

## Acceptance criteria

- Approving a queued message (with or without edits) publishes a `message_received` event carrying
  the final content and `deliveryState: "sent"` → channel plugins receive `/deliver`, webchat gets
  it over WebSocket, dashboard updates in place.
- Blocking a queued message publishes nothing deliverable.
- Approval is org-scoped and rejects non-queued messages (unchanged behaviour).
- One payload builder for `message_received` (entity addMessage + approval share it).
- Unit tests pin the above; Playwright covers approve in the dashboard end to end.
- User guide says approved replies reach the customer on every channel + the 24 h window caveat.

## Checklist

- [x] Restate goal + acceptance criteria
- [x] Locate existing implementation (approveMessage TODO at routes/v1/conversations/index.ts:931,
      channel-delivery.service.ts handleOutboundMessage, websocket.service.ts message_received)
- [x] `conversationEventsService.broadcastMessageReceived(conversation, message)`; use it from
      `Conversation.addMessage`
- [x] `message-approval.service.ts` (approve / block) — router becomes a thin wrapper
- [x] Jest: message-approval.service.test.ts (publish order, edited content, block, guards)
- [x] Playwright: tests/message-approval.spec.ts (seed queued msg → Approve & Send → badge gone, DB sent)
- [x] Docs submodule: conversations.md + agents.md (all channels, 24 h window)
- [x] Verify: typecheck, lint, server jest, playwright chromium
- [x] Reviewer agent on `git diff master...HEAD`; address findings (commit c64fe65)
- [x] WIP.md, lessons, push
- [ ] PR against master (no gh CLI on this host; see Results for the compare URL)

## Results

**Changed**

- `server/services/conversation-events.service.ts` — `broadcastMessageReceived`, the single builder of the
  `message_received` payload; Redis-down fallback only pushes released public messages to webchat.
- `server/database/entities/conversation.entity.ts` — `addMessage` delegates to it (inline block removed).
- `server/services/message-approval.service.ts` (new) — approve/block; release is a conditional
  `queued → sent` update (`MessageRepository.transitionDeliveryState`), then `message_received`
  (so channel-delivery posts `/deliver` and webchat gets the socket push) then `message_approved`.
- `server/routes/v1/conversations/index.ts` — approveMessage/blockMessage are thin wrappers; TODO gone.
- Tests: `server/tests/services/message-approval.service.test.ts` (11), `conversation-events.service.test.ts` (5),
  `tests/message-approval.spec.ts` + `tests/helpers/approval-seed.ts`; `tests/helpers/auth.ts` fixed to the real
  persisted-store shape; `playwright.config.ts` honours `PLAYWRIGHT_DASHBOARD_URL`/`PLAYWRIGHT_SERVER_URL`.
- Docs submodule (hay-docs `claude/approval-delivery`, 32844d1): user-guide/conversations.md + agents.md.

**Verified**

- `npx tsc --noEmit` (server) exit 0; `npx eslint` on every changed file exit 0.
- Jest: approval + events + channel-delivery suites 22/22 pass. Full server suite: 2 failures
  (`tests/services/llm-provider.test.ts`, `tests/lib/telemetry.test.ts`) reproduced on master baseline.
- Playwright: `npx playwright test tests/message-approval.spec.ts --project=chromium` → 1 passed (11.2 s),
  run inside `mcr.microsoft.com/playwright:v1.57.0-noble --network host` against an isolated compose stack
  (project `hay-approval`, dashboard :3300, API :3301) because host Chromium lacks system libs.
- Independent reviewer agent: 9 findings, all addressed in c64fe65.

**hay-website lines to update once this ships** (`/srv/hay/hay-website/src`, not edited here)

- `llms.njk:24,37` — "approved replies only reach webchat" → all channels.
- `compare/intercom-fin.md:133,170,200`; `compare/zendesk-ai.md:155-158`.
- "Human approval of AI replies" rows in `compare/{crisp,tidio-lyro,gorgias,hubspot-breeze,intercom-fin,zendesk-ai,voiceflow,chatwoot}.md`.
- `pricing-machine-readable.njk:39`.
- Website docs copies: `docs/content/user-guide/conversations.md:128-144`, `docs/content/faq.md:110`,
  `docs/content/technical/plugins/channel-registration.md:165,200`, `docs/content/technical/channel-architecture.md:248`.

## Working notes

- `docs/` is the hay-docs submodule; edits need a commit there + pointer bump here.
- Redis is the only transport channel-delivery listens on; keep the direct-WS fallback for webchat only.
- Dashboard dedupes `message` events by id ([id].vue:1820) so a second `message_received` for the
  same id just updates it in place.
