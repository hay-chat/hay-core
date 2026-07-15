# WIP

## 2026-07-15 — prod ops — Shopify OAuth fixed on eu.hay.chat (no code change)

Root cause: /etc/hay/infisical-credentials was root:600, deploy.sh:130 silently
skipped Infisical export since Mar 27 → SHOPIFY*OAUTH*_ (+META\__, POSTHOG\_\*,
OAUTH_REDIRECT_URI) never reached /opt/hay/.env → oauthConfigured=false → no
Connect button. Fixed: chmod 640 root:hay on creds, fresh export installed
(backup at /opt/hay/.env.bak-20260715), hay-server restarted, health green.
Next: make deploy.sh warn/fail on unreadable creds file; set dedicated
PLUGIN_ENCRYPTION_KEY in Infisical; Roger to click Connect + verify tools load.

## 2026-07-14 — master — PostHog telemetry SHIPPED (no PR — see warning)

Opt-in PostHog on dashboard: POSTHOG_KEY (build-time) + POSTHOG_HOST (proxy OK,
ui_host hardcoded eu.posthog.com) in posthog.client.ts; unset key = no-op.
On master as 1bd1ff7 + 44a4f68. Worktree, feature branch, and old research
branch all deleted. WARNING: something on this machine auto-pushed both
commits to origin/master ~15s after each commit (actor rgrjnr, from the
worktree, HEAD:master) — bypasses PR flow entirely; not a git hook/cron.
Next: find the auto-pusher; smoke-test telemetry with a real phc key.

## 2026-07-14 — master — org deletion FK fix (uncommitted)

Org delete failed: documents FK lacked ON DELETE CASCADE (route comment promised
cascades never added). Fixed 6 entities (documents/api_keys/jobs/plugin_instances/
privacy_requests → CASCADE; users.organization_id → SET NULL) + hand-written
migration 1784050841643-FixOrganizationFkCascades (drops FKs by lookup — api_keys
had 2 dupes). Migration run locally, cascade verified via psql, typecheck passes.
NOTE: local DB has drifted heavily from entities (migration:generate diff is huge,
wants to drop pgvector cols) — needs a separate reconciliation pass someday.
Next: commit + PR.

## 2026-07-14 — hay-docs claude/major-rewrites — docs pipeline cleaned + rewrites shipped

Closed stale hay-docs audit PRs #1/#2/#4 (superseded by merged #5). Then ultracode
workflow rewrote all 9 MAJOR_REWRITE docs (5 plugin docs → real defineHayPlugin SDK,
orchestrator → 3-layer RabbitMQ, analytics/settings → real features only).
~630 claims adversarially verified against hay-core, 34 residual errors fixed.
Shipped as hay-docs PR #6 (net −2,494 lines). Next step: human skim + merge PR #6;
docs submodule in hay-core still points at old main (bump after merge).

## 2026-07-14 — master — branch cleanup + PR tracking

Pruned 64 branches → 8 on origin: deleted all merged/squash-merged/superseded
(incl. HAY-239 Instagram, merged via PR #56; wix worktree removed). Local master
fast-forwarded 13 commits. Every surviving work branch now has a tracking PR:
#52 CSAT, #57 Salesforce, #58 Spacebring, #61 forms, #62 email channel,
#63 metering design doc, #64 telemetry research doc — each with status + next steps.
All 7 branches rebased onto master (0 behind) + force-pushed; form/email-channel
conflicts resolved semantically, typecheck clean. Staging auto-sync workflow: PR #65.
Next step: triage those 7 PRs (merge the two doc-only ones, decide roadmap on the rest).
Uncommitted on master: CLAUDE.md edit + docs submodule bump (pre-existing, untouched).
