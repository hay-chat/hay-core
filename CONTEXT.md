# CONTEXT

**Current Task**: Mobile/attention-first Home + Web Push on branch claude/mobile-attention (worktree .claude/worktrees/mobile-attention); all verification green, PR being opened.

**Key Decisions**
- Push hook lives in conversationRepository.update/updateById (real previous→new status compare, fire-and-forget), not in the WS broadcaster.
- Home reads one SQL procedure `conversations.attention` (pending-human + human-took-over); metrics dashboard moved to /dashboard.
- Playwright specs seed with `pg` + SQL (TypeORM decorators don't load under Playwright); e2e storage keys are plain store ids.

**Next Steps**
- Merge PR + hay-docs branch claude/mobile-attention; set VAPID_* in prod env (`npx web-push generate-vapid-keys`).
- Tear down hay-e2e-pg/redis/pw containers and the 3100/3101 dev servers.
- Follow-ups: PWA icons (maskable set), notification preferences per user.
