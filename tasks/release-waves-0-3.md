# Release runbook: VOC Waves 0–3 + Wave 4 lanes (staging → prod)

Scope: everything in `master..staging` on hay-core (PR #104, tags `wave-0-done` … `wave-3-done`,
then the Wave 4 lane merges A, B, C, D, E+F, G, H; Lane I if merged before deploy) plus the
satellite repos below. Written from the repos only; nothing in prod was read. Steps marked
**Roger to confirm** depend on `/srv/hay-core/deploy.sh`, which this runbook does not know.

## 0. Before deploy (no prod changes yet)

- [ ] PR #104 (`staging → master`) green and approved. Lane I (`claude/w4-i-tooling`) merged into
      staging first if it is in this release (email template fix, CI change; no migrations).
- [ ] Database backup of the prod DB (DigitalOcean managed DB): take an on-demand backup or note
      the latest automatic one. One migration cannot be reverted (see §7).
- [ ] Infisical prod has the env vars in §3 (`~/bin/infisical-env.py check`). Names only below.
- [ ] Satellite PRs reviewed (§5). hay-backoffice must NOT deploy before hay-core.
- [ ] Announce a short maintenance window: refresh-token rotation ships (D11-3). Old refresh
      tokens are accepted once and turned into a session, so users should stay logged in, but
      expect a few re-logins.

## 1. Deploy hay-core

1. Merge PR #104 into `master`.
2. **Roger to confirm** — run `/srv/hay-core/deploy.sh` on `homeserver`. Check that it:
   - pulls `master` and runs `npm ci` at the root (new deps: `sharp` (native), `compression`,
     `file-type` in server; new plugin SDK subpath exports);
   - builds the plugin SDK **before** the plugins (`npm run build:server` does
     `build:plugin-sdk → build:webchat → server build`, and the server build runs
     `scripts/build-plugins.sh`);
   - builds the webchat loader too (`webchat` build is now `vite build && vite build -c vite.loader.config.ts`);
   - copies `server/assets` into `dist` (`copy:templates` now copies `assets/`, used by the
     evidence PDF fonts);
   - runs migrations before the new server starts (§2);
   - builds the dashboard (`npm run build:dashboard`).
3. Plugin build gotchas (`scripts/build-plugins.sh`):
   - it only runs `npm install` in a plugin (or its `mcp/`) when `node_modules` is missing, and
     a failed plugin build prints "skipping" and the script still ends with "All plugins built
     successfully". Grep the deploy log for `skipping` / `failed`.
   - New core plugins that must build: `turnstile`, `mercadopago` (+ `mcp/`), `messenger`,
     `nuvemshop` (+ `mcp/`). Changed: shopify, woocommerce, stripe, wix, magento, klaviyo,
     email-channel, whatsapp, instagram, zendesk, chatwoot, calcom, atlassian, notion, twenty.
   - `plugins/core/email` was deleted (merged into Email inbox). If the host keeps old files
     (no clean checkout), remove `plugins/core/email/` so the plugin loader doesn't find a stale
     `dist/`. **Roger to confirm** how deploy.sh checks out.
4. Restart the stack and watch the server log for the plugin registry loading every plugin.

## 2. Migrations (hay-core, in order)

`git diff --name-status master..staging -- server/database/migrations`: 38 new, all additions.
All have run on `hay_staging`. TypeORM runs them in timestamp order:

