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
**Prod env:** VAPID_*/RESEND_*/EMAIL_INBOUND_DOMAIN all live (two `deploy.sh --env-only` runs today; the Resend key was upgraded from send-only to full access by Roger).
**Next:** nothing pending in hay-core; see /srv/hay/WIP.md for backoffice (Snov.io removed, admin billing controls, one migration for Roger to run).

## 2026-10-26 — master — three follow-up fixes merged + deployed (merge-gate session, part 2)

**Merged to master:** fix-wait-time-units (82a04f2: formatWaitTime shows two largest units, "3d 4h"; 6 vitest), fix-manage-middleware (b626a21: dropped dangling `middleware: ["auth"]` on /integrations/plugins/manage; `dashboard/tests/route-middleware.test.ts` guards every named middleware), fix-sdk-register-tests (removed legacy `register.ui()` / `uiExtensions` from plugin-sdk + server metadata; SDK suite 134/134, was 5 failing).
**Checks on master:** dashboard nuxt typecheck, server tsc, eslint on changed files, SDK build: all clean.
**Live-verified in Chrome after deploy (b626a21):** manage page renders, no "Unknown route middleware"; Inbox shows "Longest wait: 336d 21h" and rows "Waiting for 336d 21h".
**Follow-ups:** dashboard has no `test` script / vitest config (new tests run via `npx vitest run` from dashboard/); `PluginMetadata` on the server lacks a `pages` field the SDK emits; prod env VAPID_*/RESEND_*/EMAIL_INBOUND_DOMAIN now set via Infisical + `deploy.sh --env-only` (Inbox offers "Alerts on this device"); backoffice billing branches merged/migrated/Stripe-synced/deployed (notes in /srv/hay/WIP.md); worktrees under .claude/worktrees/ for the three fix branches can be removed.
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
