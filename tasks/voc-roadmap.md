# VOC roadmap — orchestration source of truth

Started 2026-10-27. Research: `/Users/rogerjunior/Documents/code/hay/seo/Engineering/02 Research/` (D1–D16; each file's
"Roger's answers" block overrides its recommendations). Research baseline: origin/master 3e6ede1.

## Resume here (orchestrator checkpoint — keep current; safe to /compact after reading this)
- Last update: 2026-10-27 ~19:45. Staging HEAD d64da73 (+ roadmap commits).
- Wave 0 merged into staging: L2, L1, L8, L3 + D5-2 fix (a0b0220), L9, L5 (24818be), L10 (824abf1), L6 (d64da73). Migrations ran on hay_staging + hay_test.
- Wave 0 DONE: review fixes (b8f3bb5) + test fixes (e4d48c2) merged and retested ✓ (single greeting, KPI cards include today, feedback filter/export). Full suites green (server 963, dashboard 38, webchat 71, sdk 143). Tagged `wave-0-done`; PR staging→master opened. NEXT SESSION: Wave 1 per table below (fresh orchestrator session; start with widget restore-on-reload bug in L6 with D9-4).
- Wave 1 (2026-10-27 night): L6 merged 3acc19a + ca54167 → tested ✓ (incl. disabled widget never downloads chat). L2 merged c40e1e7 + 728066a → tested ✓ 7/7 (confirmed billed, unhappy→unresolved, greeting abandoned no LLM, hand-off AI-resolved billed, playground test, 72 h reversal, GIFs W1-D3-8-*, W1-D5-5-*, W1-D1-3-*). L11 merged 816f879 + 6d2851e (EU-only per org, fail closed; no migration; not browser-tested yet — needs mock EU endpoint + server env restart). Race fix 31c75f1, join notice e460496, inbox fix 4173f19 → all tested ✓ (6/6 first messages answered, greeting before customer msg; Return to AI no re-handoff + answers held question; joined/left lines en+pt, payload only {systemEvent, agentFirstName}; Inbox opens pre-onboarding). GIFs W1-race-*, W1-agent-joined-notice(-pt), W1-inbox-before-onboarding. Bug: pt-BR greeting stored in English (create-time greeting has no locale) → fixed 4ca6cdf (widget sends locale on create; pt-BR → pt; greeting translated at create), manual pending. D19 research done (seo 1eb6f84). D20 research done (seo 5091501: 13 tickets, quick-fix D20-1 first; page scored 16/40). Email→Email inbox merged 07c4b8c (migration MergeEmailPluginIntoEmailInbox1785300000000 ran on staging+test; old-only installs moved in place; refs rewritten). Suggest-integration: PRs hay-backoffice#5 + hay-website#45, dashboard link 2150f03. All plugins rebuilt on staging 22:02. Tested ✓: greeting pt-BR (create sends pt-br, language pt, greeting Portuguese, no English flash), Email inbox merged UI + playbook picker, suggest link en/pt (GIFs W1-greeting-pt, W1-email-inbox-merged, W1-suggest-integration-link). Bug found + fixed d54f287: plugin connection check could call ANY tool (fell back to first tool; ignored snake_case input_schema) → called send-email; now only health or read-only no-param tools, else worker-alive check (verified healthy on staging, unit test 4/4).
- 22:45 L11 tested ✓ on staging with mock EU endpoint: Settings → AI Models toggle saves (toast, banner that provider/models are unused), chat call went to EU base URL with EU key; with EU env removed the run throws AiRegionUnavailableError and nothing is sent elsewhere (fail closed). GIF W1-D14-eu-only-toggle-and-routing. Org reset to default region. Running now: L10 (claude/w1-push-hygiene, D11-5/D11-8) + L7 (claude/w1-whatsapp-templates, D13-7, D13-1..5).
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

Parked: D13-15, D16-10/11, D6-14, D2-10, D7-15, D8-18, D10-9, D11-13, D14-10, fraud flags.

## Test stores and fixtures