| #   | Migration                                          | Note                                               |
| --- | -------------------------------------------------- | -------------------------------------------------- |
| 1   | 1784600000000-AddConversationHandedOffAt           |                                                    |
| 2   | 1784700000000-AddRefreshTokenRotationToSessions    | reshapes the unused `sessions` table               |
| 3   | 1784800000000-DropWebchatSubtitleDefault           | clears rows still holding the old default subtitle |
| 4   | 1784900000000-AddLegacyRefreshTokenHashToSessions  |                                                    |
| 5   | 1785100000000-AddConversationOutcomes              |                                                    |
| 6   | 1785300000000-MergeEmailPluginIntoEmailInbox       | **data migration, irreversible**                   |
| 7   | 1785470000000-AddConversationReplyWindow           |                                                    |
| 8   | 1785600000000-PushPerUserAndNotificationDeliveries |                                                    |
| 9   | 1785710000000-AddActionLog                         |                                                    |
| 10  | 1785720000000-AddPendingActions                    |                                                    |
| 11  | 1785730000000-AddAwaitingApprovalStatus            |                                                    |
| 12  | 1785740000000-AddBusinessHoursSchedules            |                                                    |
| 13  | 1785744000000-AddPlaybookApprovalCategories        |                                                    |
| 14  | 1785750000000-AddResolutionExclusions              |                                                    |
| 15  | 1785752000000-AddUploadConversationLinks           |                                                    |
| 16  | 1785762000000-AddOrderConversationLinks            | backfill script in §4                              |
| 17  | 1785771000000-AddUploadScanStatus                  |                                                    |
| 18  | 1785780000000-AddEmailSendingDomains               |                                                    |
| 19  | 1785781000000-AddPluginInstanceChannelHealth       |                                                    |
| 20  | 1785782000000-AddCustomerMergeDismissals           |                                                    |
| 21  | 1785783300000-AddWebchatSpamSettings               |                                                    |
| 22  | 1785783400000-AddWebchatUnderAttack                |                                                    |
| 23  | 1785795000000-AddOrganizationAiPause               |                                                    |
| 24  | 1785796000000-AddUserAlertPreviewPrivacy           |                                                    |
| 25  | 1785810000000-AddInsightIssueFeedbackAndEmbeddings |                                                    |
| 26  | 1785811000000-AddInsightRuns                       |                                                    |
| 27  | 1785830000000-AddSimulationRuns                    |                                                    |
| 28  | 1785831000000-AddTestTranscripts                   |                                                    |
| 29  | 1785840000000-AddInsightClusters                   |                                                    |
| 30  | 1785850000000-AddSimulationItemExpectations        |                                                    |
| 31  | 1785851000000-AddSimulationItemVerdicts            |                                                    |
| 32  | 1785852000000-AddTestCases                         |                                                    |
| 33  | 1785860000000-AddDisputes                          |                                                    |
| 34  | 1785870000000-AddWebchatIdentitySecret             |                                                    |
| 35  | 1785880000000-AddOrganizationBillingPeriod         |                                                    |
| 36  | 1785881000000-AddResolutionExclusionReview         |                                                    |
| 37  | 1785895000000-AddOperatorEvents                    |                                                    |
| 38  | 1785910000000-AddPluginStates                      |                                                    |

Run: `cd server && npm run migration:show` (expect 38 pending) → `npm run migration:run` →
`npm run migration:show` (none pending). **Roger to confirm** whether deploy.sh already runs
`migration:run` (or `migration:ensure`) and inside which container.

## 3. Env vars (names only)

hay-core, set in Infisical prod before deploy:

- New, needed for shipped features:
  - `OPERATOR_EVENTS_URL` — `https://<backoffice host>/webhooks/hay-core` (signed with `INTERNAL_API_SECRET`)
  - `RESEND_API_KEY`, `RESEND_EVENTS_WEBHOOK_SECRET` (custom sending domains, bounce/complaint webhook)
  - `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` (real keys; add the API domain to the widget hostnames)
