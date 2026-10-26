# CONTEXT

**Current Task**: Inbound email channel — strategy written (exploration, no code). See `tasks/email-channel-strategy-2026-10-26.md`.

**Key Decisions** (proposed defaults, not yet confirmed by Roger)
- Stay on Resend: receiving on `inbound.hay.chat`, merchants forward support@ to `<org>@inbound.hay.chat` first; custom-domain sending (Resend multi-tenant Option A) in phase 2; Gmail/M365 APIs only on demand (CASA cost).
- Threading: Reply-To token → In-Reply-To/References → subject heuristic; new plugin `email-channel`, existing `plugins/core/email` tool untouched.
- Core needs: svix webhook signature format, routeKey transform, `messages.receive` honours externalConversationId, send-email passthrough + honest failures.

**Next Steps**
- Roger confirms §7 defaults in the strategy doc.
- Phase 0 spike: enable Resend receiving, dump headers of a Gmail-forwarded mail, check Message-ID control via SMTP vs API.
- Then plan Phase 1 in a `claude/email-channel` worktree.
