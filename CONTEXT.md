# CONTEXT

**Current Task**: Approval-mode delivery on every channel (branch claude/approval-delivery, worktree .claude/worktrees/claude+approval-delivery); code, tests, docs done and pushed; PR against master still to be opened.

**Key Decisions**

- Approval republishes `message_received` (deliveryState sent) via the shared `conversationEventsService.broadcastMessageReceived`, so channel-delivery and webchat need no new event type.
- Release is a conditional `queued → sent` update (`MessageRepository.transitionDeliveryState`); concurrent approvals fail with BAD_REQUEST instead of double-sending.
- Playwright runs in the `mcr.microsoft.com/playwright:v1.57.0-noble` image with `--network host` (host Chromium lacks libs); DB helpers load through `tsx/cjs/api` register.

**Next Steps**

- Open PR (no gh CLI here): https://github.com/hay-chat/hay-core/compare/master...claude/approval-delivery — body in tasks/todo.md Results.
- Merge hay-docs `claude/approval-delivery` first, then this PR; deploy.
- Update the hay-website lines listed in tasks/todo.md Results.
