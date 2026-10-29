## 2026-10-29 — master — Hay deploy mapped, off Coolify, auto-redeploy in cron
- /srv/hay/DEPLOYMENT.md documents every Hay service (core, backoffice, website, shopify, infra, edge).
- hay.chat moved from Coolify into /srv/hay/compose.yml (hay-website). Coolify app deleted.
- /srv/hay/redeploy-check.sh runs from cron every 5 min. It compares the deployed SHA with origin and runs each service's deploy path. It never runs hay-core migrations.
- First run deployed backoffice b68e4ea4 (Shopify pricing, migrated on boot) and shopify 7c7338ed.
- hay CLI merged to master, tools/hay-cli, verified on prod. Test org "Hay CLI Test", user roger+cli@hay.chat (email not yet verified); default account roger+demo@hay.chat via tools/hay-cli/.env (Roger fills HAY_PASSWORD).
- Done: Coolify app deleted, apps.hay.chat added to cloudflare-ddns. Agent moving /srv/hay ops into hay-chat/hay-infra.

## 2026-10-29 — Wave 4 phase 1 live; Nuvemshop partner OAuth verified (bottom-up session)

- master 49d88e11 deployed: D18 Nuvemshop OAuth, D19 quick check (migration AddTeamQuestions1785930000000 ran), D20 plugin setup page. NUVEMSHOP_OAUTH_* set in Infisical prod.
- Org "Nuvemshop Demo" connected to demo store lojadoarogerjunior (app 49319): storeId + user_id saved, 18 tools, sync 0 (empty store).
- Also today: Spanish/widget locale fixes, PWA input zoom / auth margin / chat bubble width fixes, WP plugin 1.0.1 release check.
- Half-done: iPhone push test (needs Roger's phone); Nuvemshop tool reads on real data, LGPD HMAC, post-connect redirect to Marketplace; Dados de publicação.
- Next: see `tasks/voc-roadmap.md` "Resume here" top entry.

## 2026-10-29 — Shopify App Pricing merged to main in all repos

- hay-shopify-app main 3cf0823 LIVE on homeserver (/srv/hay-shopify rebuilt, smoke OK). `shopify app deploy` NOT done (device login expires; Roger runs it in his own terminal) → scopes read_all_orders + read_shopify_payments_disputes pending.
- hay-backoffice main b68e4ea pushed, NOT deployed (auto-mode blocked prod deploy): /srv/hay → git -C hay-backoffice pull; docker compose build hay-backoffice; up -d. Migration AddShopifyBillingProvider1785900000000 runs on boot (additive, safe).
- hay-website main c55d603 pushed; Coolify auto-deploy was building.
- Env NOT on servers: Shopify keys aren't in hay-core Infisical; /srv/hay/.env.backoffice has no SHOPIFY_* and /srv/hay-shopify/.env has no HAY_BACKOFFICE_URL or SHOPIFY_APP_SHARED_SECRET. Until set, gate fails open (safe).
- Next: Roger: app deploy + backoffice deploy + env vars; test on haychat-2; then Enable App Pricing + resubmit after 10-31.

## 2026-10-29 — claude/hay-cli (worktree claude+hay-cli, not pushed) — hay CLI

- Works on prod: `tools/hay-cli/bin/hay chat send "<msg>" --logs`, `conv list|show`, `logs <id|--since>`, `orgs`/`use`, `plugins list|tools|test`, `--json` everywhere. Plan/results: tasks/hay-cli.md.
- Test account roger+cli@hay.chat / org "Hay CLI Test" (6e09a8b0-…); tokens in ~/.config/hay-cli/config.json. Email unverified → `hay login` fails until the link is clicked; refresh token keeps it alive.
- Server: log context so every orchestrator-run line carries conversationId (lib/logger + worker). Needs deploy for retrieval/tool lines.
- Missing: `plugins call` (no server endpoint). Next: review + merge, deploy, then `hay logs <id>` shows retrieval lines.
## 2026-10-29 — Shopify App Pricing: both branches done, contract checked

- hay-backoffice claude/shopify-app-pricing (worktree hay-backoffice-shopify-pricing, 5 commits, 380 tests pass): provider column + migration 1785900000000 (runs on boot), Partner API sync, hourly reconcile, usage outbox → app, 409 on Stripe routes for Shopify orgs.
- hay-shopify-app claude/shopify-app-pricing @ 85a9303 (5 commits): gate, /welcome, Change plan, /internal/app-events (422 = permanent, matches backoffice retry rules).
- Neither pushed. Env: backoffice SHOPIFY_PARTNER_ORG_ID/TOKEN, SHOPIFY_APP_GID, SHOPIFY_APP_SHARED_SECRET, SHOPIFY_APP_URL; app HAY_BACKOFFICE_URL + SHOPIFY_APP_SHARED_SECRET (same name both sides) (same secret).
- Next: Roger saves Partner API client; hay-website billing.js hides Stripe UI when provider=shopify; test on haychat-2.

## 2026-10-29 — Shopify App Pricing: drafts done, code on branches

- Partner Dashboard: 4 App Pricing DRAFT plans saved (solo $55/500, starter $149/2k, growth $799/20k, enterprise $2,999/100k; meter `resolution` graduated, overage $0.27/.22/.16/.11; trial 30d; redirect /welcome). "Enable Shopify App Pricing" NOT clicked.
- Partner API client form filled ("hay-backoffice billing": Ver finanças + Gerenciar assinaturas de apps + Gerenciar apps) but NOT saved — Roger saves + copies token to Infisical (SHOPIFY_PARTNER_API_TOKEN, ORG_ID=4831019).
- hay-shopify-app branch claude/shopify-app-pricing (4 commits, not pushed): plan gate, /welcome, Change plan, /internal/app-events. Needs HAY_BACKOFFICE_URL + SHOPIFY_APP_SHARED_SECRET (same name both sides).
- hay-backoffice branch claude/shopify-app-pricing (worktree hay-backoffice-shopify-pricing): agent still building.
- Next: review both branches, hay-core dashboard "Billed through Shopify", test on haychat-2, then enable App Pricing + resubmit after 10-31.

## 2026-10-29 — master — committed + Shopify app server redeployed

- hay-core plans/WIP pushed (9e88f12e); hay-wordpress claude/woo-marketplace pushed to main (a8fc229, no release → no WP.org deploy).
- apps.hay.chat rebuilt on homeserver at e5992a4, smoke 5/5. `shopify app deploy` NOT done: CLI needs Roger's device login.
- 2.1.1 fix (62c1c332) is in hay-core master but hay-core prod not redeployed yet (/srv/hay-core/deploy.sh).
- docs submodule left untouched: local checkout is older than the committed pointer.

## 2026-10-29 — master @ 62c1c332 — Shopify 2.1.1 fixed (pushed)

- Reviewer's error = false "Connection Failed: Plugin requires authentication" while "Connected via OAuth": testConnection only read instance.config, ignored authState tokens. Now hasPluginCredentials() checks both (server/lib/plugin-health-tool.ts, tests added).
- Next: deploy, verify on haychat-2 with a fresh account; then Shopify App Pricing (tasks/shopify-app-pricing.md, Roger: plans + Partner API client).

## 2026-10-28 — master (uncommitted) — Shopify resubmission plan

- Plan written: tasks/shopify-app-pricing.md (2.1.1 connect error + 1.2.1 → Shopify App Pricing).
- App Pricing facts verified (pricing_plans URL, App Events meters, Partner API activeSubscription, no webhooks).
- Half-built: nothing coded yet; 2.1.1 root cause unknown (no screencast, no prod logs).
- Next: repro reviewer path on haychat-2 with a fresh Hay account; Roger: create plans + Partner API client.
- Woo work paused (tasks/woo-marketplace.md, hay-wordpress-woo branch unpushed).

## 2026-10-28 — Woo Marketplace started (plan only in hay-core)

- Plan: tasks/woo-marketplace.md (uncommitted on master). Woo SaaS Billing API is mandatory for tiered monthly pricing (USD only, no usage → flat tiers, pause at limit).
- Plugin work: hay-wordpress worktree ../hay-wordpress-woo branch claude/woo-marketplace (2 commits, not pushed).
- Next: Roger applies for Woo vendor account + emails Marketplace team; me: Phase 1 in-WP sign-up/connect.

## 2026-10-28 — master (research only, no code) — Shopify/Woo platform billing

- Shopify review rejected app (1.2.1 off-platform billing, 2.1.1 error on connect). Resubmit after pause ends 2026-10-31.
- Research done: Shopify App Pricing (Partner Dashboard plans + App Events usage meter + Partner API activeSubscription; no webhooks). Woo: WP.org plugin may keep external billing; Woo Marketplace needs Partnership Agreement or SaaS Billing API (USD only, no usage).
- Seam: backoffice owns billing (Stripe-only Subscription entity); core is billing-agnostic via internal setAccessState/setLimits/setBillingPeriod.
- Next: Roger decides scope (Shopify App Pricing now; Woo Marketplace yes/no); reproduce the 2.1.1 connect error from the screencast.

## 2026-10-28 — claude/always-fact-check (worktree, not pushed)

- Stage 2 fact check now runs on every RESPOND, not only when Stage 1 sets requiresFactCheck (incident: "We absolutely do ship to Portugal" with zero docs went out).
- Unflagged replies: one grounding-only LLM call (medium tier); >= mediumThreshold passes, below falls into the full assessment/recheck/escalate path (grounding score reused). Flagged replies unchanged.
- No documents no longer short-circuits grounding to 0: LLM gets an explicit "No documents or tool results were retrieved" placeholder; en/pt/es prompts say claims score 0.0-0.2, claim-free replies 0.9-1.0.
- Next: review, push, deploy; watch handoff rate and reply latency after deploy.

## 2026-10-28 — Meta App Review drafts

- tasks/meta-app-review-messenger.md (1da6b710+): permission texts, reviewer notes, screencast script. Roger: reviewer login, screencast, submit.
- Gap found: Meta deauthorize/data-deletion only reach the WhatsApp plugin, so Messenger connections are not cleared when a user removes the app.

## 2026-10-28 — master 66bf78ec deployed

- Channel messages that arrive when the org has no agent are now kept: stored and parked pending-human, instead of a 500 that Meta eventually drops. Messenger tested end to end on Magenta Terrários once Roger created an agent.
- Next: App Review drafts (pages_messaging, pages_manage_metadata, pages_show_list, Human Agent), then WABA checks.

## 2026-10-28 — master (homeserver) — Stripe live test done, billing fixes shipped

- Live test on "My Store" (roger+demo@hay.chat), sub_1UVbfHL8O3lIr2V8pSy7KSoQ: checkout Solo EUR ✅, upgrade → Starter ✅ (2 emails → fixed backoffice d0bae68), downgrade booked for 28 Nov via schedule ✅ (1 email), overage credit −€2 on next invoice ✅.
- Live portal has plan changes disabled → "applies now" copy is fine. Live billing page was broken since 10-26 (website ecdbb32 fixed). Plugin routers fixed (3ce94dd2, deployed).
- VAT: Stripe automatic tax never enabled, no registrations, prices tax_behavior unspecified. Roger: prices exclusive; Hay registered in Brazil → skip VAT for now (lawyer question). Stripe head office says PT — Roger to check.
- Running (agents): billing page redesign + plan-change dialog + country picker (fallback USD); cancel page with reason step + one-time 50% retention offer.
- Cleanup owed by Roger after retest: cancel the test sub (no proration), delete pending invoice items on cus_VWee4tKoh7CoM2, refund €50.
- Next: retest new billing UI live, then step 4 (Meta).

## 2026-10-28 — master — fix: atlassian/notion routers load in prod

- Root cause: plugin router.cjs bundles keep `@server/*` external (must share the server's tRPC `t`/singletons); tsc-alias only rewrites server/dist, so `node dist/main.js` couldn't resolve `require('@server/trpc')`. tsx/ts-node resolved it, hence CLI worked.
- Fix: server/lib/plugin-router-alias.ts registers `@server/*` → server root via tsconfig-paths (runtime dep) before plugin-manager loads a router. Test: server/tests/lib/plugin-router-alias.test.ts (plain node child process, prod-like layout).
- Verified in hay-core:fix-test image: both routers load (listRoots/discover/fetchPage/listChanges), @server/trpc resolves to /app/server/dist/trpc/index.js.
- Only atlassian + notion declare trpcRouter. Needs full image rebuild: `cd /srv/hay-core && ./deploy.sh`.
- Next: after deploy, `docker compose logs server | grep "Registered router"` should list Atlassian + Notion.

## 2026-10-28 — master (homeserver /srv/hay-core) — prod keys live, backoffice #7 merged

- hay-core prod env from Infisical (`ALLOW_REMOVED=1 ./deploy.sh --env-only`): TURNSTILE_*, OPERATOR_EVENTS_URL, RESEND_EVENTS_WEBHOOK_SECRET set; SMTP_FROM_NAME=Hay.chat; JWT_REFRESH_EXPIRES_IN removed. Health ok.
- Turnstile: plugin already on for all 101 orgs (enable-defaults ran 16:20); challenge frame now 200 with the Cloudflare script.
- No pending core migrations; build log clean. Boot warns: atlassian/notion router `Cannot find module '@server/trpc'`, 11 plugins not_found, legacy decrypt warnings (all pre-existing).
- hay-backoffice main: PR #7 merged (74b3f76, D15-7..11 incl. POST /webhooks/hay-core) + a5015d6 migrations run on boot. Pushed; DO deploy not yet observed.
- Next: confirm backoffice deploy (route answers JSON, not basic-auth 401) + HAY_INTERNAL_API_SECRET on DO; then step 3 Stripe test mode.

## 2026-10-28 — staging — everything PR'd for Roger to merge

- hay-core PR #104 (staging→master) retitled "VOC roadmap Waves 0–4", Wave 4 section + merge order added. MERGEABLE.
- New PRs: hay-backoffice #8 (Lane A) #9 (plan email), hay-website #48 (→ #46 branch) #49 (homepage perf), hay-docs #23, hay-shopify-app #2.
- Backoffice #7 still targets merged claude/w1-billing-notices: retargeting was blocked for me → Roger retargets to main and merges first.
- Release notes draft approved by Roger (https://claude.ai/artifact/Ugfwub6xvdyzrZZMixWqCT).
- Next: Roger merges + deploys (runbook tasks/release-waves-0-3.md, deploy.sh steps to confirm), then prod testing.

## 2026-10-28 — staging — all Wave 4 lanes (A–I) merged

- Lane I merged (179a31b1) + dashboard `test` script (ffa89285). Every lane A–I is on staging and pushed.
- Satellite branches (backoffice ×2, website ×2, docs, shopify-app) committed locally only; list + defaults in tasks/voc-roadmap.md "Still on Roger".
- Not done: dashboard hand-tests of Wave 4; `plugins:enable-defaults` on staging; backoffice migration AddCreditedOverage (no local DB).
- Next: Roger reviews "Still on Roger" + release draft (https://claude.ai/artifact/Ugfwub6xvdyzrZZMixWqCT) + runbook; then open satellite PRs.

## 2026-10-28 — claude/w4-i-tooling (worktree hay-core-w4-i-tooling) — Lane I committed, NOT pushed

- I2 CI: webchat job runs on staging push/PR; quality + server-tests stay master-only. I1 dropped (Lane F did it).
- I3 emails: notification template shows its blocks (pass 1 no longer eats {{#if}}), {{else}}, escaped values, callouts as divs, initialize() before send; 0 MJML warnings; jest 11 suites/89 pass.
- I8 tasks/release-waves-0-3.md: 38 migrations, env names, plugin build gotchas, backoffice order + conflicts, hand-tests, rollback; deploy.sh steps "Roger to confirm".
- Other repos (local only): hay-docs claude/w4-i-email-docs (I4), hay-website claude/w4-i-shopify-h3 (I5, on PR #46), claude/w4-i-home-perf (I6, LH mobile median LCP 6.2 s -> 2.1 s), hay-shopify-app claude/w4-i-shopify-scopes (I7).
- I9 maskable icon: on Roger (designer asset).
- Next: review + merge into staging; push satellite branches/PRs; dashboard has no npm "test" script on staging.

## 2026-10-28 — staging — Lanes E+F and H merged

- claude/w4-ef merged (841f8fd8; dashboard devDeps @vue/test-utils + jsdom, lockfile changed); claude/w4-h-commerce merged (8e5e46e1; migration AddPluginStates on hay_test + hay_staging).
- Full server jest after E+F: 1718 pass, 2 fail (scheduler, conversation-media) that pass alone → shared-DB flakes. Dashboard tc + vitest 68/68. Lane H DB tests 8/8, Woo 128/128, server tsc clean.
- Only Lane I running. Then: release runbook review, satellite PRs (backoffice w4-a, w4-g), hand-tests.

## 2026-10-28 — staging — Lane A merged

- claude/w4-a-billing merged (60730bcf); migrations AddOrganizationBillingPeriod + AddResolutionExclusionReview on hay_test + hay_staging (agent).
- Fixed boundary double count: countBillableResolutions now end-exclusive + regression test (close-classifier 18/18 incl. new).
- Backoffice Lane A and G branches local only (hay-backoffice-w4-a, -w4-g) → PRs needed; deploy core first.
- Running: Lanes E+F, H. Left: Lane I.

## 2026-10-28 — claude/w4-h-commerce (worktree hay-core-w4-h-commerce) — Lane H committed, NOT pushed

- H1 fef3c87e generic `productSource.prune(keepIds)` + pluginApi products.prune; Shopify/Woo/Nuvemshop prune after a complete sync (deletes, not soft-mark).
- H2 c01679b7 Wix + Magento orders carry `supportSummary.tracking` stale flag + per-store threshold config.
- H3 skipped: coupon-per-customer check already paginates past 100.
- H4 768b57e7 generic encrypted plugin state store (plugin_states, migration 1785910000000, run on hay_test + hay_staging) + SDK `globalCtx.state`; Woo wc-auth sessions persist there.
- Next: review + PR; Roger: delete vs mark-deleted on prune, Magento origin country, Wix site-properties scope.

## 2026-10-28 — staging — Lane G merged

- claude/w4-g-exports merged (6d798bc9); migration AddOperatorEvents ran on hay_test + hay_staging (by the agent).
- Integration 38/41 suites pass in the full run while other agents share hay_test; the 3 failing ones (organization-export, insight-backfill, conversation-media) pass when re-run alone → contention flakes.
- Backoffice G2 (plan-change email) local only in hay-backoffice-w4-g. Lane A and E+F agents still running.

## 2026-10-28 — claude/w4-g-exports (worktree hay-core-w4-g-exports) — Lane G committed, NOT pushed

- G1 3a71e7d8 export ZIP includes conversation-media attachments (1.5 GB budget, attachments.jsonl index).
- G3 48af7bf8 operator_events outbox + operator-event-retry cron (1m..24h, 7 attempts) — migration 1785895000000 (run on hay_test + hay_staging).
- G4 4af68968 suspended-workspace holding reply bypasses the drafts-only/test-mode approval gate.
- G5 a45d5057 evidence PDF: Noto Emoji font, SSRF-safe remote attachment fetch (10 MB/20 files), 50-page cap, policy text as used.
- G2 lives in hay-backoffice-w4-g (claude/w4-g-plan-email, 5aadb2d); template is backoffice-only.
- Next: review + PR both branches; Roger: confirm 50-page cap, sendPausedNotice same bypass?

## 2026-10-28 — claude/w4-a-billing (Lane A) + hay-backoffice claude/w4-a-billing

- core: A1 dd18e569 billing period on orgs (usage page + exclusion cap; calendar month fallback), A3 2c172522 internal review API (approve/deny pending_review, audit-logged), A4 b5d7b647 internal.organizations.setLimits.
- backoffice (../hay-backoffice-w4-a): A1 0b69caf period sync, A2 f939948 bill billableResolutions only + Stripe credit (negative invoice item) for post-report exclusions/reversals, A3 0389e5d admin Exclusions page, A4 00a3620 SIMULATION_ALLOWANCE (20 %, max 500).
- Migrations: core 1785880000000 + 1785881000000 run on hay_staging + hay_test. Backoffice 1785700000000-AddCreditedOverage NOT run (no local backoffice DB).
- Not pushed. Decisions for Roger: credit mechanism/tax, 29-31 anchor clamping, staff approvals outside credit window.
- Next: review both branches, run backoffice migration on its DB, merge core into staging before backoffice deploys (backoffice calls new internal procedures).

## 2026-10-28 — claude/w4-ef (worktree hay-core-w4-ef) — Lanes E + F built, not merged

- Commits one per ticket: E1 2859dbfb, F1 9d9b4953, F2 cb22df0b, F3 c394c5b1, F6 36066d8a, F7 4de3f9f2, F8 f7d14ddf, F10 4f530218, F4 52b581cf, F5 59197686, F9 (dashboard component tests + vitest.config). No migrations.
- Verified: server tsc clean; jest 8 suites / 65 pass (media-analysis, gorgias, simulation-harness, feedback-insights, test-transcripts, insights-service, docs-audit-insight, insight-digest on hay_test); dashboard typecheck 0; dashboard vitest 16 files / 68 pass.
- F9 adds dashboard devDeps @vue/test-utils + jsdom (same as webchat) and dashboard/vitest.config.ts (excludes Playwright *.spec.ts).
- F10: Gorgias import now a background job (cap 1000, 429 retry); a server restart leaves the job PROCESSING (TODO in test-transcript.service).
- F4 reading: greeting card + snippet greeting lines hidden when Settings > Web Chat "Enable" is off (not the agent page).
- Not hand-tested in the browser. Next: review + merge claude/w4-ef into staging, `npm install` there (lockfile changed), hand-test Gorgias import + agent page pt-BR.

## 2026-10-28 — staging — Lanes B, C, D merged

- Merged claude/w4-b-approvals (4544ef9d), claude/w4-c-disputes (0232fb97), claude/w4-d-abuse (a0b1a115).
- Migration AddWebchatIdentitySecret run on local hay_staging + hay_test (Docker hay-staging-postgres-1 :5433 started).
- Verified: server tsc clean; full server jest 1678 pass / 1 fail (resolution-ledger exclusions test fails only in the full parallel run, passes alone and in tests/integration 245/245 — flaky shared-DB state).
- Not run: `plugins:enable-defaults` on staging (Turnstile for all orgs); hand-tests in the dashboard.
- Open questions for Roger in tasks/voc-roadmap.md "Still on Roger". Next: Lane A (billing).

## 2026-10-28 — staging — Lane C merged

- claude/w4-c-disputes merged (0232fb97) + Spanish alert auto-submit warning (5683ba48). Unit 15/15, server tsc clean.
- NOT run: tests/integration/disputes.test.ts (Docker hay-staging Postgres down; Docker Desktop not running).
- Rationale doc for Roger: tasks/disputes-rationale.md. Stripe update_dispute ungated → sent to Lane B as B6.
- Next: Lane B and D reports → review, merge; then Lane A.

## 2026-10-28 — staging — Lane R release doc drafted

- Draft release notes (Waves 0–3) published privately: https://claude.ai/artifact/Ugfwub6xvdyzrZZMixWqCT (16 staging clips inline).
- Source: session scratchpad release/release.md + tools/build_release.py (not in repo).
- Turnstile copy already says "on for every workspace" (assumes D2 lands before release).
- Lanes B/C/D agents still running in claude/w4-{b-approvals,c-disputes,d-abuse}; next: review + merge into staging, then Lane A.

## 2026-10-28 — claude/w4-c-disputes (Lane C)

- C1 9c43852a: `matchOrder` only matches orders a plugin knows (text-only mentions never; later refs still tried). C2 6c58f6af: `report` reloads the row after alerting, so `alertedAt` is fresh. C3 47bd40b9: rationale at `tasks/disputes-rationale.md` (docs/ is the public hay-docs submodule).
- Verified: server tsc clean; new DB-free `tests/services/disputes.test.ts` 4/4 + dispute-evidence 11/11. NOT run: `tests/integration/disputes.test.ts` (C1/C2 cases added) — Docker hay-staging Postgres (:5433, hay_test) was down.
- Open for Roger: Stripe MCP `update_dispute` is `other_write` → runs without approval (roadmap says "held"); Spanish alert email lacks the auto-submit warning.
- Next: start the hay-staging Docker env, run the integration suite, then merge claude/w4-c-disputes into staging.

## 2026-10-28 — claude/w4-b-approvals (Lane B)

- Done B1–B6, one commit each: API refuses switching money approval off without `actionApproval.confirmSwitchOff` ("SWITCH OFF APPROVAL", dashboard sends it after the typed word); new `destructive` risk class (SDK + core, hold reason `destructive_write`, not a per-category toggle) for Zendesk deletes/helpdesk config, Twenty delete_record, Cal.com cancel_booking, Stripe update_dispute (B6).
- B3 Shopify cancel defaults refund=true only for unfulfilled + PAID + one gateway, else BAD_INPUT REFUND_CHOICE_REQUIRED. B4 Shopify/Woo/Magento/Wix/Mercado Pago refunds take a required `currency` (mismatch refused). B5 Klaviyo upload_image_from_file removed (URL/data-URI tool stays).
- No migrations. Not covered: Stripe hosted create_refund (no currency arg, amount in cents shown as major units).
- Verified: server tsc + 7 jest suites 82 ✓, dashboard typecheck ✓, SDK 213 ✓, plugins zendesk/twenty/calcom/shopify/woo/magento/wix/mercadopago/klaviyo/stripe ✓.
- Next: orchestrator merges to staging, rebuild plugin-sdk + affected plugins, hand-test the Settings > Actions switch-off and a held Zendesk delete.

## 2026-10-28 — claude/w4-d-abuse — Lane D (abuse) D1–D3 built, not merged

- D1: customerExternalId links only with HMAC-SHA256 signature (per-org secret on webchat_settings.identity_secret, encrypted; reveal/rotate admins-only; dashboard card; widget sends customerExternalIdSignature). Unsigned/invalid -> anonymous.
- D2: `npm run plugins:enable-defaults` enables defaultEnabled plugins (Turnstile) for existing orgs; no plugin id in core.
- D3: vision skip ignores "verification unavailable"; Not spam re-reads held files then hands back to AI; Not spam beats LLM close-classifier spam.
- Half-built: migration 1785870000000-AddWebchatIdentitySecret NOT run (Postgres :5433 down); close-classifier integration test (Not spam undo) NOT run.
- Cross-repo (not done): WordPress/Woo plugin, Shopify theme block, hay-website context-api doc must sign the id server-side.
- Next: start DB, run migration on hay_test + integration suites, then merge to staging and run plugins:enable-defaults after deploy.

## 2026-10-28 — staging — Needs Roger list fully answered

- All 86 items answered (questionnaire artifact); recorded in tasks/voc-roadmap.md: "Roger's answers", "Tickets from Roger's answers" (lanes A–I, all "do it now"), "Still on Roger".
- Nothing built yet. Prod reads (deploy.sh) blocked by classifier → on Roger.
- Next: Roger picks how to run lanes A–I (worktrees claude/<lane>), then build → merge to staging → hand-test.

## 2026-10-28 — staging — Needs Roger interview → questionnaire artifact

- Answered in chat (in tasks/voc-roadmap.md "Roger's answers"): PR #104 = all Waves 0–3; 72 h reversal both outcome types; staff close bills; channelAiModes not breaking; lockfile clean (npm install on clean clone, no diff).
- Remaining ~80 items (blockers, money/safety, copy, defaults, actions, gaps) are in https://claude.ai/artifact/PGDLNwQ2oSg71qpH4vQHKc; answers saved in its db collection `answers` (doc id = item id).
- Next: read answers with ArtifactData list → move each into "Roger's answers" in tasks/voc-roadmap.md, ticket lines for code changes, commit every ~5, then summary.

## 2026-10-28 — staging — Wave 3 closed (tag wave-3-done)

- Review fixes: simulations out of order index/evidence/analytics; dispute attach owners/admins only; https-only provider link; lowercase plugin channel names (runKind spoof); Shopify auto-submit copy; plugin-api suites load again.
- Full suites alone: server 178 suites/1639 ✓, dashboard 61 ✓ (3 pre-existing Playwright specs), webchat 134, sdk 213, all plugins ✓.
- PR #104 body updated for Waves 0–3. Next: Roger's Needs Roger list; Wave 4 (D18–D20) unscheduled.

## 2026-10-28 — staging — W3 L6 widget perf budget merged; all Wave 3 lanes in

- Merged claude/w3-perf (6a1aecdc): webchat check:perf (brotli-5 size budgets + jsdom request budgets), perf:lighthouse, CI webchat job. Verified on merged tree: check:perf passes, vitest 134/134.
- hay-website draft PR #47 (D12-10 page) waits for Roger. D12 research request counts corrected in seo (b01e9da, unpushed).
- Next: Wave 3 close (review agent over wave-2-done..staging, full suites, tag wave-3-done, PR #104).

## 2026-10-28 — staging — W3 L13 chargeback disputes merged, hand-tested

- Merged claude/w3-disputes (60765df4); AddDisputes1785860000000 run on hay_staging; SDK + stripe + shopify rebuilt. tsc/dashboard typecheck clean; jest disputes/evidence/proxy 51/51.
- Hand test: dispute reported via core intake matched Woo order #15, alert recorded; Evidence page Disputes card; Attach as draft confirm → NOT_CONNECTED error shown and stored. Fixed dialog platform name going blank on close (e38e9d2a).
- Guide: seo payment-disputes (16fbcc0, unpushed). Test dispute row dp_handtest_1 left on staging. Running: L6 perf; then Wave 3 close.

## 2026-10-28 08:55 — staging — W3 L5 Mercado Pago merged, hand-tested (no real account)

- Merged claude/w3-brazil-pay (73d722d0); no migrations; plugin-sdk rebuilt; plugin registered after server restart.
- Hand test: plugin page, enable → "Connecting is not available yet" notice (no MP keys on staging). Tests on merged tree: MP 21, Woo 124, SDK payment-provider 8.
- Guide: seo mercado-pago (cf73bb3, unpushed). Running: L13 disputes, L6 perf. Then Wave 3 close.

## 2026-10-28 — claude/w3-perf (L6)

- Done: D12-9 `webchat/scripts/check-perf.mjs` (brotli-q5 budgets loader 10 KB / chat 48 KB / locale 2 KB + jsdom check: 0 requests before interaction in "interaction" mode), new CI job "Webchat Tests & Perf Budget", optional `scripts/perf/lighthouse.mjs`.
- D12-10 in hay-website: /widget-performance/ page, draft PR hay-chat/hay-website#47 (branch claude/w3-perf-page).
- Next: orchestrator merges claude/w3-perf; re-measure Hay.chat in prod after compression + loader deploy, update the page; separate ticket for hay.chat's own 3.8 s FCP.

## 2026-10-28 08:40 — staging — W3 L7b merged, hand-tested

- Merged claude/w3-golive-b (0528417); migrations 1785850000000/1785851000000/1785852000000 on hay_staging. Fix 27c9561 (risky bucket red only when non-empty).
- Hand test: Tests page replay → report (1 same answer, judge reason), Save as test case, readiness card copy (replies only), Start on Web Chat only saved channelAiModes. Test agent deleted + channel modes reset afterwards.
- Guide: seo test-before-go-live (01f7ba5, unpushed). Running: L13 disputes, L5 Mercado Pago. Next: L6, then Wave 3 close.

## 2026-10-28 — claude/w3-golive-b (L7b)

- Done: D7-9 replay runner, D7-10 judge + buckets, D7-11 /tests report (no %), D7-12 test cases + pre-publish warn, D7-13 agent readiness card, D7-14 channel AI "Off" + "Start on Web Chat only" + shared-channel responder rule, D3-17 Insight save-as-test + replay draft (staging merged in, e9e17c8).
- Migrations (hay_test only): AddSimulationItemExpectations1785850000000, AddSimulationItemVerdicts1785851000000, AddTestCases1785852000000. Not pushed.
- API change: organizations.get/updateAiDisclosure use channelAiModes map (draftsChannels removed).
- Gaps: simulation run items not covered by retention; webchat greeting still shows on an "Off" web channel.
- Next: orchestrator review/merge to staging, run the 3 migrations on hay_staging, hand-test.

## 2026-10-28 08:50 — claude/w3-disputes (worktree hay-core-w3-disputes) — W3 L13 chargeback disputes, unmerged

- Commits: 886a022 D2-1 spike (plugins/core/shopify/DISPUTES.md), 2f2e354 SDK `disputes` capability, cce1bd7 core (disputes table, pluginApi disputes.report, owner alert + 48h reminder, Evidence page Disputes card), e393260 Stripe intake + draft (submit=false), fe12072 Shopify intake + attach (never submits).
- Migration AddDisputes1785860000000 (ran on hay_test only). No new env vars. SDK changed: rebuild on staging.
- Verified: server tsc + jest (disputes, proxy) green; SDK 205, Stripe 13, Shopify 88 vitest green; dashboard typecheck 0.
- Half-built: nothing in code. Needs Roger: hay-shopify-app toml dispute scopes (bundle with D6 re-consent), Shopify Payments dev-store test, Stripe test-mode hand test.
- Next: merge into staging, run migration on hay_staging, rebuild SDK + stripe/shopify, hand-test with a Stripe test dispute card.

## 2026-10-28 08:20 — staging — W3 L12b insights merged, hand-tested

- Merged claude/w3-insights-b (8e1e14a); migration AddInsightClusters1785840000000 on hay_staging. Fix c3472cb: EmptyState no longer renders an empty button.
- Hand test: backfill (0 new, correct), min size 5→2 saved, clustering promoted+named 3 positive patterns, detail/evidence/filters, reject+reason in History, reopen; docs audit ran (0 findings); digest once per week. Staging min cluster size left at 2.
- Guide: seo insights/README.md (7edd633, unpushed). Running: L7b. Next: L13 (+ L5 after L7b).

## 2026-10-28 08:00 — staging — W3 L7a test-before-go-live merged, hand-tested

- Merged claude/w3-golive-a with migrations renumbered to 1785830000000/1785831000000 (run on hay_staging).
- Hand test: "Test this draft" playground followed the draft; Compare with active diff works; simulations.start run completed (usage logged); simulation conversation hidden from Inbox; testTranscripts paste import OK.
- Running: L12b. Next: L7b (runs/import UI, D7-9..14, D3-17), migrations 1785850000000+.

## 2026-10-28 — claude/w3-insights-b (L12b)

- Done: D3-12 clustering, D3-13 Insights page, D3-14 approve→executor, D3-15 weekly docs audit, D3-16 recurrence/fixed/archive, D3-18 backfill+tuning, weekly digest.
- Migration AddInsightClusters1785840000000 run on hay_test only. Not pushed.
- Gaps: docs-audit LLM tokens unmetered; digest claims week before send; no dashboard component tests.
- Next: orchestrator review/merge to staging, run migration, hand-test.

## 2026-10-28 07:30 — staging — W3 L12a insights foundations merged, hand-tested

- Merged claude/w3-insights-a (dcb08c8); 2 migrations on hay_staging; feedback backfill run. Fix d5594f6 bracket placeholders.
- Running: L7a. Next: L12b (clustering, Insights page, digest).

## 2026-10-28 — claude/w3-insights-a (L12a)

- Done: D3-6 Knowledge Improve, D3-7 insight schema+embeddings, D3-9 feedback→issues+enrichment+backfill, D3-11 insight_runs ledger + insights.metrics.
- Migrations 1785810000000, 1785811000000 run on hay_test only. Not pushed.
- Gaps: Gemini/Mistral/Grok unpriced (null cost); OpenAI prices unverified.
- Next: Roger review/merge; L12b builds clustering on insight_issue_embeddings.

## 2026-10-28 07:30 — claude/w3-golive-a — W3 L7a test-before-go-live part A built (not merged)

- D7-5 draft override + "Test this draft"; D7-6 version diff (history + publish dialog); D7-7 simulation harness (simulations router, caps in config/simulation-caps.ts); D7-8 testTranscripts router (CSV, paste, WhatsApp, Tidio, Gorgias).
- Migrations 1785810000000 AddSimulationRuns + 1785811000000 AddTestTranscripts run on hay_test only. No new env vars.
- Gaps: no runs/import UI (L7b), Tidio format unverified, orchestrator follow-up runs of a simulation untracked.
- Next: orchestrator merges into staging, runs both migrations on hay_staging, hand-tests.

## 2026-10-28 07:05 — staging — WAVE 2 DONE (tag wave-2-done)

- Suites green; PR #104 updated (Waves 0–2); GIFs sent. Next: Wave 3 batch 1 (L12a insights, L7a go-live).

## 2026-10-28 06:50 — staging — W2 review fixes merged, hand-tested

- Merged claude/w2-review-fixes (a3a4897), no migrations. Manual ✓ #1 Turnstile deny, #2 Mark as spam unbills classified, #3 hand-off email kept on conversation.
- Next: full suites alone, tag wave-2-done, PR #104, Wave 3 lanes.

## 2026-10-28 06:45 — staging — W2 X lane merged, export hand-tested

- Merged claude/w2-x (610299e): D15-4 locked holding reply, D15-6 export ZIP, D15-7 export while locked, D15-11 deletion event, D16-3. No migrations.
- Manual ✓: Settings → Privacy export → ZIP checked on disk. Other repos: backoffice#7, website#46 drafts, WP patch 1.1.0.
- Running: W2 review-fix agent. Next: merge fixes, Wave 2 close, Wave 3.

## 2026-10-28 06:20 — staging — W2 L9+L10 owner loop hand-tested

- Manual ✓: Pause AI everywhere (banner, audit row, one "team will reply" line), Resume, lock-screen privacy toggle. Push untested (no VAPID; real iPhone on Needs Roger).
- Next: guides for L1+L6 and L9+L10, X lane merge when it reports, Wave 2 review.

## 2026-10-28 06:10 — staging — W2 L1+L6 bot protection + spam merged, hand-tested

- Merged claude/w2-turnstile (099db7e); 2 migrations on hay_staging; plugin SDK rebuilt; Turnstile TEST keys in staging .env.
- Manual ✓: bot check allow, link spam held + /spam + Not spam re-engages AI, under-attack on/off. Fix bb305a2 spam preview.
- L9+L10 merged (55efdc3), not hand-tested yet. Running: X lane. Next: L9+L10 hand test, guides, X merge, Wave 2 review.

## 2026-10-28 05:45 — staging — W2 L7 channels merged, hand-tested

- Merged claude/w2-channels; 3 migrations on hay_staging; npm install (messenger workspace).
- Manual ✓: customer merge from /customers; Messenger in Marketplace; Email inbox degrades without Resend. Meta/Resend: tests only (Needs Roger).
- Running: L1+L6 Turnstile, L9+L10 owner loop. Next: X lane, Wave 2 review.

## 2026-10-28 05:50 — claude/w2-owner-loop (L9+L10) — D11-7, D11-9, D11-12 committed, not pushed

- 5f7c764 D11-7 shopper-reply / follow-up / 10-min unanswered alerts (push then email, Available only, business hours).
- 78435a7 D11-9 owner "Pause AI everywhere" (Home card + red banner, audit organization.ai_paused/resumed), one "our team will reply here" line per paused conversation.
- 228526f D11-12 iOS Add to Home Screen guide, apple-touch + maskable icons, per-user lock-screen privacy (Profile > push card).
- Migrations (run on hay_test only): AddOrganizationAiPause1785795000000, AddUserAlertPreviewPrivacy1785796000000. No new env vars.
- Verified: server tsc + 25 jest suites/178 pass; dashboard typecheck 0; vitest pass (3 Playwright specs fail under vitest, pre-existing).
- Next: merge into staging, run both migrations on hay_staging, hand-test on a real iPhone.

## 2026-10-28 — claude/w2-turnstile — W2 L1+L6 built (D9-11, D9-8, D9-9, D9-6, D9-7, D9-10)

- 6 commits 55fd488..98d6525 on base 82d2026; not pushed. Migrations AddWebchatSpamSettings1785783300000 + AddWebchatUnderAttack1785783400000 run on hay_test only.
- Works (tests): webchat plugin extension point (contributions + gates), Hay.chat-hosted challenge frame, plugins/core/turnstile (default-on, invisible), spam heuristics + optional AI check holding web spam from the AI, /spam view + Not spam/Mark as spam, under-attack mode (owner toggle + auto at 30 creates/5 min, 4 h).
- Not hand-tested in a browser; needs TURNSTILE_* test keys in staging env and the plugin enabled for existing orgs.
- Next: merge into staging, run both migrations on hay_staging, hand-test per the lane report.

## 2026-10-28 05:15 — staging — W2 D8 part B merged, hand-tested, i18n fix

- Merged claude/w2-media-vision; migration AddUploadScanStatus1785771000000 on hay_staging.
- Manual ✓ (real OpenAI): photo description + Inbox "AI read"; card photo withheld + blurred, AI declines; product-problem template → draft.
- Fix 4e2c01d: bare `@` in a locale string broke the whole en settings file; tests/locale-messages.test.ts now compiles every message.
- Running: L7 channels, L1+L6 Turnstile. Next: L9+L10 lane, X lane, Wave 2 review.

## 2026-10-28 05:00 — claude/w2-media-vision — W2 D8 part B built (D8-11..15, D8-4 seam)

- 6 commits 8139570..24fb747 on staging base; not pushed. Migration AddUploadScanStatus1785771000000 run on hay_test only.
- Works (tests): vision sidecar on customer photos/PDFs (OPENAI_VISION_MODEL), ID/card withholding + card redaction + Inbox blur, inspect_attachment, product-problem template + complete_product_case, case email, clamd seam (CLAMAV_HOST).
- Not hand-tested against real OpenAI/clamd/SMTP yet.
- Next: merge into staging, run migration on hay_staging, hand-test per the lane report.

## 2026-10-28 — claude/w2-channels (L7) — all L7 tickets committed (D13-8..14, D11-10/11), not pushed

- D13-14: plugins/core/messenger (hay-channel-messenger-meta; Facebook Login, Page tokens from /me/accounts, route by Page id, customer id messenger:<page>:<psid>, owner Page-inbox echoes → human_agent). Human Agent tag retry for a person's reply after 24 h in messenger + instagram; core /deliver now sends messageType.
- New env: META_MESSENGER_APP_ID / META_MESSENGER_APP_SECRET (.env.example). package-lock gained the messenger workspace entry.
- Verified: server tsc + jest 139 suites/1378 pass; dashboard typecheck 0; messenger 34, instagram 21, whatsapp 140, email-channel 61 vitest + builds.
- Next: Roger configures Meta (Messenger product, Page webhook, App Review incl. Human Agent), then hand-test on staging; merge L7.

## 2026-10-28 — claude/w2-channels (L7) — D13-8..D13-13 + D11-10/11 committed, not pushed

- Done: WhatsApp/IG echoes as human msgs; optional Resend sending domain; Resend bounce webhook; channel health (email+push+plugin page); channel-aware rendering (hay-plugin.rendering); suggested customer merge (/customers pages).
- Migrations (hay_test only): AddEmailSendingDomains1785780000000, AddPluginInstanceChannelHealth1785781000000, AddCustomerMergeDismissals1785782000000.
- Half-built: D13-14 Messenger plugin (plugins/core/messenger) + Human Agent tag on Instagram.
- Next: build Messenger plugin mirroring instagram, pass messageType to /deliver, then report.

## 2026-10-28 04:20 — staging — W2 D8 part A + L13 evidence pack merged, hand-tested, fixes in

- Merged 7ba8a51 (media ingest) + e78f8ba (evidence pack); migrations + order-links backfill run on hay_staging.
- Manual ✓: widget photo upload/refusal, Inbox media, composer PDF → widget; evidence pack PDF/ZIP (hashes ok), Export menu entry.
- Fixes: 81e6221 size as number + sent staff message keeps attachment; f77c85a pack shows the approved amount (not the AI's original) and images no longer overlap text.
- Next: D8 part B + L7 lanes; then remaining W2 lanes and the Wave 2 review.

## 2026-10-28 04:00 — claude/w2-evidence-pack (L13) — D2-2..D2-5 done, committed, not pushed

- D2-2 conversation PDF: store name + full date/time/UTC offset (org tz). D2-3 DisputeEvidenceService (server/services/dispute-evidence). D2-4 order_conversation_links (tool calls via recordAction + Message subscriber + `npm run order-links:backfill`). D2-5 /evidence page, evidencePacks router, PDF/ZIP (manifest + README).
- Migration AddOrderConversationLinks1785762000000 (run on hay_test only).
- Gaps: emoji dropped in PDF; remote http attachments not fetched; no page cap; pre-action-log writes show tracking only; policy excerpts = current doc text.
- Pre-existing failure on base: tests/routes/actions.test.ts "API key caller" (untouched).
- Next: merge into staging, run migration + backfill on hay_staging, hand-test.

## 2026-10-28 03:30 — staging — W2 D1-5/D1-6 merged + hand-tested

- Settings > Usage: billable count (= analytics billableResolutions), breakdown, ledger, CSV, Exclude (5 % instant, then sent for review). Migration run on hay_staging.
- Next: D8 part A merge when done; L13 D2-2..5.

## 2026-10-28 — claude/w2-usage-ledger (L9+L2 Wave 2) — D1-5, D1-6 done, committed, not pushed

- Settings > Usage (/settings/usage, owner/admin): live billable count per UTC calendar month, breakdown by outcome, ledger with CSV + Exclude (reason required).
- Exclusion: instant up to max(1, floor(5 %)) of the month's billable; beyond = pending_review (still billed). Audited in audit_logs + row columns. billableResolutions skips excluded.
- Migration AddResolutionExclusions1785750000000 (run on hay_test). New `billing` scope (admin wildcard only). run.ts untouched.
- Gaps: core has no plan/allowance/overage nor billing period dates (TODO in usage.vue/service); Hay.chat review queue has no UI; credits for post-report exclusions = backoffice.
- Next: merge into staging, run migration, hand-test.

## 2026-10-28 — claude/w2-media-ingest (L8+L7 part A) — D8-3,6,7,8,9,10,16,17 done, committed, not pushed

- D8-3 media lifecycle (migration AddUploadConversationLinks1785752000000, 180-day default, orphan sweep); D8-6 Instagram inbound + voice transcripts; D8-7 email inline images; D8-8 media cap (CONVERSATION_MEDIA_MAX_SIZE_MB=25) + WhatsApp Meta limits.
- D8-9 widget paperclip (image/PDF <=10 MB, publicConversations.sendAttachment, DPoP + rate limits, 24 h signed links, 13 locales).
- D8-10 handoff summary lists files; /escalate carries 7-day signed links; Chatwoot note lists them.
- D8-16 Inbox composer attachments (conversations.uploadAttachment + sendMessage.attachmentIds). D8-17 send_attachment core tool (tool-result URLs only, SSRF-checked) + Instagram outbound media.
- Verified: server tsc + jest (1299 pass; 1 failure in tests/routes/actions.test.ts was already there, file untouched), webchat vitest/vue-tsc, dashboard typecheck, whatsapp/email/instagram/chatwoot build + tests.
- Gaps: no dashboard component tests; swept files leave dead attachment entries (404); scanning/metering/vision (D8-4/5/11-15) not built.
- Next: merge into staging, run migration on hay_staging, test each ticket by hand.

## 2026-10-28 03:15 — staging — W2 L3 + L4 merged, hand-tested, fixes in

- Merged L3 (ccf449e, business hours/hand-off/email follow-up) + L4 (d43ea72, approvals UI, shopper confirm, action log). Migrations run on hay_staging.
- Manual ✓: closed hand-off + email capture + follow-up path; confirm → held refund → lowered to 10.00 → Woo refund 10.00 → AI told shopper; Action log filters; Settings > Actions typed confirm; playbook override; failure reason card.
- Fixes: 45c491c action log "Sent for approval"; 3a8cd39 Input checkbox label shown twice.
- Next: W2 lanes L9+L2 (D1-5, D1-6) and L8+L7 (D8-3, D8-5..17).

## 2026-10-28 — claude/w2-business-hours (L3 Wave 2) — D5-6..11 done, committed, not pushed

- D5-6 schedules (per channel + org default, tz/DST, closures) + Settings page; migration AddBusinessHoursSchedules1785740000000 (run on hay_test).
- D5-7 availability-aware hand-off copy; pending-human: AI quiet in hours, answers outside; widget header "Open now / Back Mon 09:00".
- D5-8 widget email capture (consent) -> publicConversations.setContactEmail. D5-9 human reply emailed to absent web shopper w/ resume link (?hay_conversation=).
- D5-10 waiting banner + median first reply (hidden <5 samples). D5-11 already covered by D11 ladder (no repush/email outside hours).
- Gaps: email replies do NOT thread back (no core inbound); teams not modelled; presence = local websocket count (single instance).
- Next: merge into staging, manual staging checks per final report.

## 2026-10-28 — claude/w2-approvals-ui (L4 Wave 2) — 6 tickets done, committed, not pushed

- 5bf7fbc D4-9 Settings > Actions (per-category approval, typed confirm, playbook tighten-only override; migration AddPlaybookApprovalCategories1785744000000).
- e104071 D4-10 customer-confirmation gate before writes (cancels always; planner prompt rewritten so the gate drives the ask).
- dac49b4 D4-6 Approvals list atop /inbox (lower amount, decline reason, same-category bulk approve); 70d33a8 D4-11 owner graduation nudge.
- 5dc9f3e D6-6 plain-language tool failure reasons; 35a9220 D6-7 /actions page over action_log (tool/platform/outcome filters, conversation link).
- D4-1 intentionally not built. run.ts untouched.
- Next: merge into staging, run migration on staging, hand-test per lane report.

## 2026-10-28 02:15 — staging — W2 L11 + L5 merged, hand-tested, fixes in

- Merged L11 (D14-5..8) and L5 (commerce, 10 tickets). No migrations.
- Fixes: 4cd82e9 drafts-only Approve/Block always shown + i18n; 992bcb5 saving plugin settings kept secrets; 18c4a4a marketplace copy; aefb1c0 Woo resend detects mailer failure note → EMAIL_FAILED (6 tests).
- Manual ✓ on Woo demo: return instructions, marketplace routing, tracking from note, resend honest on mail failure. GIF W2-L5-*.
- Next: full suites alone → tag wave-1-done → PR #104 body → GIFs to Roger → next W2 lanes (L9+L4 D4/D6, L3 D5).

## 2026-10-28 — claude/w2-commerce (L5 Wave 2) — all 10 tickets done, committed, not pushed

- SDK: exchange write category (core MONEY_CATEGORIES, tiny core change), return-instructions, identity, marketplace-orders modules.
- Shopify: re-consent scopes + runtime SCOPE_MISSING ("re-approve Hay.chat"); D6-10 swap_order_item; D6-11 create_exchange; D10-3 send_payment_link.
- Woo: D6-12 resend confirmation (+Magento), D10-3 resend_pix, D16-8 tracking (VillaTheme/YITH/notes). D6-13 return instructions + D10-6 marketplace routing on Woo/Shopify/Nuvemshop.
- D16-2 f7ac632: Woo wc-auth one-click connect (worker routes + AfterSettings UI bundle; keys now optional in schema). Needs HTTPS HAY_API_URL.
- Next: merge into staging, real-store checks (see final report Needs Roger), tunnel test of D16-2.

## 2026-10-28 — claude/w2-eu-disclosure — Wave 2 L11 (D14-5..8) built, not pushed

- 0e46e8e D14-5 AI region+provider card (Customer Privacy) + debug note; 4a71322 D14-6 widget AI label (EU: rename, not hide).
- 6837a58 D14-7 first-reply [label] line on non-web channels + per-channel drafts-only (reuses approval queue).
- 98f359f D14-8 new orgs retentionDays 365; existing orgs untouched. No migrations, no env vars.
- Verified: server jest 1200 pass, tsc, dashboard typecheck, webchat vitest+vue-tsc.
- Next: orchestrator merges into staging; hand-test on :3000 + localhost:8090/w1.html.

## 2026-10-28 01:35 — staging — Wave 1 review server fixes merged + tested

- fecc425 merged claude/w1-review-server (approval auth/threshold owner-only, public metadata whitelist, EU fallback org id, reply window on resume, alert locales, closed-conversation approve refused). e574bef shows that refusal in en/pt-BR.
- Manual ✓: metadata whitelist; approve on resolved conversation → refused, still pending.
- Next: when W2 L5 builder ends, full suites alone → tag wave-1-done → PR #104 body → GIFs to Roger; then Wave 2 lanes.

## 2026-10-28 01:20 — staging — Wave 1 review: plugin fixes merged, server fixes running, W2 L5 started

- fde9618 merged claude/w1-review-plugins (9 fixes: Shopify/Woo/Nuvemshop coupon dedupe + ownership, Woo refund record-only only for bacs/cod/cheque, Pix/coupon times, approval card, rotatePush needs old auth). woo/shopify/nuvemshop rebuilt, tsc ok.
- Running: claude/w1-review-server (11 server fixes), claude/w2-commerce (W2 L5).
- Next: merge server fixes, migrations if any, full suites, tag wave-1-done, PR #104 body, GIFs to Roger.

## 2026-10-28 00:55 — staging — L5 commerce merged + tested

- b0b59ab merged claude/w1-commerce; SDK + 10 plugins rebuilt, tsc ok.
- Manual ✓ (Woo :8085): 10% coupon created and restricted; second coupon refused (ALREADY_HAS_COUPON); 25% held then approved → created; EUR totals in EUR; bank-transfer refund approved with refund_payment=false.
- Next: Wave 1 close: review agent over wave-0-done..staging, fixes, full suites, tag wave-1-done, PR #104 body, send GIFs.

## 2026-10-28 — claude/w1-commerce (L5) — coupons + generic over-cap approval done; staging 255683b merged

- 7c10840 D16-6: capped tools (_meta chat.hay/capEnforced) skip the money hold; plugin NEEDS_APPROVAL → pending action (over_cap); approved re-run gets hay_approval_id. SDK coupon-policy (10%, fixed off, 30 d).
- 694eed4 D16-4/5: woocommerce_create_coupon, shopify_create_coupon (+write_discounts scope), Nuvemshop on shared policy (order required).
- 3c0c9d1: Woo totals.currency, gatewayCanRefund + refund_payment=false guidance. 5340c50: staging merge, SDK tool-risk reconciled (capped in ToolRiskSpec).
- Earlier: Nuvemshop merge, D16-1, D16-7, D10-1, D10-2 (Pix), D6-9 stale tracking. Not pushed.
- Next: orchestrator merges L5; Roger: Shopify re-consent for write_discounts; real-store checks (Shopify discount title search, Pix keys).

## 2026-10-28 00:30 — staging — approval follow-ups truthful + risk lane merged

- a43ac55: after approve/decline the follow-up turn seeds the claim-check ledger with the decision; decline → AI explains (no hand-off), approve → Woo refund #19 ran and AI says done. ef5e57a: held call reported as "requested".
- Risk lane merged: SDK toolRisk + 7 plugins declare risk; SDK/plugins rebuilt; tests green.
- Next: L5 (claude/w1-commerce) merge + Woo/coupon test; then Wave 1 review agent, full suites, tag wave-1-done, PR #104 body, feature guides.

## 2026-10-28 — claude/w1-tool-risk-all-plugins — D4-2 risk classes for all core plugins (not merged)

- SDK: optional `toolRisk {read, write}` on mcp.startLocal/startLocalStdio/startExternal; worker merges it into /mcp/list-tools (declaration wins; hosted readOnlyHint passes through; unknown writes stay held). Core unchanged.
- calcom, klaviyo, twenty, zendesk: local `applyToolRisk` + mcp/tests/tool-risk.test.js. atlassian, email-channel (send-email), stripe: SDK declaration. hubspot: remote annotations only. notion/chatwoot/instagram/whatsapp: no agent tools.
- Deliberately held: klaviyo upload_image_from_file (reads any host file — security follow-up), stripe update_subscription/create_invoice/create_invoice_item/finalize_invoice.
- Next: orchestrator merges; rebuild packages/plugin-sdk (dist) + restart workers so tools re-list with risk.

## 2026-10-28 00:30 — staging — L4 action approval + copy lane merged

- L4 aa8b4c9: tool risk, action_log, playground dry-run, pending approvals + gate (money moves held, threshold 0), resume, 48 h expiry. 3 migrations ran on hay_staging.
- Copy e31f6b9: access-notice copy for backoffice states, Hay.chat sweep.
- Half-built: non-commerce plugin tools have no risk class → held by the gate. Next: risk-annotation lane + L5 (Nuvemshop first), then L4 manual test on Woo demo :8085.

## 2026-10-27 — claude/w1-action-approval — L4 action approval done (not merged, not pushed)

- dcba4f3 tool risk (readOnlyHint + _meta chat.hay/category); 9df0adb action_log; 58a17b4 playground dry-run; d65787c pending_actions + approvers; 9f8e4e0 policy gate (money moves held, threshold 0, unclassified writes held); 8c36c5f approve/reject/reply-myself resume + actions tRPC + thread card; a417217 48 h expiry job -> pending-human + shopper copy (never auto-approves).
- Migrations AddActionLog1785710000000, AddPendingActions1785720000000, AddAwaitingApprovalStatus1785730000000 ran on hay_test only.
- Verified: server tsc, full jest 107 suites, dashboard typecheck + vitest (3 Playwright specs fail as before).
- Known gaps: unannotated non-commerce plugin writes get held; crash between approve and execute leaves row "approved"; shopper gets no AI reply while awaiting.
- Next: orchestrator merges into staging, runs migrations, manual test with a Shopify refund in a real conversation.

## 2026-10-27 23:00 — staging — L10 merged (D11-5, D11-8)

- Push subscriptions per user (all orgs), unsubscribe on logout, pushsubscriptionchange in sw.js, re-sync on app open.
- Alert ladder: push to Available members → re-push at 10 min → email at 20 min; stops on reply/take-over/close. Table notification_deliveries.
- Migration PushPerUserAndNotificationDeliveries1785600000000 ran on hay_staging + hay_test.
- Half-built: business hours always "within hours" until D5-6. Next: manual test of the ladder; L4 starts.

## 2026-10-27 — claude/w1-push-hygiene — L10 D11-5 push hygiene + D11-8 alert ladder done (not merged)

- D11-5: logout drops push (browser unsubscribe + auth.logout pushEndpoint deletes row); sw.js pushsubscriptionchange -> public notifications.rotatePush (old endpoint = proof); sync() upserts on every app open/foreground (5-min throttle); devices per user (organization_id dropped), fan-out to every org the user is active in; alert links carry ?org= and the auth middleware switches org.
- D11-8: notification_deliveries (step initial/repush/email per recipient per cycle, unique claim); conversation-alert.service: recipients = active + Available members; sweep job every 60 s: re-push at 10 min, email 10 min later (at once if re-push reached no device), only within business hours (stub: always open until D5-6), cancelled on human reply / take-over / close.
- Migration PushPerUserAndNotificationDeliveries1785600000000 (ran on hay_test). Verified: server tsc, full jest 102 suites, dashboard typecheck.
- Next: orchestrator merges + runs migration on staging; manual phone test; alert-health card on Home = follow-up.

## 2026-10-27 — claude/w1-whatsapp-templates — L7 D13-7 + D13-1..5 done (not merged, not pushed)

- d25e567 D13-7 core retry (3x, 5/15/45 s) only on worker 503/429/start-fail/ECONNREFUSED; then failed + owner/admin push + toast. WhatsApp 503 only for sure-not-sent; email thrown send = send_uncertain.
- 6c6b03d D13-1/5 worker template store (sync on start/connect/button, status+category webhooks), settings card, starter templates hay_we_replied / hay_handoff_to_person (en, pt_BR).
- 4628f25 D13-2 conversations.reply_window_expires_at (migration AddConversationReplyWindow1785470000000, ran on hay_test only).
- 15399d6 D13-3/4 core GET /templates contract + conversations.channelTemplates/sendChannelTemplate, ReplyWindow composer + picker; hand-off 131047 -> template.
- Verified: server tsc + full jest (101 suites), whatsapp build + vitest 132, email-channel 57, dashboard typecheck.
- Next: merge into staging; real-WABA check of sync/webhooks/starter approval/template send (Needs Roger).

## 2026-10-27 — claude/merge-email-plugins — Email plugin merged into Email inbox (not merged, not pushed)

- 70f2c91 email-channel: `send-email` action (email-mcp, capability mcp) emails notificationRecipients, else supportAddress; supportAddress now optional; i18n en/pt-BR; vitest 57.
- 8a318c0 plugins/core/email + its e2e specs/lockfile entries removed; docs/comments updated.
- 5953d3c migration MergeEmailPluginIntoEmailInbox1785300000000 (merge recipients / move lone instances / rewrite hay-plugin-email:send-email refs / drop registry row); ran on hay_test only.
- Verified: plugin build + vitest, worker smoke (list-tools, call-tool → relay payload), server tsc, jest plugin|mcp|playbook 16 suites + new migration test.
- Next: merge into staging, manual check on plugins page; prod: migration runs on deploy (Needs Roger).

## 2026-10-27 — claude/w1-greeting-locale — greeting in shopper locale done (not merged, not pushed)

- 489750f server: public create validates `language` (BCP-47 regex, max 35); toSupportedLanguage maps pt-BR->pt; greeting translated at create via existing generateLocalizedGreeting (org LLM, falls back to original).
- 32375d5 webchat: create sends resolveLocale(config.locale) (same as UI).
- Verified: tsc; full server jest 98 suites incl. new tests/integration/greeting-locale.test.ts; webchat vitest 111, vue-tsc, build.
- Next: merge into staging, rebuild webchat dist, manual test on :8090 with locale pt-BR.

## 2026-10-27 — claude/w1-agent-join-notice — "talking to a person" notices done (not merged)

- Takeover/release store System msgs with metadata systemEvent (agent_joined | agent_returned_to_ai | agent_left) + agentFirstName; HumanAgent replies carry agentFirstName (sendMessage).
- Widget: centred line from metadata in 13 locales; "10:42 · Marina" on person replies. Dashboard: centred line (en/pt-BR), also for old takeover rows.
- Public whitelist passes only systemEvent/agentFirstName, blanks System content. Widget history via new getWidgetMessages; orchestrator getPublicMessages + channel delivery unchanged (System skipped). run.ts untouched.
- Verified: jest services/routes/orchestrator 65 suites + new integration; tsc; webchat vitest 109, vue-tsc, build; dashboard typecheck + util test.
- Next: merge into staging (handlers diff is metadata-only), rebuild webchat dist, manual test on :8090.

## 2026-10-27 — claude/w1-first-message-race — orchestrator race fixes done (not merged, not pushed)

- 264360c Bug A: greeting + instructions written in createConversation (no creation run); addMessage stores the customer row before setting needs_processing; setProcessed -> markProcessed(lastCustomerMessageId) compare-and-set; run re-reads flag after lock and re-queues on non-error exit.
- bc36f02 Bug B: releaseFromUser("ai") queues a run only if the newest Customer message has no BotAgent/HumanAgent reply after it. Release route handler untouched.
- Verified: tsc clean; full server jest 95/95 suites; new tests/integration/orchestrator-processing-race.test.ts fails before / passes after.
- Next: orchestrator merges into staging (watch conflict with join-notice branch in conversation.entity.ts releaseFromUser); manual widget retest.

## 2026-10-27 late — staging: Wave 1 L2 merged

- L2 close classifier merged (c40e1e7, migration AddConversationOutcomes1785100000000), unresolved treated as closed in widget (728066a); loader idle fix (ca54167). Tester running on both.
- L11 EU inference building. Next: L10, L7, L4, L5 lanes. See tasks/voc-roadmap.md.

## 2026-10-27 — claude/w1-eu-inference — Wave 1 L11 EU inference done (not merged)

- D14-2: OPENAI_BASE_URL for managed OpenAI calls. D14-4: org `settings.aiRegion` ("default" | "eu"); EU orgs' chat, embeddings (docs + products), transcription go to OPENAI_EU_BASE_URL/KEY; fail-closed (no fallback) when EU unset; UI switch in Settings -> AI Models only when EU configured.
- Found: most llmService calls dropped organizationId (BYO + region ignored). Fixed everywhere except orchestrator/conversation-utils.ts (other lane) — patch in orchestrator handoff, must land before EU is sold.
- Verified: jest services/orchestrator/routes 64 suites + region tests, vector integration, tsc, dashboard typecheck; real-HTTP smoke against a local mock EU endpoint.
- Next: apply conversation-utils patch after merge; Roger: OpenAI EU residency approval + Infisical OPENAI_EU_* values.

## 2026-10-27 night — staging: Wave 1 started

- L6 merged (3acc19a): reload resumes conversation, create on first message, split loader + idle loading; tester running.
- L2 close classifier building (claude/w1-close-classifier). Feature guides committed in seo repo.
- Next: record L6 test, merge L2, then L11/L10/L7 lanes. See tasks/voc-roadmap.md.

## 2026-10-27 — claude/w1-widget-loader — Wave 1 L6 widget done (not merged)

- Commits: reload-resume bug fix (53ff6e6), D9-4 create on first message (e512d9c), D12-6 server cache (e9e2cf8), D12-6/7 loader split + loading modes + lazy locales (f6b2e5c), prettier (78a9683).
- widget.js loader 6.8 KB / 3.0 KB gzip; chat chunk 116 KB / 40.8 KB gzip. webchat vitest 101/101, vue-tsc, root build, jest webchat-static + http-compression green; real-browser smoke passed.
- Not done: server-side D9-4 cleanup of empty conversations in checkInactivity (L1), strict mode without grant cannot resume after reload (key never persisted; needs Roger's call).
- Next: orchestrator merges into staging, rebuild webchat dist on staging, manual test on http://localhost:8090.

## 2026-10-27 ~20:40 — staging: Wave 0 done

- Review fixes + tester fixes merged and retested; full suites green. Tag `wave-0-done`; PR staging→master open (see roadmap "Resume here").
- Next: Wave 1 in a fresh orchestrator session ("resume from tasks/voc-roadmap.md").

## 2026-10-27 ~19:45 — staging (VOC roadmap, Wave 0)

- Merged L10 (refresh rotation, migration AddRefreshTokenRotationToSessions1784700000000 ran) and L6 (widget hygiene, dist rebuilt). tsc/vue-tsc clean; jest auth-session 20/20; dashboard session 21/21; webchat 67/67.
- X tickets: PRs hay-backoffice#3 (D1-4), #4 + hay-website#44 (D15-1), hay-shopify-app#1 (D12-2); WP 1.0.1 patch in ../haychat-svn-patches.
- Half-built: claude/d12-reply-time-defaults (f572619) waiting to merge; tester running on L9/L10/L6.
- Next: merge reply-defaults → Wave 0 review agent → tag wave-0-done → PR staging→master. See tasks/voc-roadmap.md "Resume here".

## 2026-10-27 — staging — L1 security, L8 private media, L3 hand-off honesty merged

**Landed + tested:** D9-1/3/2, D3-1, D12-1 (6ae259f), D8-1/2 (b2a60d7), webchat settings switch/description fix (262ba92). L3 (b5a4120) merged, suites green, manual test by a tester agent in progress.
**Running:** L9 dashboard agent; tester for L3. Manual tests now delegated to tester agents (brief in scratchpad TESTER_BRIEF.md).
**Next:** L5 Shopify (D6-1/4), L10 refresh tokens, L6 widget hygiene, X tickets.

## 2026-10-27 — staging — D1-1/D7-1/D1-2 merged + tested

**Landed:** claude/d1-billing-honesty (2cf8ee5): `billableResolutions` metric (no playground/test, unhappy, handed-off), `conversations.handed_off_at` (migration run on staging). Tested by hand: takeover → release → resolve is not billed; clean resolution is.
**Running:** L1 security agent, L8 media agent.
**Next:** L3 hand-off honesty (unblocked by L2), then L9, L5, L10, L6, X.

## 2026-10-27 — staging — VOC roadmap orchestration started

**Works:** `staging` worktree `../hay-core-staging` + local env (Docker project hay-staging: PG :5433 `hay_staging`, Redis :6380, RabbitMQ :5673; server :3001, dashboard :3000; shop page :8090). Baseline tested (widget → AI reply → dashboard). Plan in `tasks/voc-roadmap.md`.
**In progress:** Wave 0 agents L1 (claude/d9-public-widget-hardening) and L2 (claude/d1-billing-honesty).
**Next:** merge + manual-test each, then L8, L3, L9, L5, L10, L6, X.

## 2026-10-27 — claude/nuvemshop (worktree hay-core-nuvemshop) — Nuvemshop plugin at commerce parity (not pushed)

**Works:** `plugins/core/nuvemshop` rewritten to the 26 Oct conventions: 17 `nuvemshop_` tools (get_order by id or number + fulfillment tracking + payment/Pix fields, get_order_tracking, cancel and address change pre-dispatch only, appending notes, check_refund_status, request_refund that records only (API can't move money), identity-gated get_payment_link, capped create_coupon, check_inventory by SKU), MCP annotations on every tool, pt-BR i18n, README parity matrix. 55 vitest tests + tsc clean.
**Half-built / unverified:** nothing live-tested; fulfillment-order PATCH merge semantics, merchant-token access to /transactions, coupon `max_uses` need a real store. OAuth partner app not built (needs `{client_id}` authorize-URL placeholder + keeping `user_id` in core oauth.service).
**Research write-up:** seo repo `Engineering/02 Research/D18 Nuvemshop parity.md` (matrix, API limits, OAuth, open decisions).
**Next:** Roger answers D18 §5; test against a Nuvemshop dev store; then push + PR.

## 2026-10-26 — master @9016b93 — Email inbox channel LIVE end to end (inbound + outbound verified in prod)

**Fixed + deployed:** plugin worker token now minted in one place (`server/lib/plugin-api-token.ts`: scope plugin-api + issuer hay-plugin-api + audience plugin) so both the tRPC plugin API and the REST relay (/v1/plugin-api/send-email) accept it; before, every email reply failed "jwt audience invalid" (and the core `email` tool plugin had the same bug). Jest test covers both checks.
**Infra done this session:** Cloudflare MX `inbound.hay.chat → receive-euw1.forge.rmta.net` (prio 10, DNS only) added via the ddns token (script in scratchpad; zone 9c9d67b9…); Resend domain inbound.hay.chat fully verified incl. receiving; `email.received` webhook → https://eu.hay.chat/v1/plugins/hay-channel-email/webhook enabled; RESEND_WEBHOOK_SECRET rotated in Infisical + `deploy.sh --env-only`.
**Verified in prod (Roger's org):** two test mails to in-1abd51c0ea@inbound.hay.chat → webhook → conversations "Test 16:48" (03336bd1…, reply refused pre-fix) and f54778c6… (agent escalated to human, bot message delivered: send-email → SMTP → "Channel delivery successful").
**Observed, not fixed:** first mail's body reached the agent as just the signature (check reply-parser when body is empty); "Failed to decrypt credential, using as-is (legacy data?)" ×7 on every delivery (legacy plugin-instance credentials); atlassian/notion `router.cjs` fail to load (`@server/trpc` missing in image) — pre-existing warnings at boot; the plugin does not implement /escalate (fine, skipped).
**Next:** Roger confirms the reply landed in his mailbox (From "Support <support@updates.hay.chat>", threading). Then Gmail forwarding setup for a real support mailbox.

## 2026-10-26 — master @e67e295 — Email inbox channel unblocked in prod (worker boots, settings page complete)

**Fixed + deployed:** SDK runner now accepts the `email` capability (7cbf7b2; it rejected both core email plugins' manifests), host env filter hands plugins SMTP_FROM_EMAIL/SMTP_FROM_NAME via `server/lib/plugin-env.ts` (tested), and the email-channel plugin no longer lists RESEND_WEBHOOK_SECRET as required (e67e295; core verifies svix, never passes secrets). Docs api-reference lists `email` (hay-docs 208faa1).
**Live-verified (Roger's Chrome, org 468ccc89…):** /integrations/plugins/hay-channel-email renders config form, forwarding alias in-1abd51c0ea@inbound.hay.chat, replies as Support <support@updates.hay.chat>, setup steps, status; only "Save your support address first" remains. Push alerts offered on the Inbox.
**Blocked outside the repo (Roger):** inbound.hay.chat has NO MX at Cloudflare's authoritative NS; Resend has it as a sending domain only (no receiving MX record, no `email.received` webhook; the only webhook targets backoffice and is disabled). Needs: enable receiving on inbound.hay.chat in Resend → publish its MX in Cloudflare → webhook email.received → https://eu.hay.chat/v1/plugins/hay-channel-email/webhook → secret into Infisical → `deploy.sh --env-only` → save support address → send a test mail.
**Prod env:** VAPID__/RESEND__/EMAIL_INBOUND_DOMAIN all live (two `deploy.sh --env-only` runs today; the Resend key was upgraded from send-only to full access by Roger).
**Next:** nothing pending in hay-core; see /srv/hay/WIP.md for backoffice (Snov.io removed, admin billing controls, one migration for Roger to run).

## 2026-10-26 — master — three follow-up fixes merged + deployed (merge-gate session, part 2)

**Merged to master:** fix-wait-time-units (82a04f2: formatWaitTime shows two largest units, "3d 4h"; 6 vitest), fix-manage-middleware (b626a21: dropped dangling `middleware: ["auth"]` on /integrations/plugins/manage; `dashboard/tests/route-middleware.test.ts` guards every named middleware), fix-sdk-register-tests (removed legacy `register.ui()` / `uiExtensions` from plugin-sdk + server metadata; SDK suite 134/134, was 5 failing).
**Checks on master:** dashboard nuxt typecheck, server tsc, eslint on changed files, SDK build: all clean.
**Live-verified in Chrome after deploy (b626a21):** manage page renders, no "Unknown route middleware"; Inbox shows "Longest wait: 336d 21h" and rows "Waiting for 336d 21h".
**Follow-ups:** dashboard has no `test` script / vitest config (new tests run via `npx vitest run` from dashboard/); `PluginMetadata` on the server lacks a `pages` field the SDK emits; prod env VAPID__/RESEND__/EMAIL_INBOUND_DOMAIN now set via Infisical + `deploy.sh --env-only` (Inbox offers "Alerts on this device"); backoffice billing branches merged/migrated/Stripe-synced/deployed (notes in /srv/hay/WIP.md); worktrees under .claude/worktrees/ for the three fix branches can be removed.
**Next:** nothing pending on hay-core from this session.

## 2026-10-26 — master — fact-fix branches MERGED straight to master + DEPLOYED (merge-gate session)

**Merged + deployed to eu.hay.chat (all done):** approval-delivery (75a3c7d), mobile-attention (ea408fe, migration push_subscriptions run), commerce-semantic-actions (d46636c), email-channel (2d005cd + lockfile sync 2aa22d0), billing-usage-limits (d55b0cb, migration AddOrganizationAgentPause1784500000000 run, file renamed back in eabe270), Inbox routing follow-up (a83be48). hay-docs main 14a7a36 holds every docs branch; submodule pointer on main.
**Live-verified in Chrome:** queued reply hidden from widget → Approve & Send → widget receives it; Inbox lists waiting conversations, Take over works; `/` → /dashboard on desktop, /inbox at 390px; WooCommerce page shows new copy; auth.me returns agentPausedAt/agentPauseReason.
**Follow-ups:** prod env needs VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT (push) and RESEND_API_KEY/RESEND_WEBHOOK_SECRET/EMAIL_INBOUND_DOMAIN (email); backoffice billing branches (claude/overage-billing then claude/billing-currencies-usage-alerts) still unmerged. Pre-existing: `/integrations/plugins/manage` 500 (`middleware: "auth"` missing), Inbox wait label "489579m 4s" (formatWaitTime lacks h/d), plugin-sdk register.test.ts 5 failures (`registerAPI.ui`), playground "paused" banner copy. Playwright specs from the branches remain unrun here except the agents' own runs. Website line lists: `git show origin/claude/<branch>:tasks/todo.md`.
**Next:** nothing pending on hay-core from this session; remote `claude/billing-usage-limits` is stale (local rebase merged instead) and can be deleted.

## 2026-10-26 — claude/email-channel — review fixes committed (c1bfdfd), branch pushed, PR to open manually (no gh)

**Works:** 8 commits on branch. Reviewer's 2 HIGHs fixed (alias-only routing; conversationId/external id bound to customer),
mediums fixed (new-thread rule, root never overwritten, echo by From/Message-ID, Resend retry, header allow-list, From-name
sanitising, Auto-Submitted). Plugin vitest 43/43, server touched suites 52/52, root typecheck + lint clean. Docs guide on hay-docs
branch claude/email-channel (d953f8b, rebased onto 807a263); submodule pointer bumped on this branch.
**Half-built:** Playwright spec unrun (no dev server here). DB-backed Jest suites only pass from the main checkout (worktree misses
`/srv/hay-core/.env`, see lessons). Phase 0 spike S1–S5 still blocked on a Resend API key from Roger.
**Next:** merge PR → set RESEND_API_KEY / RESEND_WEBHOOK_SECRET / EMAIL_INBOUND_DOMAIN in prod (Coolify) → run spike: confirm
Gmail-forwarded mail lands with the alias in `data.to`, custom Message-ID honoured → Phase 2 (custom-domain sending, idle resolve).

## 2026-10-26 — claude/billing-usage-limits (worktree .claude/worktrees/claude+billing-usage, off master, agent-pause already merged) — hay-core side of billing slice 2

**Works:** organizations.agent_paused_at/agent_pause_reason (migration 1784500000000), `internal.organizations.setAccessState`
takes `agentPause: { reason: "usage_limit" } | null`, orchestrator parks conversations of a paused org via `parkForPausedAgent`,
`auth.me` + dashboard store expose the fields, en/pt-BR `accessNotice.usage_warning|usage_exceeded|usage_paused`. Jest green
(paused-agent-skip, access service, internal router), typecheck + eslint clean. Playwright `tests/billing-usage-notice.spec.ts`
written, NOT run (needs INTERNAL_API_SECRET + dev stack). Docs submodule → hay-docs `claude/billing-usage-docs` (FAQ + settings).
**Sibling branches:** hay-backoffice `claude/billing-currencies-usage-alerts` (off claude/overage-billing), hay-website
`claude/billing-change-plan`, hay-docs `claude/billing-usage-docs` (off main). Land order: overage-billing → backoffice branch.
**Next:** reviewer findings → fix → push all four → open PRs (gh missing: compare URLs). Roger: `npm run stripe:sync` (test+live),
backoffice + core `migration:run`.

## 2026-10-26 — master @28eea98 — agent pause switch MERGED + DEPLOYED to eu.hay.chat

**Works:** claude/agent-pause merged to master (no PR, Roger's call) after review: Jest 12/12, server tsc, dashboard
vue-tsc, lint all green. deploy.sh run → hay-server/hay-dashboard rebuilt. Verified live in Chrome: Pause → "Paused"
badge persists on reload; playground message while paused → status pending-human, needs_processing=false, no AI reply,
server log "Skipping - agent paused" queued=true. Agent resumed afterwards.
**Half-built:** Playwright tests/agent-pause.spec.ts still never run (needs a dev stack). Follow-up: playground banner
shows the generic "Hay wasn't confident" copy for a paused agent — wants a "agent paused" variant. hay-docs branch
claude/agent-pause still to merge; docs submodule pointer in master working tree is dirty (left untouched).
**Next:** merge the other fact-fix branches one at a time (approval-delivery, billing-usage-limits, commerce-semantic-actions,
mobile-attention, email-channel) with the same review → merge → deploy → Chrome check loop.

## 2026-10-26 — claude/email-channel — plugin committed (44d460c), 6 commits on branch

**Works:** `plugins/core/email-channel` (hay-channel-email): inbound (Resend fetch → classify → strip quotes → thread → messages.receive),
deliver (threaded reply via send-email, token Reply-To, BCC archive), /ui/status + AfterSettings.vue wizard (en/pt-BR), README.
Plugin tsc clean, build OK (ui.js + dist), 39 vitest green. Core slices C1–C3 + C5 (holdForHuman) committed earlier.
NOTE: worktree needs `packages/plugin-sdk` built (`npm run build`) + `plugins/core/email-channel/node_modules/@hay/plugin-sdk`
symlink to the worktree SDK, else tsc resolves master's SDK types.
**Half-built:** Playwright spec not written yet; user-guide doc not written; reviewer agent not run; PR not opened. No Resend key.
**Next:** tests/email-channel-setup.spec.ts (cannot run here: :3001 is a next-server, hay dev server not up) → docs
`docs/user-guide/integrations/email-inbox.md` (docs submodule, detached HEAD → branch claude/email-channel) → reviewer → PR.

## 2026-10-26 — claude/email-channel (worktree .claude/worktrees/claude+email-channel) — core slices C1–C3 committed

**Works:** 3 commits on the branch: (1) shared-webhook routing accepts `format: "svix"`, `keyPath: "."`, `keyTransform:
"email-address"` (`server/lib/svix-signature.ts`); (2) `messages.receive` resolves conversation by Hay `conversationId` →
`externalConversationId` → active-by-customer, takes `title`, backfills customer email; (3) plugin send-email passes
from/replyTo/headers/messageId/attachments/retry, From pinned to platform domain, failures reported honestly. Jest on the 4
touched suites green, server tsc clean. Pre-existing: 5 SDK register.test.ts failures (`registerAPI.ui`) on master too.
**Half-built:** nothing. Plugin `plugins/core/email-channel` not started. Resend API key for the spike NOT obtained (prod
env read blocked by permission classifier) — ask Roger for a key (RESEND_API_KEY, create one in Resend dashboard).
**Next:** P1 plugin skeleton → P2 inbound (Resend fetch, raw MIME parse via postal-mime, classify, thread) → P3 deliver.
Plan + acceptance in `tasks/todo.md` (worktree copy); strategy in `tasks/email-channel-strategy-2026-10-26.md`.

## 2026-10-26 — master (no code changes) — Inbound email channel: strategy written

**Works:** exploration only. Code audit (channel plugin infra, email.service, plugin-api) + Resend receiving / multi-tenant
research → `tasks/email-channel-strategy-2026-10-26.md`: 3 ingress options (forwarding first, MX subdomain, Gmail/M365 API),
stay on Resend, threading model (Reply-To token → In-Reply-To/References → subject heuristic), 5 small core changes
(svix webhook signature, routeKey transform, messages.receive honours externalConversationId, send-email passthrough +
honest failures, title=subject), phased plan 0–3, 5 parked decisions with defaults.
**Half-built:** nothing. **Next:** Roger picks defaults in §7 → Phase 0 spike (enable receiving on inbound.hay.chat in Resend,
dump headers of a Gmail-forwarded mail, confirm In-Reply-To/References + Message-ID control). Uncommitted: WIP.md, docs, tasks/\*.

## 2026-10-26 — master (no code changes) — Prospect FAQ answers for Damien

**Works:** 14 prospect questions answered from code (5 parallel explores over hay-core, backoffice, website, shopify app);
full write-up with file:line evidence in `tasks/prospect-faq-answers-2026-10-26.md`. Headline findings: abandoned/unhappy
convos count as billable resolutions (pricing page says otherwise); annual plans mis-metered; "Change plan" double-subscribes;
agent Enabled switch is a no-op; approval-mode delivery is a TODO; no email channel; no mobile/push; no business hours.
**Half-built:** nothing. **Next:** Roger to decide which items become tickets (see "Fix or stop claiming" list in the tasks file).

## 2026-10-26 — claude/agent-pause (worktree .claude/worktrees/claude+agent-pause) — agent pause switch

**Works:** `agents.enabled=false` now pauses the AI: `runConversation` parks conversations with a shopper message as
pending-human (no lock, no greeting, websocket status event) and `addMessage` keeps pending-human sticky (no re-enqueue).
Dashboard copy Pause/Resume/Paused via i18n en+pt-BR, test ids. Jest: 9 new tests green. Typecheck + lint green.
Docs submodule branch `claude/agent-pause` @e9f19de (agents/conversations/settings.md) — push + PR in hay-docs still to do.
**Half-built:** Playwright `tests/agent-pause.spec.ts` written + type-clean but NOT run: no Hay dev servers on this host
(3000=AdGuard, 3001=unrelated Next app; Hay runs in Docker from master, no .env for a local stack).
**Next:** reviewer findings → push branch, open PR vs master (list website `src/docs/content/user-guide/*` mirror lines),
push docs branch + PR, bump submodule pointer. Run the spec on a machine with `npm run dev`.

## 2026-10-26 — claude/approval-delivery (worktree .claude/worktrees/claude+approval-delivery) — DONE, PR pending

**Works:** "Require Approval" now delivers on every channel: approve/block live in
`server/services/message-approval.service.ts`; approval republishes `message_received` (deliveryState sent)
through the shared `conversationEventsService.broadcastMessageReceived`, so channel-delivery posts to
WhatsApp/Instagram/Chatwoot workers and webchat gets it over the socket. Release is a conditional update
(queued→sent) so double approvals fail cleanly. Jest 16 new tests, tsc/eslint 0, Playwright
`tests/message-approval.spec.ts` green (ran in the Playwright Docker image against an isolated compose stack;
host Chromium lacks libs). Docs submodule branch `claude/approval-delivery` pushed to hay-docs.
**Next:** open PR against master (no gh CLI on this host — compare URL in the session summary); merge docs PR
first; website lines to update are listed in tasks/todo.md Results.

## 2026-10-26 — claude/mobile-attention (worktree .claude/worktrees/mobile-attention) — Home inbox + mobile + push

**Works (all committed):** `/` = attention-first Home via new `conversations.attention` procedure (waiting + handling, one-tap
Take over, live via WS); phone layout (top bar + drawer); conversation pages responsive; Web Push end-to-end (push_subscriptions

- migration, VAPID env, `notifications.*`, hook in conversationRepository on real status transition, sw.js + manifest,
  "Alerts on this device" on Home + Profile); docs submodule branch `claude/mobile-attention` (faq/dashboard/conversations/troubleshooting).
  **Verified:** server tsc + nuxi typecheck clean, eslint clean, 11 Jest tests, Playwright `tests/mobile-home-attention.spec.ts` 2/2
  green on the alt-port stack (dashboard 3100 / API 3101 / docker pg 55432, redis 56379, browser server 3200).
  Fixed e2e auth helper: storage keys are store ids (`auth`/`user`), org list at store top level.
  **Next:** push + PR (main + hay-docs); tear down `hay-e2e-*` docker containers and the two background dev servers.

## 2026-10-26 — claude/commerce-semantic-actions (worktree .claude/worktrees/claude+commerce-semantic-actions) — DONE, needs PRs opened

**Works:** Wix 9 / WooCommerce 12 / Magento 12 prefixed semantic tools, 103 vitest tests green, three plugin tsc builds,
`typecheck:server`, root lint, dashboard `nuxt typecheck` (run from main checkout with `API_DOMAIN=localhost`; the
worktree's symlinked `dashboard/node_modules` can't resolve `@types/node`). Reviewer findings (H1 POST-timeout retry,
H2 Wix search envelope + unverified hits, M1–M5, L1–L7) fixed in d504c6a; outcome in `tasks/todo.md`. Docs pages
committed on hay-docs branch `claude/commerce-semantic-actions` (949ee4e) inside `docs/`; submodule pointer NOT bumped.
**Half-built:** nothing. **Next:** push both branches (`git push -u origin claude/commerce-semantic-actions` here and in
`docs/`), open hay-core PR vs master with the body in `tasks/todo.md` ("PR body"), open hay-docs PR, then fix the website
lines listed in `tasks/todo.md` in a hay-website PR. No `gh` on this box; use the GitHub compare URLs.

## 2026-10-21 — master @7448cad — WhatsApp live in prod, Meta webhook configured

**Works:** prod deployed (Phase 2 + proxy fix + /logout). Meta console: callback eu.hay.chat/v1/plugins/hay-channel-whatsapp-meta/webhook
verified (META*VERIFY_TOKEN), 11 Phase 0 fields subscribed at v26.0. Signed "Teste" webhook passes core signature + routing
(sample ids unknown → dropped, as expected). Fix: WhatsApp uses META_WHATSAPP_APP_ID/SECRET (Meta app), not META_APP*\* (Instagram app).
WhatsApp enabled in the Hay org (468ccc89-…).
**Next:** E2E on test number 976350592236691 — Hay org WhatsApp settings → Connection method: Manual token, paste a system-user
token from Hay's Meta app + phone id + WABA id → send image + voice note both ways. Then ES as app-role tester; App Review videos.
Follow-up: on a fresh deploy the shared handshake 401s until some org enables the plugin (metadata only fetched on worker start).

## 2026-10-21 — claude/billing-lock-logout (worktree ../hay-core-billing-lock-logout) — PR #102 + hay-website #41

**Works:** owners of a suspended org were stuck in a dashboard ↔ hay.chat/billing/locked redirect loop. Public
`/logout` page (auth middleware + suspension redirect skipped) + billing page links Switch workspace (/suspended) + Log out.
**Half-built:** WhatsApp Meta console setup paused here: prod deployed (Phase 2 live, proxy fix live), but WhatsApp
plugin not enabled in any org → no metadata → shared webhook handshake 401. Chrome extension lacks eu.hay.chat access.
**Next:** merge #102 + website #41, deploy both; enable WhatsApp in Hay's org; Meta console callback + verify token + fields.

## 2026-10-21 — claude/whatsapp-plugin (worktree ../hay-core-whatsapp-plugin) — Phase 2 DONE, PR open

**Works:** plugins/core/whatsapp (hay-channel-whatsapp-meta): ES v4 + manual mode, nested routing, inbound text/
interactive/location/contacts/orders/media/voice (transcribed), statuses, account_update revoke, deliver w/ attachments +
error map, settings UI (ES popup, manual guide, health + payment cards, en/pt-BR), README, docs. Core: proxy security fix
(PR #100, ship first), onConnected credentials, connectFlow client, callUiRoute, connection.revoke, media transcribe,
webhooks.setRoutingKeys. Typecheck/lint 0, plugin 104 tests, server = baseline. Results + follow-ups in tasks/todo.md.
**Half-built:** nothing coded is pending; never run against real Meta or in a browser.
**Next:** merge #100 → merge Phase 2 PR + docs PR → deploy → Meta console webhook URL/verify token + fields → E2E on test
number (manual mode, Hay app token) → ES with an app-role tester (https) → App Review videos.

## 2026-08-31 — claude/error-tracking-noise — PR #77 open (+ hay-website PR #28)

**Works:** Root cause of 321 "No procedure found: widget.css" errors: vite inline-css
plugin deletes widget.css from webchat build, but embed snippets still `<link>` it →
404 → tRPC. Fixed: empty-css compat route in `server/main.ts`, `<link>` removed from
snippets (webchat.vue, web-embed.vue, webchat-test.html, consent spec) + hay-website
njk×2 (PR #28). NOT_FOUND/BAD_REQUEST now expected tRPC codes (no PostHog capture);
oauth store-domain error → TRPCError BAD_REQUEST. 3 PostHog issues marked resolved.
Both typechecks + telemetry tests green; consent Playwright spec not run (needs server).
**Next:** Merge #77 + website #28, deploy; widget.css issue may reopen until deploy.

## 2026-08-27 — claude/wp-connect (worktree .claude/worktrees/wp-connect) — PR #74 open

**Works:** /settings/api-tokens?connect=wordpress&return_url=&state=&site_name= shows a "Connect
WordPress" banner; confirm redirects to return_url?hay_org_id=<org>&state=<state>. auth.global.ts
now passes ?redirect=fullPath to /login so the params survive a logged-out visit. i18n en + pt-BR.
Lint + vue-tsc clean. Counterpart is the WP plugin "Connect with Hay.chat" button
(hay-woocommerce-demo/hay-wordpress, commit fa0710d).
**Half-built:** Not tested in a running dashboard — only lint/typecheck.
**Next:** run dashboard on this branch, click Connect from http://localhost:8085/wp-admin/admin.php?page=hay-chat
(set plugin base_url to the local dashboard URL), confirm round-trip, then merge #74.

## 2026-08-26 — claude/agent-instructions-contract

**Works:** Agent create/update fixed — `z.array(z.unknown())` never matched the Tiptap
doc object the editor sends (broken since 561f3fd, Jun 3); shape now declared once in
`server/types/tiptap.types.ts`. Same bug killed custom human-handoff instructions
(`Array.isArray` gate in orchestrator/run.ts) — also fixed. tRPC `onError` added (was
silently swallowing every failure), plus posthog-node server error reporting and
user/org identify in the dashboard, all gated on POSTHOG_KEY. i18n `agents.json`
namespaced so toasts stop rendering raw keys. PR #73, 448 tests green, no migration.
**Half-built:** Nothing — branch is clean and pushed.
**Next:** Merge #73 and deploy, then confirm with Klevie that agent creation AND custom
escalation work. Verify `$exception` reaches PostHog through the b.hay.chat proxy (may
not forward `/batch`). Still open: client `capture_exceptions` + error tracking toggle.

## 2026-08-20 — claude/nuven-shop-integration-suwzch — custom-tools vendor + env default provider, uncommitted

New `custom-tools` OpenAI-compatible vendor profile (toolForcedJson:true, else
identical to `custom`) so hosts advertising tool calling — DigitalOcean Gradient,
Moonshot, Together — reach structured-output rung 3 instead of falling back to
validate-and-repair. ~14% cheaper on DO in the cost model. Touches provider.types,
openai-compatible.provider, organizations zod enum, dashboard llm.vue + en/pt-BR.
getDefaultBundle() now honours LLM_BASE_URL / LLM_VENDOR / LLM_API_KEY (was
hardcoded to OpenAI), so a global default can point anywhere without touching the
DB; embeddings deliberately stay on OPENAI_API_KEY (EMBEDDING_DIM pin). Documented
in .env.example. Server 514 tests pass, typecheck clean (dashboard vitest failures
are pre-existing Playwright-under-vitest config, unrelated).
Next: trial deepseek-3.2 on one org, measure tool-call validity + handoff rate.

## 2026-08-19 — claude/nuven-shop-integration-suwzch — LLM cost reduction, uncommitted

Cost/resolution $0.393 → $0.222 (43%) at calculator defaults; ~66% with caching hits.

1. DEFAULT_TIER_MAP openai.hard gpt-4o → gpt-4.1 (cheaper + better; env-overridable
   via LLM_TIER_HARD). medium deliberately left on gpt-4o-mini (4.1-mini ~2.6x input).
2. Tier routing: 4 guardrails + handoff summary + closure validation + greeting
   translation + fallback composition → medium; title, inactivity, closure msg,
   closing msg, handoff msg → easy. Planner stays hard.
3. Anthropic had zero caching — added 3 cache_control breakpoints (tools, system,
   transcript tail) in anthropic.provider.ts, each gated at 4096 chars. OpenAI/Gemini
   cache prefixes automatically and prompt assembly was already stable-first.
4. UsageRecord.cachedPromptTokens across all 3 providers + hit-rate in the LLM debug log.
   Full server suite 505 pass. HELD BACK: perception + playbook selection hard→medium —
   biggest remaining win but needs an eval first (mis-routing is user-visible).
   Next: read real cache hit rates from logs, then build that eval.

## 2026-08-19 — claude/nuven-shop-integration-suwzch — AI cost/margin calculator (artifact, no code changes)

Built an interactive token-economics calculator (artifact, not in repo) modelling
per-conversation inference cost from the real orchestrator call graph. Two findings
worth acting on: (1) every orchestrator llmService.invoke() runs on tier "hard"
(llm.service.ts:94 default, no call site overrides) — perception, playbook selection,
title, closing message all hit the flagship model; (2) no prompt caching anywhere in
server/services/llm, and input is ~90% of spend. At defaults (gpt-4o, 6 turns, 2 tool
calls) cost/resolution ≈ $0.30 vs Growth plan revenue of ~$0.04/included resolution.
Next: verify token counts against real invokeWithMeta usage, then decide tier routing.

# WIP

## 2026-07-16 — master — Empty tool schemas + idempotency injection + playbook action validation, uncommitted

Root-caused refund-convo failure: getCachedToolDescriptors read `input_schema`
but cache stores MCP-wire `inputSchema` → every playbook rendered `Input Schema: {}`.
Fixed reader (plugin-tools.service.ts:241, + 3 unit tests) and toResolvedInputSchema
fallback. tool-execution.service: core now injects its per-execution UUID as
`idempotency_key` when the tool schema declares it (overrides LLM-invented keys).
playbook.service.validateReferencedActions + routes: create/update/publish return
`actionWarnings`, new playbooks.validateActions query; trpc types regenerated.
Verified: server+dashboard typecheck green, 15 service suites / 124 tests pass.
Next: dashboard UI to surface actionWarnings; retest refund convo end-to-end.

## 2026-07-16 — master — AI playbook suggest-edits (diff+approve), uncommitted

playbooks.suggestEdits mutation → playbook-suggestion.service.ts: transcript
(tool errors flagged) + feedback + selection → LLM full-rewrite in markdown,
deterministic client diff (diff pkg, InstructionsDiff.vue), apply = saveDraft
via SuggestEditsDialog.vue; entry points: playbook editor + conversation page.
Prompt server/prompts/en/playbook/suggest-edits.md. Fixed: model echoed prompt
scaffolding into output → BEGIN/END_PLAYBOOK sentinels + sanitizeRevisedMarkdown
(tested, 5 unit tests pass). Server+dashboard typecheck green.
Next: retest the refund conversation end-to-end; pt prompt translation missing.

## 2026-07-16 — master — Handoff summary + footer takeover bar, uncommitted

New `summary` text column on conversations (migration 1784200000000, ran locally).
generateHandoffSummary in orchestrator/conversation-utils.ts (prompt
conversation/handoff-summary, en+pt), fired from run.ts HANDOFF branch,
message-recovery escalateToHuman, and conversation.service pending-human hook.
[id].vue: new amber footer bar for real pending-human convos — summary left
(fallback "Generating…"), Take Over button right (reuses takeOverConversation).
Header Take Over button kept (consolidation onto composable deferred).
Verified: server+dashboard typecheck, eslint, conversation-service tests pass.
Next: live-test a low-confidence handoff to see summary populate in footer.

## 2026-07-16 — master — Stage 1 corrective retry + UI polish, uncommitted

Stage 1 (company-interest) block now gives the planner ONE re-plan with the
reviewer's reasoning as plannerFeedback before HANDOFF (mirrors Stage 0 pattern;
maxRetries in CompanyInterestConfig, default 1; turnGuardrailState grew
companyInterestRetries; retryAttempted persisted in metadata.companyInterest).
UI: ChatMessage debug trigger MoreVertical → Sparkles + "See Reasoning" tooltip;
back-online banner auto-dismisses after 5s (useServerStatus recovered→online);
conversations/[id].vue: localhost-only "Copy JSON" button (both headers) copies
{conversationId, conversation, messages} to clipboard.
Verified: 19 orchestrator tests (3 new in execution-company-interest-retry),
server+dashboard typecheck clean. Next: commit; live-test retry on refund flow.

## 2026-07-15 — master — Playbook grounding + contextual fallback IMPLEMENTED, uncommitted

Correct playbook-driven answers were flagged low-confidence: Stage 2 fact-check never
saw the playbook, so its policy claims looked fabricated. assessResponseConfidence now
injects the active Playbook message as an authoritative doc (0.95) and skips
toolStatus=ERROR tool messages; confidence-grounding.md (en/es/pt) updated to match.
Also replaced static fallback: composeContextualFallbackMessage (new prompt
execution/contextual-fallback en/es/pt) writes a context-aware handoff msg from
customer-visible history only (blocked response never shown to composer).
Verified: typecheck, new execution-confidence-context.test.ts (3), action-claim (7).
Live test caught Stage 1 with the SAME bug: company-interest history included
failed tool calls as "Assistant" lines → successful cancel flagged fabricated_policy.
Fixed formatConversationHistory (skip toolStatus=ERROR, label tool results w/
output) + hasToolResults; cancel tool now returns status:CANCELLATION_ACCEPTED
(async job.done:false read as failure). New company-interest-history.test.ts (2).
Next: commit; re-run the live cancel flow to confirm no more false flags.

## 2026-07-15 — master — Shopify tool rework IMPLEMENTED, uncommitted

Reworked plugins/core/shopify/mcp around support flows: cut search_orders /
create_customer_address / get_order_status; merged 3 customer lookups into
find_customer + enriched get_customer (recentOrders); get_order(+by_name) now
returns supportSummary (isCancellable/remainingRefundable/deliveredAt). New:
update_order_shipping_address (pre-dispatch guard), calculate_refund
(suggestedRefund), returns.js (get_returnable_items/create_return); create_refund
now bounded server-side vs netPaymentSet. Scopes +read/write_returns → existing
stores must RECONNECT. Verified vs shopify.dev 2026-04; MCP boots, 20 tools.
Hardened after live test: find_customer now embeds recentOrders(5) per match;
all not-found lookups now hard-error with recovery hints (order lookup probes
whether the bad id is a Customer id — the exact live failure); returnable-items
disambiguates empty-vs-missing-order. Re-verified: node --check + MCP boot.
Next: commit/PR; dev-store test of cancel/refund-on-cancel (TODO HAY-219 §8).

## 2026-07-15 — master — Action-claim guardrail (Stage 0) IMPLEMENTED, uncommitted

Agent claimed "I've initiated the cancellation" with no tool call; nothing caught it.
Added Stage 0 to applyConfidenceGuardrails: LLM check of RESPOND claims vs per-turn
tool ledger (run.ts), 1 corrective re-plan w/ plannerFeedback, then HANDOFF.
New: action-claim-guardrail.service.ts, prompts {en,pt,es}/execution/action-claim-check.md
(generic tool names), ActionClaimGuardrailConfig in org settings, 17 tests passing.
Typecheck+lint+orchestrator suite green. NOT committed. Next: commit/PR, manual e2e
(cancel flow w/o cancel tool enabled). Follow-ups: get_order_by_name schema drift
(orderName vs name); playbook "follow cancellation playbook" can't chain.

## 2026-07-15 — prod ops — Shopify OAuth fixed on eu.hay.chat (no code change)

Root cause: /etc/hay/infisical-credentials was root:600, deploy.sh:130 silently
skipped Infisical export since Mar 27 → SHOPIFY*OAUTH*\_ (+META\_\_, POSTHOG\_\*,
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
