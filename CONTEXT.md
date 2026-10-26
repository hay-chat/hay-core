# Context

**Current Task**: Merge-gate session: everything merged and deployed; the Email inbox channel is verified end to end in prod (inbound via Resend webhook, agent reply delivered by email after the worker-token fix).

**Key Decisions**:

- Merge straight to master (no PRs), deploy with `/srv/hay-core/deploy.sh`, verify live in Chrome; migrations run manually with `cd server && npm run migration:run`.
- `/` redirects by viewport: phones → `/inbox` (attention list), desktops → `/dashboard`; the sidebar entry is "Inbox".
- The agent-pause migration keeps class/name/DB row at 1784500000000 (same timestamp as push_subscriptions; both applied).

**Next Steps**:

- Done 2026-10-26: VAPID_*/RESEND_*/EMAIL_INBOUND_DOMAIN live in prod (deploy.sh --env-only); backoffice billing branches merged, migrated, Stripe live catalog synced, deployed (see /srv/hay/WIP.md).
- Dashboard still has no `test` script/vitest config (run `npx vitest run` from `dashboard/`); server `PluginMetadata` lacks the `pages` field the SDK emits.
- Email inbox: Roger confirms the reply arrived in his mailbox; then set up real Gmail forwarding. Observed: empty-body mail passes the signature to the agent; legacy "Failed to decrypt credential" warnings on delivery; atlassian/notion router.cjs fail to load in the image. Website copy fixes still in each branch's `tasks/todo.md`.
