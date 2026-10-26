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
- [ ] `conversationEventsService.broadcastMessageReceived(conversation, message)`; use it from
      `Conversation.addMessage`
- [ ] `message-approval.service.ts` (approve / block) — router becomes a thin wrapper
- [ ] Jest: message-approval.service.test.ts (publish order, edited content, block, guards)
- [ ] Playwright: tests/message-approval.spec.ts (seed queued msg → Approve & Send → badge gone, DB sent)
- [ ] Docs submodule: conversations.md + agents.md (all channels, 24 h window)
- [ ] Verify: typecheck, lint, server jest, playwright chromium
- [ ] Reviewer agent on `git diff master...HEAD`; address findings
- [ ] WIP.md, lessons, push, PR (list website lines)

## Working notes

- `docs/` is the hay-docs submodule; edits need a commit there + pointer bump here.
- Redis is the only transport channel-delivery listens on; keep the direct-WS fallback for webchat only.
- Dashboard dedupes `message` events by id ([id].vue:1820) so a second `message_received` for the
  same id just updates it in place.
