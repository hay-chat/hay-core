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
dump headers of a Gmail-forwarded mail, confirm In-Reply-To/References + Message-ID control). Uncommitted: WIP.md, docs, tasks/*.

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
