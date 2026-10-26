# CONTEXT

**Current Task**: Inbound email channel — Phase 1 built on branch `claude/email-channel` (worktree `.claude/worktrees/claude+email-channel`), pushed; PR not yet opened (no `gh` here). PR body: scratchpad `pr-body-email-channel.md`; compare URL https://github.com/hay-chat/hay-core/compare/master...claude/email-channel?expand=1

**Key Decisions**
- Resend receiving + forwarding to per-org alias `in-<10hex>@EMAIL_INBOUND_DOMAIN`; route only on the alias (typed support address never routes mail).
- Threading: Reply-To token → References root → new thread; `messages.receive` binds both hints to the customer; stored root never overwritten.
- Docs guide on hay-docs branch `claude/email-channel` (d953f8b), submodule pointer bumped on the branch.

**Next Steps**
- Roger: open PR from the compare URL (body in scratchpad), provide a Resend API key for the Phase 0 spike.
- After merge: set RESEND_API_KEY / RESEND_WEBHOOK_SECRET / EMAIL_INBOUND_DOMAIN in prod, run spike (alias in `data.to`? Message-ID honoured?).
- Run Playwright `tests/email-channel-setup.spec.ts` against a dev server; Phase 2: custom-domain sending, idle auto-resolve.
