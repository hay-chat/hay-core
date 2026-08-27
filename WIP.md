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
1) DEFAULT_TIER_MAP openai.hard gpt-4o → gpt-4.1 (cheaper + better; env-overridable
   via LLM_TIER_HARD). medium deliberately left on gpt-4o-mini (4.1-mini ~2.6x input).
2) Tier routing: 4 guardrails + handoff summary + closure validation + greeting
   translation + fallback composition → medium; title, inactivity, closure msg,
   closing msg, handoff msg → easy. Planner stays hard.
3) Anthropic had zero caching — added 3 cache_control breakpoints (tools, system,
   transcript tail) in anthropic.provider.ts, each gated at 4096 chars. OpenAI/Gemini
   cache prefixes automatically and prompt assembly was already stable-first.
4) UsageRecord.cachedPromptTokens across all 3 providers + hit-rate in the LLM debug log.
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
