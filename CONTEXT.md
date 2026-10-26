# Context

**Current Task**: Merge-gate session: all five fact-fix branches (approval-delivery, mobile-attention, commerce-semantic-actions, email-channel, billing-usage-limits) plus the Inbox routing follow-up and the three fix branches (wait-time units, manage-page middleware, SDK register tests) are merged to master and deployed to eu.hay.chat; hay-docs main carries the docs.

**Key Decisions**:

- Merge straight to master (no PRs), deploy with `/srv/hay-core/deploy.sh`, verify live in Chrome; migrations run manually with `cd server && npm run migration:run`.
- `/` redirects by viewport: phones → `/inbox` (attention list), desktops → `/dashboard`; the sidebar entry is "Inbox".
- The agent-pause migration keeps class/name/DB row at 1784500000000 (same timestamp as push_subscriptions; both applied).

**Next Steps**:

- Set prod env: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT (push alerts), RESEND_API_KEY/RESEND_WEBHOOK_SECRET/EMAIL_INBOUND_DOMAIN (email channel); then the backoffice side of billing (claude/overage-billing → claude/billing-currencies-usage-alerts, stripe:sync, migrations).
- Dashboard still has no `test` script/vitest config (run `npx vitest run` from `dashboard/`); server `PluginMetadata` lacks the `pages` field the SDK emits.
- Website copy fixes listed in each branch's `tasks/todo.md` (`git show origin/claude/<branch>:tasks/todo.md`).