- Already in `.env.example` on master, must be set for these features: `INTERNAL_API_SECRET`
  (equal to backoffice's), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
- Changed value: `SMTP_FROM_NAME` (now `Hay.chat` in `.env.example`).
- Removed: `JWT_REFRESH_EXPIRES_IN` (no longer read; delete it from prod).
- Optional (defaults in code or feature stays off): `OPENAI_VISION_MODEL`, `OPENAI_BASE_URL`,
  `OPENAI_EU_BASE_URL`, `OPENAI_EU_API_KEY`, `OPENAI_EU_TIER_HARD`, `OPENAI_EU_TIER_MEDIUM`,
  `OPENAI_EU_TIER_EASY`, `INSIGHTS_MIN_CLUSTER_SIZE`, `INSIGHTS_JOIN_THRESHOLD`,
  `INSIGHTS_MERGE_THRESHOLD`, `INSIGHTS_WINDOW_DAYS`, `UPLOAD_MAX_SIZE_MB`,
  `CONVERSATION_MEDIA_MAX_SIZE_MB`, `CLAMAV_HOST`, `CLAMAV_PORT`,
  `UNDER_ATTACK_CREATE_THRESHOLD`, `UNDER_ATTACK_HOURS`.
- Plugin OAuth apps (unset = the plugin page says connecting is unavailable):
  `MERCADOPAGO_CLIENT_ID`, `MERCADOPAGO_CLIENT_SECRET`, `META_MESSENGER_APP_ID`,
  `META_MESSENGER_APP_SECRET`.

hay-backoffice (from `claude/w2-billing-x`, PR #7): `ANNUAL_EARLY_TERMINATION_FEE_ENABLED`
(off by default), `LOGIN_URL`; `INTERNAL_API_SECRET` must equal hay-core's.

## 4. After hay-core is up

- [ ] `cd server && npm run plugins:enable-defaults` — gives existing orgs the default-enabled
      plugins (Turnstile). Safe to re-run. Needs the built turnstile plugin on disk. `tsx` is a
      server dependency, so it runs in the prod image. **Roger to confirm** the container/path.
- [ ] `npm run order-links:backfill` — indexes orders named in old messages (D2-4). Safe to re-run.
- [ ] `npm run insights:backfill-feedback` — insight issues for old ratings (D3-9). One cheap LLM
      call per rating, rate-limited by the job. Safe to re-run.
- [ ] Resend webhook: point email.bounced / email.complained / email.delivered at
      `https://<api>/v1/webhooks/email-events`.
- [ ] D8 media-private switch: Claude does it after deploy, with Roger's go-ahead.

## 5. Satellite repos (after hay-core)

| Repo            | What                                                                  | State (2026-10-28)                                                                                                                 | Order                                 |
| --------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| hay-backoffice  | PR #7 `claude/w2-billing-x` (D15-7..11)                               | open, base `claude/w1-billing-notices` (already merged → retarget to `main`); migration 1785600000000-AddPlanChangeAndCancellation | 1st                                   |
| hay-backoffice  | `claude/w4-a-billing` (A1–A4)                                         | local only, no PR; branched from `main`, not from #7; migration 1785700000000-AddCreditedOverage                                   | 2nd                                   |
| hay-backoffice  | `claude/w4-g-plan-email` (G2)                                         | local only, no PR; from `main`; conflicts with #7 in `src/services/stripe-webhook-handler.ts` (+ test)                             | 3rd                                   |
| hay-website     | PR #46 `claude/w2-x-copy` (+ `claude/w4-i-shopify-h3` on top)         | open, CONFLICTING with main                                                                                                        | any time                              |
| hay-website     | PR #47 `claude/w3-perf-page` (D12-10)                                 | open                                                                                                                               | any time                              |
| hay-website     | `claude/w4-i-home-perf` (homepage FCP/LCP)                            | local only                                                                                                                         | any time                              |
| hay-shopify-app | PR #1 `claude/d12-2-embed-no-css` (D12-2)                             | open, mergeable                                                                                                                    | any time                              |
| hay-shopify-app | `claude/w4-i-shopify-scopes` (`write_order_edits`, `write_discounts`) | local only                                                                                                                         | after hay-core (merchants re-consent) |

- hay-backoffice deploys **after** hay-core: it sends the billing period (A1) and reads the new
  exclusion review API, and hay-core's operator events need the `/webhooks/hay-core` endpoint.
- The three backoffice branches touch the same files (`.env.example`, `WIP.md`, and #7 vs G2
  the Stripe webhook handler). Merge #7 first, then rebase w4-a and w4-g on `main`.
- Backoffice migrations run on its own DB (DO App Platform), in timestamp order.
- hay-shopify-app scopes ship with `shopify app deploy`; existing merchants are asked to
  re-consent. The 3 dispute scopes come later (step 2), after Shopify approves them.

## 6. Hand-test after deploy

- [ ] Login, refresh, logout; an old browser session refreshes once without a forced re-login.
- [ ] Webchat on hay.chat: widget loads, AI label shows, Turnstile challenge appears only when
      expected; a conversation reaches the inbox.
- [ ] Hand-off to a human: email/push alert arrives (and shows its details: Lane I fix).
- [ ] Email inbox: inbound email → conversation; reply goes out from the right From name;
      team email via `send-email` still works for orgs that had the old Email plugin.
- [ ] Settings → Actions: a destructive action is held for approval; approve runs it, it shows
      in the Action log.
- [ ] Settings → Usage: resolution ledger loads; exclusions can be requested.
- [ ] Business hours: outside hours, the widget shows the away state and email capture.
- [ ] Insights page loads; a thumbs-down creates a user-feedback issue.
- [ ] Simulations: run a small test set on a playbook draft.
- [ ] Shopify / Woo / Nuvemshop / Stripe / Mercado Pago plugin pages load and connect (no
      "build failed"); one order lookup in a test store.
- [ ] Customer photo upload in the widget shows in the inbox (scan status if ClamAV is set).
- [ ] Backoffice (after its deploy): plan change email; usage run sends the billing period;
      deleting a test workspace cancels its Stripe test subscription (operator event).

## 7. Rollback

- Code: redeploy the previous `master` commit (note its SHA before step 1). **Roger to confirm**
  how deploy.sh pins a commit.
- Schema: the new tables/columns are additive, so the old code runs against the new schema in
  most cases. Prefer leaving the schema in place. If a revert is needed, `npm run
migration:revert` undoes one migration at a time, newest first.
- **Not reversible**: `MergeEmailPluginIntoEmailInbox` (old `hay-plugin-email` instances were
  merged into/moved to Email inbox and its registry row deleted). `DropWebchatSubtitleDefault`
  clears the old default subtitle text. Restore from the pre-deploy backup if these must be undone.
- Sessions: reverting `AddRefreshTokenRotationToSessions` drops the new session rows → everyone
  logs in again.
- Plugins enabled by `plugins:enable-defaults` stay enabled; owners can switch them off.
- hay-backoffice: roll back to its previous deployment in DO App Platform; its new migrations
  are additive.
