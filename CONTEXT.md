# Context

**Current Task**: Merge-gate session: fact-fix branches, three follow-up fixes, prod env keys, backoffice billing/Snov.io/admin-controls and the email-channel boot fixes are all merged and deployed; the email inbox end-to-end test waits on Resend receiving + MX for inbound.hay.chat.

**Key Decisions**:

- Merge straight to master (no PRs), deploy with `/srv/hay-core/deploy.sh`, verify live in Chrome; migrations run manually with `cd server && npm run migration:run`.
- `/` redirects by viewport: phones → `/inbox` (attention list), desktops → `/dashboard`; the sidebar entry is "Inbox".
- The agent-pause migration keeps class/name/DB row at 1784500000000 (same timestamp as push_subscriptions; both applied).

**Next Steps**:

- Done 2026-10-26: VAPID_*/RESEND_*/EMAIL_INBOUND_DOMAIN live in prod (deploy.sh --env-only); backoffice billing branches merged, migrated, Stripe live catalog synced, deployed (see /srv/hay/WIP.md).
- Dashboard still has no `test` script/vitest config (run `npx vitest run` from `dashboard/`); server `PluginMetadata` lacks the `pages` field the SDK emits.
- Email inbox live test: Roger enables receiving on inbound.hay.chat in Resend, publishes the MX in Cloudflare, creates the email.received webhook to /v1/plugins/hay-channel-email/webhook, then `deploy.sh --env-only`, save support address, send a test mail. Website copy fixes still in each branch's `tasks/todo.md`.