| Store                          | Test orders                           | Notes                                                              |
| ------------------------------ | ------------------------------------- | ------------------------------------------------------------------ |
| Shopify haychat-2              | —                                     | needs app install/token for the local staging server (Needs Roger) |
| Nuvemshop (Roger's test store) | —                                     | needs app/token for staging (Needs Roger)                          |
| WooCommerce demo :8085         | seeded order #1, customer@example.com | local, no Roger needed                                             |

Staging seed: org/user created via `auth.register` (credentials in `../hay-core-staging/.staging-login`, untracked).

## Needs Roger
- **Email merge (on staging):** after deploying, run `migration:run` on prod (MergeEmailPluginIntoEmailInbox1785300000000; irreversible; run AFTER new code is live; deploy must rebuild plugins). Merchant-visible: "Email" plugin disappears; notifications now from "<store>" <support@updates.hay.chat>; support address optional in form. hay-docs may still list the Email plugin.
- **Suggest-integration:** deploy hay-backoffice#5 BEFORE hay-website#45 (form posts to the new endpoint). No new env (uses CONTACT_NOTIFY_EMAIL, reCAPTCHA keys). hay-website build's `check:schema` fails on 3 pre-existing /docs/technical/ pages.
- **Billing (D1-3 merged on staging):** hand-offs now bill when the AI resolved them, silent closes after a real answer bill and are reversed if the shopper returns within 72 h → pricing page/FAQ copy (D1-12, website `pricing-machine-readable.njk`, `pricing/*.locale.js`) must change in the SAME release. Confirm: 72 h reversal applies to confirmed AND assumed outcomes (agent's choice, Intercom-like). Staff `closed` on an AI-resolved chat now bills. Retroactive credits need D1-0 sizing + a re-classify script (hay-core) + Stripe credit notes (backoffice); not built.
- **EU (D14-4 on staging):** apply for OpenAI EU data residency; confirm gpt-4.1, gpt-4o-mini, text-embedding-3-small, gpt-4o-mini-transcribe on the EU project; then set `OPENAI_EU_BASE_URL`/`OPENAI_EU_API_KEY` (+ optional `OPENAI_EU_TIER_*`) in Infisical prod. Switch hidden until set. Note: orgs with their own provider now really get it on perception/guardrail/planner calls (were silently on env default).
- **Billing verdict check:** in a hand-off where the human answered the original request and the AI answered a later question, the classifier billed it as AI-resolved. OK, or should a human-answered original request make it `human`?
- **PR #104 now also contains Wave 1 commits** (building continues on staging): merge tag `wave-0-done` if you want Wave 0 only.
- **Shopify cancel default (D6-1):** cancelling no longer refunds unless the agent passes `refund_to_original_payment: true` (explicit false sent otherwise). Should Shopify cancels refund by default?
- **Before deploying Wave 0 (answered 2026-10-27):** (a) allowed-domains enforcement: Roger OK. (b) Proxy checked read-only on homeserver: Traefik v3.6 (`coolify-proxy`) static config has no `forwardedHeaders.trustedIPs`/`insecure`, so it ignores client X-Forwarded-For and sets its own; eu.hay.chat → 94.63.38.3 (house IP, no Cloudflare proxy, no cf-ray) → per-IP limits see the real visitor IP. (Dynamic dir `/data/coolify/proxy/dynamic` unreadable without sudo, but entrypoint forwarded-header trust can't be set there.) (c) D8 media switch-over: Roger asked me to do it after he deploys. Plan: run a one-off script inside `hay-server` (it already has `@aws-sdk/client-s3` + its S3 env) that sets ACL private on `uploads/*/{conversation-media,documents,plugin-zips}/`; then `doctl compute cdn flush` for the prod bucket's CDN (CDNs exist for hay-ams.ams3 and hay.sfo3); verify an old media URL returns 403 and an old WhatsApp photo still renders. Needs permission to run commands inside the prod container (the classifier blocked reading its env).
- **Copy:** neutral hand-off line until D5-6/7 — en "I've passed this to the team. They'll reply to you here in this chat." / pt "Encaminhei sua mensagem para a equipe. Eles vão te responder aqui neste chat." OK? Planner local time is hour-precision to keep prompt caching.
- **Decision (D1, Wave 0):** inactivity closes (incl. "hi" then silence) are still billed until D1-3's close classifier lands; the pricing page says unresolved chats don't count. Keep billing (agent's recommendation; pull the D1-12 pricing copy forward) or add a one-line exclusion now (revenue drops)? Default: keep, until you say otherwise.
- **X-ticket PRs to review/merge/deploy:** hay-backoffice#3 (D1-4; prod `npm run migration:run` `1785200000000-TrackReportedOverage`; backfill bills nothing new; deployable before hay-core), hay-backoffice#4 (set `STRIPE_PORTAL_CONFIGURATION_ID=bpc_…` in prod), hay-website#44, hay-shopify-app#1 (`shopify app deploy`, check haychat-2 widget still styled).
- **WP plugin 1.0.1:** apply `/Users/rogerjunior/Documents/code/hay/haychat-svn-patches/1.0.1-d12-2-no-render-blocking.patch` in haychat-svn (`patch -p0` from the svn root), `svn cp trunk tags/1.0.1`, svn commit (= WP.org release). php not installed here, so not linted.
- **Sessions (D11-3):** a reused old refresh token after the 2-min grace now ends the whole session (reuse detection, beyond the D-file); confirm prod `JWT_REFRESH_EXPIRES_IN` is 30d before the legacy branch is removed; basic auth no longer returns X-Access-Token headers.

- Prod: D1-0 over-billing query; D14-1 prod `LLM_*` values; D8 confirm Spaces before switching media private; D3
  whether 26 Oct features are on for every org.
- OpenAI EU data-residency application (D14). WhatsApp App Review status (D13-6).
- Lawyer: Art. 132 deadline counting (D10); captcha under strict consent (D9).
- Shopify re-consent rollout + merchant comms; Stripe credits for past over-billing; price-change notice sends.
- Merge each wave PR to master; every deploy.
- Connect test stores to the **local staging server**: Shopify haychat-2 app/token, Nuvemshop app/token, WhatsApp test
  number (channel tickets).
- Confirm it's OK that staging uses the `OPENAI_API_KEY` from the main checkout's `.env` (nothing else copied).

## Follow-ups logged (not in Wave 0 scope)

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
