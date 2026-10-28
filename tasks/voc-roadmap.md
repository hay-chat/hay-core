# VOC roadmap — orchestration source of truth

Started 2026-10-27. Research: `/Users/rogerjunior/Documents/code/hay/seo/Engineering/02 Research/` (D1–D16; each file's
"Roger's answers" block overrides its recommendations). Research baseline: origin/master 3e6ede1.

## Resume here (orchestrator checkpoint — keep current; safe to /compact after reading this)
- 2026-10-28 07:30: W3 L12a merged dcb08c8 (claude/w3-insights-a: D3-6 knowledge Improve + pt playbook prompts, D3-7 insight_issue_embeddings + feedback links, D3-9 every rating → insight issue + enrichment job + `npm run insights:backfill-feedback`, D3-11 insight_runs + `insights.metrics`). Migrations AddInsightIssueFeedbackAndEmbeddings1785810000000 + AddInsightRuns1785811000000 run on hay_staging; backfill run (1 issue). Hand-tested ✓: thumbs-down + comment → user_feedback issue at once, AI detail within seconds, embedding within 60 s; insight_runs rows with model/tokens/cost/duration (gpt-4o-mini enrichment $0.000186, embedding batch of 22); Improve knowledge from a conversation → analysis + new Q&A proposal. Fix d5594f6: the proposal had a literal "[open/closed]" and Add Q&A was enabled — the dialog now blocks any bracketed fill-in that isn't a markdown link, and both prompts forbid them. OpenAI prices in llm-pricing.ts match the published list (gpt-4.1 2/0.5/8, gpt-4o-mini 0.15/0.075/0.6, embedding 0.02). Guide waits for L12b (Insights page). GIF W3-L12a-*. Running: L7a. NEXT: L12b when a slot frees.
- 2026-10-28 07:05: WAVE 2 DONE. Full suites green on fcc9291 (server jest 1520/2 skipped, server tsc, dashboard typecheck, dashboard vitest 58 + the 3 old Playwright specs, webchat 134, SDK 203, 16 plugins). Tagged `wave-2-done` (fcc9291) → Wave 3 review = `git diff wave-2-done..staging`. PR #104 now "VOC roadmap Waves 0–2" with the Wave 2 table + migrations. GIFs sent. NEXT: Wave 3 batch 1 = L12a (lane-w3-l12a.md, slug w3-insights-a) + L7a (lane-w3-l7a.md, slug w3-golive-a); then L12b+L7b → L13+L5 → L6.
- 2026-10-28 06:50: W2 review fixes merged a3a4897 (claude/w2-review-fixes: #1–#8, #11, #12 + my change: Lower amount and graduation work without a stated currency, never across currencies — the agent's version turned both off because no refund plugin sends a currency). No migrations. Turnstile rebuilt. Hand-tested ✓: #1 under-attack + challengeError + no token → FORBIDDEN VERIFICATION_FAILED; normal → created, botCheck flag challenge_error:network. #2 Mark as spam on a classified billable conversation → ledger spam/false/staff + audit conversation.spam.marked; Not spam → reclassified by LLM. #3 hand-off email on a linked customer → customer.email unchanged, conversation metadata.contactEmail set (sending off on staging). GIF W2-review-mark-spam-*. Skipped: #9 (exclusion min-1, Needs Roger), #10 (ran migration, Needs Roger). NEXT: full suites alone → tag wave-2-done → PR #104 → GIFs → Wave 3.
- 2026-10-28 06:45: W2 X lane merged 610299e (claude/w2-x: D15-4 holding reply while locked, D15-6 workspace export ZIP, D15-7 export while locked, D15-11 deletion event to the operator, D16-3 connect link pre-fills plugin settings). No hay-core migrations; .env.example gains OPERATOR_EVENTS_URL. Hand-tested ✓: Settings → Privacy → Prepare export → ready (163 KB, 7 days) → ZIP on disk (server/server/uploads/<org>/organization-exports/) has README + 13 data files with right row counts (64 conversations, 495 messages, 113 customers). Holding reply / lock-page export / deletion event = tests only. Other repos: hay-backoffice#7 draft (D15-8 cancel/resume + annual fee flag off, D15-9 next-cycle downgrades, D15-10 emails, D15-11 receiver; stacked on #6), hay-website#46 draft (D15-12 refund/terms, D1-12 pricing copy, D12-4, D16-9; based on #44 — merge #44 first), WP patch haychat-svn-patches/1.1.0-d12-3-d16-3.patch. Ship order: hay-core + backoffice #7, then website #46. Guide data-export-and-plan-control. GIF W2-X-*. Running: Wave 2 review-fix agent (claude/w2-review-fixes). NEXT: merge review fixes → Wave 2 close (suites, tag wave-2-done, PR #104, GIFs) → Wave 3.
- 2026-10-28 06:20: W2 L9+L10 (claude/w2-owner-loop: D11-7, D11-9, D11-12) hand-tested ✓ on staging (merged 55efdc3, migrations run): Inbox "Pause AI everywhere" → red banner + audit organization.ai_paused; fresh widget chat while paused gets exactly one "Our team will reply to you here" line, nothing on the 2nd message; Resume AI from the banner; Profile lock-screen privacy toggle saves both ways. Push itself untested (no VAPID keys on staging; needs a real iPhone). Fresh widget session = clear localStorage on a widget-free page of the same origin (127.0.0.1:8090/nothing-here.txt) then load w1.html. GIF W2-L9L10-*. NEXT: guides (D9, D11), X merge, Wave 2 review.
- 2026-10-28 06:10: W2 L1+L6 (claude/w2-turnstile: D9-6..11) merged 099db7e (conflicts .env.example, home.json, WIP.md), migrations AddWebchatSpamSettings1785783300000 + AddWebchatUnderAttack1785783400000 run, packages/plugin-sdk rebuilt (turnstile build needs the new `register.webchat` types), staging .env has Cloudflare TEST keys + UNDER_ATTACK_CREATE_THRESHOLD=3. Hand-tested ✓: enable Bot protection → widget chat gets botCheck allow `testing_key`; 4-link SEO message held (links,known_pattern), no AI reply, on /spam; Not spam → AI answers; under-attack on → contribution mode challenge_all, off again. Fix bb305a2 spam preview showed the first (innocent) message. Dashboard dev OOM'd during typecheck: restarted with NODE_OPTIONS=--max-old-space-size=3072. GIF W2-L1L6-*. L9+L10 merged 55efdc3 (migrations run) but NOT hand-tested yet. Running: X lane (agent). NEXT: hand-test L9+L10, guides, X merge, Wave 2 review.
- 2026-10-28 05:45: W2 L7 (claude/w2-channels: D13-8..14, D11-10/11, Messenger plugin) merged (WIP.md conflict only), migrations AddEmailSendingDomains1785780000000 + AddPluginInstanceChannelHealth1785781000000 + AddCustomerMergeDismissals1785782000000 run, `npm install` (messenger workspace), dashboard dev restarted (log scratchpad/dash.log). Hand-tested ✓: /customers merge suggestion for shared email → Merge → both conversations on one customer, other removed; Messenger card in Marketplace; Email inbox page degrades cleanly without RESEND_API_KEY. Meta/Resend paths are tests-only. GIF W2-L7-*. Running: L1+L6 Turnstile, L9+L10 owner loop (claude/w2-owner-loop). NEXT: X lane when a slot frees, then Wave 2 review.
- 2026-10-28 05:15: W2 D8 part B (e80fd19, claude/w2-media-vision: D8-11..15 + D8-4 ClamAV seam) merged, migration AddUploadScanStatus1785771000000 run. Hand-tested ✓ against real OpenAI: widget photo → `analysis.description` + Inbox "AI read: …"; synthetic Visa test card → class card, withheld (no description stored, number nowhere in messages), Inbox blurred "Click to reveal", AI declined + handed off; Playbooks → From template → draft "Product problem intake". Fix 4e2c01d: a bare `@` in the case-email placeholder broke the whole en settings locale (every dashboard string showed as its key) + new tests/locale-messages.test.ts compiles every message. GIF W2-D8b-*. Running: L7 channels, L1+L6 Turnstile (claude/w2-turnstile). NEXT: L9+L10 (prompt lane-w2-l9b.md) when a slot frees, X lane, then Wave 2 review.
- 2026-10-28 04:20: W2 D8 part A (7ba8a51, claude/w2-media-ingest) + L13 D2-2..5 (e78f8ba, claude/w2-evidence-pack) merged, migrations AddUploadConversationLinks1785752000000 + AddOrderConversationLinks1785762000000 run, `order-links:backfill` run (18 links). Hand-tested ✓: widget JPG upload (row has conversation/message ids), .zip refused, Inbox shows customer photo, composer PDF reaches widget; evidence pack search #25 → PDF + ZIP (manifest hashes verified), conversation Export menu → pack. Fixes: 81e6221 attachment size stored as number + sent staff message keeps its attachment; f77c85a evidence pack used the AI's pre-approval amount (12.00) instead of the approved run (10.00) and photo overlapped text. GIFs W2-L8-media-*, W2-L13-evidence-*. NEXT: next W2 lanes (D8 part B D8-11..15; L7 D13-8/10..13 + Messenger + D11-10/11; L1+L6 Turnstile D9-8 → D9-6/7/10; L9+L10 D11-7/9/12; X lane), then Wave 2 review.
- 2026-10-28 03:30: W2 L9+L2 (e89c856, D1-5 Settings > Usage, D1-6 ledger + exclusions) merged, migration AddResolutionExclusions1785750000000 run, hand-tested ✓ (exclude → 20→19 = analytics billableResolutions; over 5 % → sent for review, count unchanged; audit rows). Fix a332d28 copy. Running: D8 part A (claude/w2-media-ingest). NEXT: L13 D2-2..5.
- 2026-10-28 03:15: W2 L3 (ccf449e, D5-6..11) + L4 (d43ea72, D4-6/9/10/11, D6-6/7) merged, migrations run on hay_staging, hand-tested ✓ (closed hand-off + email follow-up; shopper confirm → held refund → lowered to 10.00 → Woo refund 10.00 → AI told shopper; Action log filters; typed confirm). Fixes: 45c491c action-log "Sent for approval" label; 3a8cd39 Input checkbox label rendered twice (shared). GIFs W2-L3-*, W2-L4-*. NEXT: next W2 lanes L9+L2 (D1-5, D1-6) and L8+L7 (D8-3, D8-5..17).
- 2026-10-28 02:40: full suites green on 1f6b394 (server 1204, dash 43 + typecheck, webchat 114, SDK 195, 13 plugins). Tagged `wave-1-done` at e5cfef2 (so Wave 2 review = `git diff wave-1-done..staging`, covering L11+L5). PR #104 body + title updated; GIFs sent. Running: W2 L4 (claude/w2-approvals-ui: D4-6/9/10/11, D6-6/7) + W2 L3 (claude/w2-business-hours: D5-6..11). Prompts in scratchpad lane-w2-l4.md / lane-w2-l3.md.
- 2026-10-28 02:15: Wave 2 L11 (D14-5..8) + L5 (D6-10..13, D10-3, D10-6, D16-2, D16-8) merged + hand-tested. My fixes: 4cd82e9 drafts approve buttons always + i18n; 992bcb5 plugin settings save no longer wipes secrets; 18c4a4a marketplace copy; aefb1c0 Woo resend reports mail failure (EMAIL_FAILED). GIFs W2-D14-*, W2-L5-*. NEXT: full suites alone → tag wave-1-done → PR #104 body → GIFs to Roger → next W2 lanes.
- Last update: 2026-10-27 ~19:45. Staging HEAD d64da73 (+ roadmap commits).
- Wave 0 merged into staging: L2, L1, L8, L3 + D5-2 fix (a0b0220), L9, L5 (24818be), L10 (824abf1), L6 (d64da73). Migrations ran on hay_staging + hay_test.
- Wave 0 DONE: review fixes (b8f3bb5) + test fixes (e4d48c2) merged and retested ✓ (single greeting, KPI cards include today, feedback filter/export). Full suites green (server 963, dashboard 38, webchat 71, sdk 143). Tagged `wave-0-done`; PR staging→master opened. NEXT SESSION: Wave 1 per table below (fresh orchestrator session; start with widget restore-on-reload bug in L6 with D9-4).
- Wave 1 (2026-10-27 night): L6 merged 3acc19a + ca54167 → tested ✓ (incl. disabled widget never downloads chat). L2 merged c40e1e7 + 728066a → tested ✓ 7/7 (confirmed billed, unhappy→unresolved, greeting abandoned no LLM, hand-off AI-resolved billed, playground test, 72 h reversal, GIFs W1-D3-8-*, W1-D5-5-*, W1-D1-3-*). L11 merged 816f879 + 6d2851e (EU-only per org, fail closed; no migration; not browser-tested yet — needs mock EU endpoint + server env restart). Race fix 31c75f1, join notice e460496, inbox fix 4173f19 → all tested ✓ (6/6 first messages answered, greeting before customer msg; Return to AI no re-handoff + answers held question; joined/left lines en+pt, payload only {systemEvent, agentFirstName}; Inbox opens pre-onboarding). GIFs W1-race-*, W1-agent-joined-notice(-pt), W1-inbox-before-onboarding. Bug: pt-BR greeting stored in English (create-time greeting has no locale) → fixed 4ca6cdf (widget sends locale on create; pt-BR → pt; greeting translated at create), manual pending. D19 research done (seo 1eb6f84). D20 research done (seo 5091501: 13 tickets, quick-fix D20-1 first; page scored 16/40). Email→Email inbox merged 07c4b8c (migration MergeEmailPluginIntoEmailInbox1785300000000 ran on staging+test; old-only installs moved in place; refs rewritten). Suggest-integration: PRs hay-backoffice#5 + hay-website#45, dashboard link 2150f03. All plugins rebuilt on staging 22:02. Tested ✓: greeting pt-BR (create sends pt-br, language pt, greeting Portuguese, no English flash), Email inbox merged UI + playbook picker, suggest link en/pt (GIFs W1-greeting-pt, W1-email-inbox-merged, W1-suggest-integration-link). Bug found + fixed d54f287: plugin connection check could call ANY tool (fell back to first tool; ignored snake_case input_schema) → called send-email; now only health or read-only no-param tools, else worker-alive check (verified healthy on staging, unit test 4/4).
- 22:45 L11 tested ✓ on staging with mock EU endpoint: Settings → AI Models toggle saves (toast, banner that provider/models are unused), chat call went to EU base URL with EU key; with EU env removed the run throws AiRegionUnavailableError and nothing is sent elsewhere (fail closed). GIF W1-D14-eu-only-toggle-and-routing. Org reset to default region. Running now: L10 (claude/w1-push-hygiene, D11-5/D11-8) + L7 (claude/w1-whatsapp-templates, D13-7, D13-1..5).
- 23:00 L10 merged (4629f77 via merge; migration PushPerUserAndNotificationDeliveries1785600000000 ran staging+test). Manual ✓: hand-off from widget → `initial` row (no device); cycle backdated 11 min → `repush` row on next 60 s sweep; repush reached no device → `email` row (notification template) next sweep. Cancel-on-take-over covered by integration test only; real-phone push not tested (Needs Roger: check on his phone after deploy). Business hours = always open until D5-6. L4 started (claude/w1-action-approval).
- 23:25 L7 merged (d25e567..15399d6; push-service conflict with L10 resolved: delivery-failed alert now goes to active owner/admin devices under the per-user model, link carries ?org=). Migration AddConversationReplyWindow1785470000000 ran staging+test; whatsapp + email-channel rebuilt. Manual: WhatsApp installs, settings show hand-off template field; templates card hidden until a number is connected (degrades cleanly). Template sync/webhooks/starter approval/131047 fallback/real 24 h window need a real WABA → Needs Roger. Retry is in-memory (lost on restart) — follow-up. X lane started in backoffice (claude/w1-billing-notices stacked on #3: D1-7/8/9/11, D15-2/3/5). L5 waits for L4 (plugin manifest overlap).
- 23:55 X lane done → hay-backoffice#6 (stacked on #3): D1-7 forecast, D1-8 +10 % alerts, D1-9 spend cap 150 % default (new accounts), D1-11 renewal/price-change notices, D15-2 lock emails, D15-3 reasoned locks + admin_audit_log, D15-5 7-day trial grace. vitest 232/232. Prod: 3 backoffice migrations + Stripe invoice.upcoming webhook (Needs Roger). Started claude/w1-copy-and-notices (hay-core accessNotice keys for the new reasons + bare "Hay" sweep).
- 00:30 (10-28) L4 merged aa8b4c9 (D7-2/D4-2 tool risk, D6-5 action_log, D7-3 playground dry-run, D4-3 pending_actions, D4-4 gate, D4-5 resume, D4-8 48 h expiry). Migrations AddActionLog1785710000000, AddPendingActions1785720000000, AddAwaitingApprovalStatus1785730000000 ran staging (+test). Copy lane merged e31f6b9 (accessNotice keys usage_cap_reached / trial_grace / manual_suspension_pending + CTA; ~200 bare "Hay" → Hay.chat; SMTP_FROM_NAME default "Hay.chat"). tsc + dashboard typecheck clean, 10 plugins rebuilt. GAP found: only shopify/woo/magento/wix declare tool risk; every other plugin write (email-channel send-email, zendesk, hubspot, stripe, …) is "unclassified" → HELD with the gate on by default → lane W1-risk annotates all remaining core plugins before Wave 1 closes. Confirm-before-write (D4 answer 7) = D4-10, Wave 2 (not missing).
- 00:25 (10-28) Approval claim fixes: ef5e57a (a held call reported as "requested", not handed off) + a43ac55 (the follow-up turn after approve/decline seeds the claim-check ledger with the team's decision, judge sees DECLINED_BY_TEAM / SUCCESS (approved by the team), System notes no longer labelled Assistant). L4 manual ✓ on Woo demo :8085: hold → honest "requested" + `awaiting-approval`; decline with reason → AI explains, asks for a photo, stays open; approve → Woo refund #19 (64.00) on order #17, AI says it is done. Approve with the demo's bank-transfer gateway fails cleanly (Woo refuses api refunds) → honest hand-off; the success run had `refund_payment:false` set on the held row by hand (test data). GIFs W1-D4-approval-held-declined.gif, W1-D4-approval-held-approved.gif.
- 00:30 (10-28) Risk lane merged (claude/w1-tool-risk-all-plugins, 10 commits): SDK `toolRisk {read, write}` on startLocal/startLocalStdio/startExternal; calcom, klaviyo, twenty, zendesk, atlassian, email-channel, stripe declare risk; hubspot relies on remote annotations. SDK + 7 plugins rebuilt, server tsc ✓, jest 34/34, SDK vitest 156/156. Live cache refreshes when each lazy worker next starts (send-email not started on purpose: it would send mail).
- 00:50 (10-28) L5 merged b0b59ab (Nuvemshop, D16 capped coupons, D10 payment details/Pix, D6-9 stale tracking, Woo currency + offline-gateway refunds). Manual ✓ on Woo :8085: 10% apology coupon HAYMJVXPA8B (email-restricted, single use, individual, 30 d); second ask → tool PRECONDITION/ALREADY_HAS_COUPON → hand-off; 25% → held (over_cap) → approved in dashboard → HAY2C9ACXKP created, AI told shopper; EUR order #21 stated as €24.00; bacs refund held with refund_payment=false → approved → Woo refund 24.00, refunded_payment false. GIFs W1-D16-coupon-issued-then-one-per-customer, W1-D16-coupon-over-cap-held-then-approved, W1-D6-eur-amounts-bank-transfer-refund. Feature guides for 8 W1 features written.
- 01:35 (10-28) Wave 1 review server fixes merged fecc425 (11 commits, no migrations) + e574bef (closed-conversation refusal shown in en/pt-BR). Manual ✓: public create drops dryRun/runKind/test_mode from metadata (kept url/source); approve on a resolved conversation → PRECONDITION_FAILED, action stays pending. Plugin review fixes fde9618 merged earlier. W2 L5 (claude/w2-commerce) running.
- X tickets done, PRs open (not merged): hay-backoffice#3 (D1-4), hay-backoffice#4 + hay-website#44 (D15-1), hay-shopify-app#1 (D12-2 embed). WP plugin 1.0.1 = patch at `/Users/rogerjunior/Documents/code/hay/haychat-svn-patches/1.0.1-d12-2-no-render-blocking.patch` (svn commit = WP.org release → Roger).
- Then: Wave 0 review agent over `git diff 5bfee16..staging` → fixes → tag `wave-0-done` → PR staging→master (body: tickets, migrations AddConversationHandedOffAt1784600000000 / AddRefreshTokenRotationToSessions1784700000000 / DropWebchatSubtitleDefault1784800000000, tests, manual results + GIFs, Needs Roger, D8 after-deploy steps: deploy → `docker cp scripts/make-media-private.cjs hay-server:/tmp/` → dry run → `--apply` → `doctl compute cdn flush <id> --files 'uploads/*'` (hay-ams ff84a7bc-8770-4a41-af22-2192d46e9473, hay d67a8597-cd2c-4825-b902-a788706e0647) → Spaces listing Restricted → old URL 403; image needs sharp's optional Linux binaries).
- Dashboard died once from OOM (vue-tsc watcher in nuxt dev); restarted with NODE_OPTIONS=--max-old-space-size=3072.
- Process: builders get `mkwt.sh <slug> <branch>` worktrees (scratchpad) + `.env` with DB_NAME=hay_test/REDIS_DB=1; testers get `scratchpad/TESTER_BRIEF.md`. Max 2 agents while staging env runs. After npm install on staging: touch server/main.ts; if dashboard 503s, kill the nuxt processes and restart `npx nuxt dev --port 3000` in dashboard/ (log scratchpad/staging/dashboard.log).
- Roger decisions so far: allowed-domains enforcement OK; proxy verified (Traefik ignores client XFF, no Cloudflare proxy); Roger runs the media script himself after deploy; inactivity-close billing default = keep billing until D1-3 (no answer yet); hand-off copy pending confirmation.
- 2026-10-27 evening: Roger is away until tomorrow. Mandate: go as far as possible through the waves; when blocked, pin it under Needs Roger and move on; leave only what truly needs Roger. Auto-compact window set to 400k by Roger.
- Context plan: finish Wave 0 in this session; Waves 1–3 each in a fresh orchestrator session (original prompt + "resume from tasks/voc-roadmap.md").

## Setup

- Integration branch: `staging` (worktree `../hay-core-staging`), cut from origin/master 3e6ede1. Note: CI
  `.github/workflows/sync-staging.yml` fast-forwards staging to master on every master push; once staging has its own
  commits that job fails (by design, no force). Merge master back into staging by hand when master moves.
- Agent worktrees: `../hay-core-<slug>` on `claude/<D#>-<slug>`, cut from current staging; node_modules are APFS clones
  of the main checkout (helper: scratchpad `mkwt.sh`). If an agent's branch changes `package-lock.json`, run `npm install`.
- One branch per lane per wave; one atomic commit (or a few) per ticket, so each ticket can be tested after merge.
- Local staging env (never prod): Docker project `hay-staging` — Postgres :5433 db `hay_staging`, Redis :6380,
  RabbitMQ :5673. Server :3001, dashboard :3000, widget from `webchat/dist` via the server. `.env` built from
  `.env.example` + generated secrets; only `OPENAI_API_KEY` copied from the main checkout (no prod DB/Redis/Stripe).
- Concurrency: max 2 agents while the staging env runs (8 GB Mac), 3 otherwise.

## Dependency graph (what blocks what)

- D9-1 → D9-3 → D9-2 → D3-1 (all `public-conversations` / `websocket.service.ts`; strictly sequential, L1).
- D9-2 rate-limit wiring → D12-1 compression (both touch `server/main.ts` middleware order) → same L1 branch.
- D1-1/D7-1 (billable count) → D1-2 (`handed_off_at`) → **D1-3+D3-8** (one close-time LLM call, `unresolved` status
  from D5-5, spam from D9-5) → D1-5/D1-6 (usage page, ledger) → D3-6+ (Insights engine needs the QA event).
- D1-1 → D3-2 (both edit `analytics.service.ts`; D3-2 lands after).
- L2 Wave 0 (`conversation.repository`, status flips) → L3 D11-2 (inactivity jobs in `conversation-utils.ts`).
- D7-2/D4-2 tool classification → D6-5 action_log → D7-3 dry run → D4-3/4/5/8 → D4-6/9/10/11 (UI) → D7-5..12.
  D8-12 damage-photo refunds and D16-4/5 over-cap coupons ride the D4 gate.
- D6-4 structured errors → D6-6 plain-language reasons (UI) → D6-7 Actions page.
- Nuvemshop merge (claude/nuvemshop) → every later L5 action ticket (parity rule).
- One Shopify re-consent ticket (write_order_edits, write_returns, write_discounts, dispute scopes) → D6-10, D6-11,
  D16-5, D2-8.
- D9-4 client (conversation on first message) → D12-6/7 split loader → webchat plugin extension point → Turnstile
  (D9-8 spike → D9-6 → D9-7 → D9-10).
- D8-1/D8-2 private media + sanitising → D8-3 (upload↔conversation links, erasure) → D8-6..17.
- D13-7 retry → D13-1..5 templates/window → D13-8, D11-10/11 echoes.
- D14-2 EU base URL → D14-4 aiRegion → D8-12 vision (OpenAI EU) ; D14-8 retention default ↔ D8 180-day media default.
- D11-3/4 refresh → D11-5/6/8 push hygiene/fallback (shared with D5-11).
- D15-1 stopgap → D15-2/3/5 → D15-4/6..12 (backoffice + core lock path).

## File-overlap map (who must not run together)

| Hot file / area                                                           | Lanes that touch it                                | Rule                                             |
| ------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------ |
| `server/routes/v1/public-conversations/*`, `websocket.service.ts`         | L1, L6 (D9-4 server side), L8 (D8-9 public upload) | L1 owns; L6/L8 server bits go through L1 or wait |
| `server/main.ts` (middleware)                                             | L1 (rate limits, compression), L8 (`/v1/media`)    | never concurrently                               |
| `analytics.service.ts`, `conversation.repository.ts`, conversation entity | L2, L9 (D3-2), L12, L13                            | L2 first; others after merge                     |
| `conversation-utils.ts` (close + inactivity)                              | L2 (close paths), L3 (D11-2, D5-\*)                | sequential, L2 before L3                         |
| `orchestrator/run.ts`, prompts                                            | L3, L2 (D1-3 close path), L5 (D10-4/5 templates)   | sequential                                       |
| `tool-execution.service.ts`, `plugin-tools.service.ts`                    | L4, L5 (tool annotations live in plugins)          | L4 owns core, L5 owns plugin manifests           |
| `plugins/core/{whatsapp,email-channel}` deliver handlers                  | L7, L8 (D8-1 private media fetch)                  | not concurrently                                 |
| `dashboard/utils/api.ts`, `stores/auth.ts`                                | L10 (refresh), L9                                  | L10 first in Wave 0                              |
| Shopify OAuth scopes (`plugins/core/shopify/manifest`)                    | L5 tickets D6-10/11, D16-5, L13 D2-8               | one re-consent ticket                            |

## Migrations log

| Branch | Migration                                          | Table | Ran on staging |
| ------ | -------------------------------------------------- | ----- | -------------- |
| (base) | all up to `AddOrganizationAgentPause1784500000000` | —     | ✓ 2026-10-27   |
| L2 | `AddConversationHandedOffAt1784600000000` | conversations | ✓ |
| L10 | `AddRefreshTokenRotationToSessions1784700000000` (drops refresh_token_hash/is_active; adds generation, token_version, rotated_at, revoked_at, revoked_reason) | sessions | ✓ |
| reply-defaults | `DropWebchatSubtitleDefault1784800000000` | webchat_settings | ✓ |
| review-fixes | `AddLegacyRefreshTokenHashToSessions1784900000000` | sessions | ✓ |
| W1 L2 | `AddConversationOutcomes1785100000000` | conversations | ✓ |
| W1 email merge | `MergeEmailPluginIntoEmailInbox1785300000000` (irreversible; run after new code is live) | plugin_instances, plugin_registry | ✓ |
| W1 L7 | `AddConversationReplyWindow1785470000000` | conversations | ✓ |
| W1 L10 | `PushPerUserAndNotificationDeliveries1785600000000` | push_subscriptions, notification_deliveries | ✓ |
| W1 L4 | `AddActionLog1785710000000` | action_log | ✓ |
| W1 L4 | `AddPendingActions1785720000000` | pending_actions | ✓ |
| W1 L4 | `AddAwaitingApprovalStatus1785730000000` | conversations (enum) | ✓ |
| W2 L3 | `AddBusinessHoursSchedules1785740000000` | business_hours_schedules (+ webchat follow-up) | ✓ |
| W2 L4 | `AddPlaybookApprovalCategories1785744000000` | playbooks | ✓ |
| W2 L9+L2 | `AddResolutionExclusions1785750000000` | conversation_outcomes | ✓ |
| W2 L8 part A | `AddUploadConversationLinks1785752000000` | uploads | ✓ |
| W2 L13 | `AddOrderConversationLinks1785762000000` (+ run `npm run order-links:backfill` once) | order_conversation_links | ✓ |
| W2 D8 part B | `AddUploadScanStatus1785771000000` | uploads.scan_status | ✓ |
| W2 L7 | `AddEmailSendingDomains1785780000000`, `AddPluginInstanceChannelHealth1785781000000`, `AddCustomerMergeDismissals1785782000000` | email_sending_domains, plugin_instances, customer_merge_dismissals | ✓ |
| W2 L1+L6 | `AddWebchatSpamSettings1785783300000`, `AddWebchatUnderAttack1785783400000` | webchat_settings, conversations (spam) | ✓ |
| W2 L9+L10 | `AddOrganizationAiPause1785795000000`, `AddUserAlertPreviewPrivacy1785796000000` | organizations, users | ✓ |

## Wave 0 — security, honesty, quick fixes (tag `wave-0-done`)

Agent branches (one per lane):

| Lane | Branch                                                  | Tickets (order)                                      | Status            |
| ---- | ------------------------------------------------------- | ---------------------------------------------------- | ----------------- |
| L1   | claude/d9-public-widget-hardening                       | D9-1, D9-3, D9-2, D3-1, D12-1                        | merged 6ae259f            |
| L2   | claude/d1-billing-honesty                               | D1-1+D7-1, D1-2                                      | merged 2cf8ee5            |
| L8   | claude/d8-private-media                                 | D8-1, D8-2                                           | merged b2a60d7            |
| L3   | claude/d5-honest-handoff                                | D5-2, D5-3, D11-1, D11-2                             | merged b5a4120 + fix a0b0220 |
| L9   | claude/d3-dashboard-trust                               | D3-2 (delete Analytics+Reports), D5-1 (=D11-6), D3-3 | merged 538bfea    |
| L5   | claude/d6-shopify-guards                                | D6-1, D6-4                                           | merged 24818be            |
| L10  | claude/d11-session-refresh                              | D11-3, D11-4                                         | merged 824abf1            |
| L6   | claude/d12-widget-hygiene                               | D12-8                                                | merged d64da73            |
| X    | backoffice claude/d1-4-metering-integrity               | D1-4                                                 | PR hay-backoffice#3 |
| X    | WP plugin (haychat-svn/trunk) + hay-shopify-app-haychat | D12-2                                                | PR hay-shopify-app#1 + WP patch |
| X    | D15-1 (Stripe portal stopgap)                           | PR hay-backoffice#4, hay-website#44 |

Not doing: **D4-1** (Roger waits for the full D4 build). Copy must not claim Require Approval holds actions.

### Ticket status (Wave 0)

| Ticket   | What                               | Merged | Manual test | GIF                  |
| -------- | ---------------------------------- | ------ | ----------- | -------------------- |
| baseline | dashboard + API + widget test page | —      | pending     | baseline-staging.gif |
| D1-1 + D7-1 | `billableResolutions` on `analytics.conversationMetrics` excludes playground/test, unhappy closes, handed-off | 2cf8ee5 | merged → tested ✓: org metrics resolved 2 / billable 1 (handed-off chat excluded, clean one counted). Jest billable-resolutions 9/9 on merged staging; server tsc clean | d1-2-handoff-not-billed.gif |
| D1-2 | `conversations.handed_off_at` stamped on first hand-off, never cleared | 2cf8ee5 | merged → tested ✓: dashboard Take over → stamped 17:20:21; Release → Return to AI → status open, stamp kept; resolved → not billed | d1-2-handoff-not-billed.gif |
| D9-1 | DPoP on every WS write (+ extra: org membership check before streaming org events; subscribe/load_history closed) | 6ae259f | merged → tested ✓: raw WS identify w/o id → error, message w/o proof → "DPoP authentication required", subscribe → Unauthorized; 0 new conversations/messages. 7 L1 suites 42/42 on merged staging | — (curl/ws) |
| D9-3 | allowed domains enforced on create; `endsWith` bug fixed | 6ae259f + 262ba92 | merged → tested ✓: `*.example.com` saved in Settings → shop/a.b.example.com 200, evilexample.com / example.com.evil.io / 127.0.0.1:8090 / no Origin 403; widget on 127.0.0.1 can't start a chat; localhost:8090 allowed only because dashboard host is localhost in dev. Integration fix 262ba92: switches used `v-model:checked` (always looked off, ignored clicks) and Textarea dropped the description | d9-3-allowed-domains-and-widget-ok.gif |
| D9-2 | rate limits + 4000-char cap | 6ae259f | merged → tested ✓: 30× create from one XFF IP 200, 31st 429, other IP 200; 4001 chars → 400 too_big | — |
| D3-1 | public message whitelist (tRPC + WS) | 6ae259f | merged → tested ✓ via suite webchat-public-message + widget still renders replies | d9-3-allowed-domains-and-widget-ok.gif |
| D12-1 | Express brotli/gzip | 6ae259f | merged → tested ✓: widget.js 128,322 → br 42,998 / gzip 44,830, `Vary: Accept-Encoding` | — |
| D8-1 | private media via `/v1/media/:id` (session or HMAC-signed URL) | b2a60d7 | merged → tested ✓: no auth 401, staff 200 (+nosniff, CSP sandbox, inline disposition), wrong org 404, Range 206, signed 200, tampered sig 404, `/uploads/.../conversation-media` 404; Inbox renders attachment from blob URL | d8-1-private-media-inbox.gif |
| D8-2 | allow-list, magic bytes, sharp re-encode (EXIF stripped); HEIC refused | b2a60d7 | merged → tested ✓: smoke JPEG with Make+GPS EXIF downloaded with none | — |
| D5-2 | honest hand-off copy | b5a4120 | merged → failed ✗: no-agent path sends planner line "Please hold on for a moment" / "aguarde um momento"; fixed lines unused. Sent back (claude/d5-handoff-fix) | D5-2-handoff-copy.gif |
| D5-3 | org timezone + local time (hour precision) in planner | b5a4120 | merged → tested ✓: São Paulo tz → "between 3:00 PM and 4:00 PM (GMT-3)" at 15:21 BRT | D5-3-local-time.gif |
| D11-1 | drop in-flight AI reply on take-over/pause | b5a4120 | merged → tested ✓: takeover 1.4 s after shopper msg → no AI reply, log "Dropped in-flight AI reply" blocker human_took_over | D11-1-takeover-while-thinking.gif |
| D11-2 | inactivity skips held/paused chats | b5a4120 | merged → tested ✓ (by contrast): assigned open chat idle 18 min untouched; unassigned control processed. Paused-org/agent-off branches covered by Jest only | — |
| D6-1 | Shopify cancel guard, note append, tracking NOT_FOUND (returnProcess deferred) | 24818be | merged → automated ✓; live dev-store test pending store connection | — |
| D11-3 | refresh-token rotation (hrt1.), reuse detection, 90-day sliding sessions | 824abf1 | merged → tested ✓: hrt1 rotation gen0→1, grace reuse 200 same token, after 130 s reuse 401 + session revoked (reuse_detected), logout → 401 | — (curl) |
| D11-4 | never log out on network errors | 824abf1 | merged → tested ✓: expired token refreshes silently; fetch blocked 20 s → stays logged in; recovers (gen 2), not revoked | D11-4-offline-refresh-no-logout.gif |
| D12-1/3/4/5/8 | widget: quiet logs, greeting first, no reply-time promise, refused-send notice, dead WS paths removed | d64da73 | merged → tested: header "We're here to help"/pt ✓, 0 console logs (debug shows them) ✓, too-long refused → notice + text restored ✓, order kept ✓ greeting twice ✗ → fixed e4d48c2, retested ✓ one greeting (D12-3-single-greeting.gif) | D12-1-8-widget-header-and-quiet-console.gif, D12-3-4-greeting-order-and-refused-send.gif |
| D5-2 fix | fixed honest line on every path | a0b0220 | tested ✓: en/pt offline lines exact, pending-human, order after greeting; online → "I've passed this to the team…" ✓; nudge uses new model ✓ | D5-2-handoff-en-offline.gif, D5-2-handoff-pt-offline.gif, D5-2-A3-handoff-online.gif |
| D6-4 | `@hay/plugin-sdk/tool-errors` {code, retryable}; Shopify + Woo (mutations no longer retried after timeout → OUTCOME_UNKNOWN) | 24818be | merged → automated ✓ | — |

## Wave 1 — foundations

| Lane | Tickets (order)                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- |
| L2   | D1-3 + D3-8 (one LLM call at close; `unresolved` status per D5-5; spam excluded per D9-5; silent closes billed reversibly 72 h) |
| L4   | D7-2/D4-2 → D6-5 → D7-3 → D4-3, D4-4, D4-5, D4-8                                                                                |
| L5   | Nuvemshop merge (§5) → D16-1, D16-7, D10-1, D10-2, D6-9, D16-4/5                                                                |
| L6   | D9-4 client → D12-6, D12-7                                                                                                      |
| L7   | D13-7 → D13-1..5                                                                                                                |
| L11  | D14-2, D14-4                                                                                                                    |
| L10  | D11-5, D11-6 (done as D5-1), D11-8                                                                                              |
| X    | D1-7/8/9/11 (backoffice), D15-2/3/5                                                                                             |

## Wave 2 — features

L9+L2: D1-5, D1-6 · L9+L4: D4-6, D4-9, D4-10, D4-11, D6-7, D6-6 · L3+L9: D5-6..11 · L8+L7: D8-3, D8-5..17 ·
L5: D6-10..13 (+ Shopify re-consent ticket), D10-3, D10-6, D16-2, D16-8 · L7: D13-8, D13-10..13, Messenger, D11-10/11 ·
L11: D14-3, D14-5..8 · L9+L10: D11-7, D11-9, D11-12 · L1+L6: webchat plugin extension point + Turnstile (D9-8 → D9-6,
D9-7, D9-10) · L13: D2-2..5 · X: D15-4, D15-6..12, D1-12, D12-3/4, D16-3, D16-9.

## Wave 3 — big engines

L12: D3-6, 7, 9, 11..16, 18 · L4/L9: D7-5..14, D3-17 · L13: D2-1 spike, D2-7, D2-8 · L5: D10-7, D10-8, D10-4/5 (after
lawyer sign-off) · L6/X: D12-9, D12-10.

Lane split (prompts in scratchpad lane-w3-*.md), two at a time: (1) L12a D3-6/7/9/11 + L7a D7-5..8 → (2) L12b D3-12..16/18 + L7b
D7-9..14, D3-17 → (3) L13 D2-1 spike/D2-7/D2-8 + L5 D10-7/8 → (4) L6 D12-9/10 (website draft PR). D10-4/5 stay blocked on the
lawyer sign-off. D18/D19/D20 research (Nuvemshop parity, quick check + offline hand-off, plugin setup UX) was written after this plan
and is not scheduled — ask Roger whether it becomes Wave 4.

Parked: D13-15, D16-10/11, D6-14, D2-10, D7-15, D8-18, D10-9, D11-13, D14-10, fraud flags.

## Test stores and fixtures

| Store                          | Test orders                           | Notes                                                              |
| ------------------------------ | ------------------------------------- | ------------------------------------------------------------------ |
| Shopify haychat-2              | —                                     | needs app install/token for the local staging server (Needs Roger) |
| Nuvemshop (Roger's test store) | —                                     | needs app/token for staging (Needs Roger)                          |
| WooCommerce demo :8085         | seeded order #1, customer@example.com | local, no Roger needed                                             |

Staging seed: org/user created via `auth.register` (credentials in `../hay-core-staging/.staging-login`, untracked).

## Needs Roger
All 86 items were answered on 2026-10-28 (questionnaire https://claude.ai/artifact/PGDLNwQ2oSg71qpH4vQHKc, collection `answers`). What is still on Roger is under "Still on Roger" below.

## Roger's answers (2026-10-28)
**Merge / deploy**
- PR #104: merge all of Waves 0–3 in one PR; deploy is a separate gated step.
- `channelAiModes` not breaking (`draftsChannels` never reached master). Root lockfile clean (fresh clone + `npm install`, no diff).
- Shopify scopes: two steps. Now: `write_order_edits`, `write_discounts` (toml PR). Later, after Shopify approves the protected ones: the 3 dispute scopes.
- Release runbook: yes. Already merged: backoffice #3–#6, website #44, #45. Open: backoffice #7, website #46, #47, hay-shopify-app#1.
- Deploy rebuild: Claude to check deploy.sh. The read-only ssh read was blocked by the classifier, so Roger runs it (see Still on Roger).
- AddUploadConversationLinks: tables small, run normally. Email merge: ship it, fix hay-docs.
**Money / safety**
- Billing: 72 h reversal for confirmed + assumed; staff close on an AI-resolved chat bills; human answered the original request + AI a later one → stays AI-resolved (billed).
- Exclusions: keep minimum of 1; tie the period to the billing period (not calendar month); build both the backoffice billing fix and the approve/deny UI now.
- Retro credits: size first (D1-0 query), then decide.
- Approvals: keep L4 defaults; keep W2 L4 scope but enforce typed confirm in the API; hold destructive writes (new class).
- Shopify cancel: refund by default (Roger asked whether that could be a problem; see ticket B3 for the guard).
- Disputes: require a plugin match (drop text fallback); keep defaults (owners/admins attach, 48 h, 120 d, templates, update_dispute held).
- Simulation caps per plan: "20 % capped at 500" (read as 20 % of the plan's monthly resolutions, max 500. Confirm).
- Swaps: no price-difference refund; hand off to a human.
- Customer ids: HMAC-signed external id from the store.
- Turnstile: enable for every org now.
- Media, MP, Woo connect, sessions defaults: keep.
- Vision EU: change. Don't block vision just because an org is EU (no EU inference exists yet). EU inference to be discussed separately.
**Copy**
- Hand-off line OK; evidence pack wording OK; perf page content approved, publish after a prod re-measure AND the hay.chat homepage fix; Messenger tag keep; push defaults keep (ticket the icon); shopify.njk H3: fix now.
**Defaults**
- L3, L7a OK for now; L7b, L12a, L12b keep all; staging OpenAI key OK.
- L11 keep, no retention prompt. No live customers, so a future default change can be applied to all orgs automatically.

## Tickets from Roger's answers
Roger said "Do it now" for every gap. Not started; lanes below.
- **Lane A: billing & exclusions** (hay-core + hay-backoffice)
  - A1 Exclusion cap + usage page use the billing period from the access state (replace UTC calendar month; remove the TODO).
  - A2 Backoffice bills from `billableResolutions` and credits exclusions made after overage was reported.
  - A3 Hay.chat approve/deny UI + API for `pending_review` exclusions.
  - A4 Simulation allowance per plan = 20 % of plan resolutions, capped at 500 (backoffice sets `limits.maxSimulationsPerMonth`). Pending Roger confirming the reading.
- **Lane B: approvals & tool safety**
  - B1 Enforce typed confirm in the API.
  - B2 Destructive risk class, always held: Zendesk deletes/helpdesk config, Twenty `delete_record`, Cal.com `cancel_booking`.
  - B3 Shopify cancel refunds by default (`refund_to_original_payment` default true) when the order is unfulfilled and has one payment method; otherwise the agent must pass it explicitly. Approval still holds every cancel (threshold 0).
  - B4 Refund tools send a currency.
  - B5 Klaviyo `upload_image_from_file`: no host file paths (URL/base64 only).
- **Lane C: disputes**
  - C1 `matchOrder` requires a plugin match (drop the text-mention fallback).
  - C2 `disputesService.report` returns a fresh `alertedAt`.
  - C3 Write a rationale doc for Roger: why disputes, what we do, what we never do.
- **Lane D: abuse & identity**
  - D1 HMAC-signed `customerExternalId` (per-org secret; unsigned → fresh customer).
  - D2 Enable Turnstile for all existing orgs (data script). CSP on real stores still unchecked.
  - D3 Spam/bot gaps: analyse files after "Not spam"; vision skip when Cloudflare is down; "Not spam" undoes LLM-classifier spam.
- **Lane E: vision** E1 EU orgs get vision on the default endpoint when no EU endpoint is configured (stop failing closed).
- **Lane F: simulations, tests, insights**
  - Monthly-cap lock on concurrent starts.
  - Simulation items covered by retention.
  - Playground feedback creates no insight issues.
  - Web Chat greeting hidden when Web Chat is Off.
  - Agent page strings to i18n.
  - Docs-audit records token usage.
  - Digest marks sent only after sending.
  - Archive-suggested outside the 90-day window.
  - Insights component tests.
  - Gorgias import in the background (no 100 cap).
- **Lane G: exports & lifecycle**
  - Chat attachments in the export ZIP.
  - Plan-change email for portal changes (backoffice).
  - Retry failed deletion events.
  - Verify the D15-4 holding reply on drafts-only + test mode.
  - Evidence PDF: emoji font, fetch remote attachments, page cap, policy text at the time.
- **Lane H: commerce plugins** Catalogue deletions synced; Wix/Magento stale flag; coupon-per-customer check beyond 100; Woo pending connects survive restart.
- **Lane I: tooling, docs, web**
  - Dashboard vitest excludes Playwright specs.
  - CI webchat job on staging too.
  - MJML notification padding + translations warning.
  - hay-docs: remove the Email plugin.
  - PR #104 body: drop the X-Forwarded-For line.
  - shopify.njk H3 → "Every Shopify conversation in one place" (in #46).
  - hay.chat homepage FCP/LCP (fonts/CSS render-blocking, main-thread JS).
  - hay-shopify-app toml PR (step 1 scopes).
  - Release runbook `tasks/release-waves-0-3.md`.
  - Maskable icon (designer asset).

## Still on Roger
- Run: `ssh homeserver 'grep -n -i -E "build|plugin|sdk" /srv/hay-core/deploy.sh'`. Does deploy rebuild packages/plugin-sdk + stripe/shopify/mercadopago/woocommerce plugins?
- Resend: Roger thinks it's done. Check Infisical prod has `RESEND_API_KEY` + `RESEND_EVENTS_WEBHOOK_SECRET` (`~/bin/infisical-env.py check`).
- Confirm the simulation-cap reading (20 % of plan resolutions, max 500).
- Deferred to a Claude-in-Chrome session: prod env keys (Turnstile, VAPID, OPERATOR_EVENTS_URL/INTERNAL_API_SECRET, SMTP_FROM_NAME, JWT_REFRESH_EXPIRES_IN check, Meta, MP, OpenAI EU), Meta Messenger setup + App Review, Mercado Pago app, OpenAI EU application, Stripe test-mode plan changes, WABA checks, real-store checks, connecting test stores to staging.
- Deferred: disputes real tests (after the C3 rationale doc), iPhone push test (can run before deploy: staging over an https tunnel + VAPID keys), WP 1.0.1/1.1.0 svn release, lawyer questions, read-only prod checks (D1-0, D14-1, D3), merchant comms, Spanish alert + widget locale native checks, legal copy in website #46.
- After deploy: Claude does the D8 media-private switch (needs Roger's go-ahead then).
- Discuss: EU inference strategy.

## Follow-ups logged (not in Wave 0 scope)
- L7: Messenger long-lived user token (~60 d) has no refresh and page tokens are lost on worker restart (reconnect needed); after a same-channel merge new messages can join the target's active conversation; merge suggestions only on hidden /customers pages (add to conversation panel); Resend message_id field name unverified; WhatsApp quality updates for multi-number accounts; complaints not shown in UI; Instagram setup step 1 still mentions Facebook Login.
- D8b: scanned PDFs (no text layer) not read; spoken card numbers in voice transcripts not redacted; with Read images off photos aren't classified so not blurred; Luhn filter may hide a 13–19 digit order number; `complete_product_case` offered on every conversation (description limits it); usage events have no sink yet (HAY-251); Playbooks "From template" dropdown description runs off the right edge.
- [D8] A file removed by the media sweep leaves a dead (404) attachment link in old messages. (Reopened widget not scrolling to the newest message: fixed on staging.)
- [D2] An order id like "2000012345678901" got indexed from tool input (long numeric ids); consider a length cap for order keys.
- [W2 L3] First D5-9 human reply after the shopper closed the tab sent no email (widget socket probably not yet cleaned up); the second did. Consider a short grace / re-check.
- [W2 L3] Business-hours UI: start/end time inputs stack vertically; "09:00 AM" mixes 24 h and AM/PM. Staging default schedule left as Wed 00:00–23:59.
- [W2 L4] Action log stores only error_code, so failed rows show the generic code text (e.g. "The store refused the request") instead of the reason (EMAIL_FAILED). Store details.reason in action_log.
- Perception misdetects language when an English message names a Brazilian brand ("Mercado Livre") → reply in pt. Language should follow the conversation/widget locale.
- Widget footer shows "Powered by Hay" — check whether it's the logo wordmark or text; text should read "Hay.chat".
- Woo resend handoff reply is generic ("passed this to the team"); could say the email couldn't be sent first.
- Woo AfterSettings.vue (plugin UI bundle) is not covered by dashboard typecheck.

- (W1 review) External/hosted MCP tools that annotate `readOnlyHint` skip the approval gate and dry-run on that word alone. Consider trusting the hint only from first-party plugins (HubSpot relies on remote annotations today).
- (W1) Conversations snapshot the playbook text at the first turn, and `playbooks.update` changes the playbook row but not its active version; an edited playbook only reaches new conversations after a publish. Expected, but worth a hint in the editor.
- (W1) Channel delivery retries live in memory; a restart during backoff drops them. Delivery-failed alert is push + toast only (no email).
- (W1) WhatsApp templates with media headers / header variables / URL-button variables are listed but can't be sent.

- (W1) Shopper gets silence when the run fails (malformed LLM JSON crashes `perception.layer.ts:101`; EU-only org with EU env missing). Should hand off / show a fallback line.
- (W1) Copy sweep: ~54 bare "Hay" strings in dashboard i18n (page titles "Hay Dashboard", settings llm/webchat copy) → "Hay.chat". Queue as one small X ticket.
- Staging plugin dist/ builds date from 9 Sep (WhatsApp still imports twilio; old Email worker fails) → rebuild plugins on staging before channel tests (`scripts/build-plugins.sh`). D20 left 16 disabled plugin_instances rows on the staging org (harmless).
- Suggest-integration: website + backoffice running (claude/suggest-integration in ../hay-website-suggest-integration and ../hay-backoffice-suggest-integration); then hay-core getting-started.vue link.
- **QUEUED (Roger 2026-10-27) — slot order (Roger OK to run research first): D19 RUNNING; next D20 (needs browser), then 1) email merge, 2) suggest-integration.**
  4. D20 Plugin setup UX research (no code): audit every plugin settings page on staging with the `impeccable` skill (critique/audit) + screenshots; classify merchant-facing vs env-managed backend fields; propose one standard layout (tabs Setup/Activity/Advanced; backend config hidden; Advanced mode toggle shows .env-set values as overridable with "Managed by Hay.chat" vs "Set by you" + reset); manifest/SDK mechanism (e.g. `advanced` flag / env-default detection) so plugins adopt it automatically, core stays plugin-agnostic. Output `seo/Engineering/02 Research/D20 Plugin setup UX.md` (D-file format, sized tickets, empty Roger's answers). Email merge = first adopter.
  1. Merge `plugins/core/email` (hay-plugin-email: `send-email` + healthcheck tools) INTO `plugins/core/email-channel` (hay-channel-email, keeps id → webhook URL). Delete plugins/core/email. Migration/handling for orgs with the old Email plugin installed (move or remove instances) → prod run on Needs Roger.
  2. Suggest-integration: hay-website page `/suggest-integration/` using the contact form pattern (`src/js/contact.js` → BO `/api/contact`, rate limit + captcha) + BO endpoint (`/api/contact/integration` or topic on /api/contact) emailing Hay.chat; PRs in both repos. Then hay-core `dashboard/pages/getting-started.vue:126` Canny link → new page (check other canny refs).
- **QUEUED research (Roger idea 2026-10-27, research only, no code):** "quick check" flow — AI asks a team member a fact without a hand-off ("I don't have that, give me a moment"), 5-min "still looking", 10-min "someone will get back to you" + close; offline hand-off settings (ticket via Zendesk plugin / email / inbox when no one is available; collect contact); answered facts → Insights knowledge-gap → suggested doc create/edit with owner approval. Write `seo/Engineering/02 Research/D19 Quick check and offline hand-off.md` in the D-file format (Why, current code, options, recommendation, sized tickets, empty Roger's answers). Relates to D5-6/7/8, D3 engine, D13 window, billing outcome. Spawn when a slot frees.
- Conversations list pager ignores status filter (Unresolved: 1 row, "Page 1 of 3"). Hand-off verdict: human answered the original request but AI-resolved verdict billed it — product call for Roger (in Needs Roger). L11: make `ChatOptions.organizationId` required; startup warning if EU org without EU env; bare "Hay" in llmSettings strings.
- **QUEUED (Roger request 2026-10-27):** widget "Marina joined the chat" / "Marina left the chat. You're chatting with the AI assistant again." system notices on takeover/release (stored as system messages, survive reload, first name only), and human messages show `10:42 · Marina`. Widget only (not WhatsApp/email). en/pt-BR/pt-PT. L6 + server takeover/release paths. Start when an agent slot frees.
- Every follow-up widget send hits NONCE_EXPIRED then retries (nonce race between polling getMessages / WS / sendMessage?) → doubles send requests; investigate in L1/L6. Refused first message leaves an empty conversation (create before send). Unread badge counts all agent messages since the shopper's last one.
- Web 72 h reversal only works for identified shoppers (anonymous web visitors have no customer_id; widget starts a new conversation after close) → L6/L1 visitor id. Close-classification job throughput ~30/min (batch 5 per 10 s). Reversal after overage reported → backoffice credit (D1-6).
- **Widget CSS isolation:** host page global `button{…}` styles hide the widget's send/close icons (no shadow DOM). L6 ticket: shadow DOM or scoped reset.
- Widget greeting not translated for pt-BR shoppers (store's English greeting shown). Conversation detail header shows "Loading…" when untitled.
- After deploy, a cached old loader (≤5 min) can request a deleted chat chunk → keep previous build's assets on deploy. Empty pre-D9-4 conversations remain (L1: skip/delete in checkInactivity). Delete stale `server/public/widget.css`. CI size budget for the loader (D12-9). Document `loading` option.
- **Decision for Roger (strict consent mode):** without consent the DPoP key lives only in memory, so reload can't resume; option = extractable key in sessionStorage (weaker). Recommendation: leave as is.
- L9 tested 2026-10-27: D3-2 ✓ (404s, no nav links), D3-3 ✓ (Open conversation highlights message; heartbeat pauses hidden, resumes on show), D5-1 values correct in API but cards 0 because DateRangeSelector presets end at midnight today → claude/wave0-test-fixes. GIFs D3-2-D5-1-analytics-404-and-dashboard-metrics.gif, D3-3-feedback-open-conversation.gif.
- **Widget restore on reload broken in default consent mode** (pre-existing, ~HAY-85): no sessionStorage read before consent; after consent no DPoP keypair → new conversation + customer. Shopper waiting on hand-off loses the thread on reload. High priority, L6 Wave 1 (with D9-4).
- widget.js served `Cache-Control: max-age=604800` → shoppers run old builds up to 7 days after deploy (D12-6 hashed chunks/short loader cache).
- Review plausibles not fixed: reply-guard `findById` loads all messages per check (slim query); GDPR erasure doesn't delete `/v1/media` or S3 files (delete by attachment id); 2-min refresh grace hands current token to old-token holder (by design).
- Minor: sentiment gauge "50% Fair" with no data; offline dashboard shows empty states without error; widget textarea maxlength 1000 vs server 4000; tRPC 401 includes stack traces in dev.
- Widget header says "We typically reply within minutes" permanently — false promise (give to L6 D12-8 or D5-10).
- Shopify `returnProcess` refund tool (D6-1 part 5) → its own ticket + dev-store test. Wix/Magento structured errors when prioritised.
- Inactivity easy-tier model `gpt-4.1-nano` deprecated → in D5-2 fix.
- Widget: no shopper feedback when create is refused (403/429) — message just vanishes (L6).
- Widget media: sign attachment URLs in `public-conversations` getMessages + WS push with `signAttachmentUrls` (L1, before D8-9).
- WS `identify` (read side) needs no DPoP; WS auth ignores tokenVersion; `getMessages` not rate limited (L1).
- Per-org create burst (600/min) can be used to lock out an org's shoppers → Turnstile / under-attack mode (D9-9/10).
- HEIC: needs heic-convert or libvips with libde265 (L8).
- run.ts: available + custom instructions branch never sets `pending-human`; small take-over race before hand-off update (L3).
- `organizations/[id]/index.vue` still binds `Checkbox v-model:checked` (check Checkbox API) (L9).
- Woo plugin: dashboard Enable fails "Required field WordPress Site URL is not configured" with an empty form (also on master); configuring while disabled leaves testConnection "unconfigured" until reconfigured after enable; health check says "no safe read-only tool" although woocommerce_get_store is readOnly.
- AI shows Woo amounts as "$64.00" for an EUR order (currency not passed through) (L5).
- Woo refunds default to the gateway (`refund_payment` true); bank transfer / COD / cheque stores need the manual-record path → playbook guidance or a merchant setting (L5).
- Stripe refund amounts are in cents, so the money threshold over-holds them (safe) (L4 follow-up).
- Klaviyo `upload_image_from_file` reads any file path on the worker host → restrict or remove (security).
- Retry for WhatsApp delivery is in-memory; shopper gets no message when a run fails; check "Powered by Hay" footer wordmark (→ Hay.chat); WhatsApp plugin page showed "An error has occurred" once.
- AI invents shop facts without a knowledge base ("yes we ship to Germany") — guardrail topic, not Wave 0.

## Working notes
- Manual-test GIFs live outside the repo: `seo/Engineering/04 Feature guides/_test-gifs/`.
- Agent tests use DB `hay_test` (same Postgres :5433) + Redis db 1, never `hay_staging`.
- Staging shop test page: scratchpad `staging/shop/index.html` served on 127.0.0.1:8090 (org 3383b5a0…, "Casa Aurora Demo").
- Observed at baseline: Conversations header shows a made-up "-17% from yesterday" trend (D3-2 scope).
- Chrome: Browser 1 is this Mac (verified by loading the 127.0.0.1-only page).

- Main checkout `.env` points at the DO managed DB (`pilot`) and has a live Stripe key: never copy it, never run
  migrations from the main checkout.
- `origin/staging` existed (auto-synced = master) before this session; reused it.
