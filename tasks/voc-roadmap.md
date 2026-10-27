# VOC roadmap — orchestration source of truth

Started 2026-10-27. Research: `/Users/rogerjunior/Documents/code/hay/seo/Engineering/02 Research/` (D1–D16; each file's
"Roger's answers" block overrides its recommendations). Research baseline: origin/master 3e6ede1.

## Resume here (orchestrator checkpoint — keep current; safe to /compact after reading this)
- Last update: 2026-10-27 evening. Staging HEAD: see `git log -1 staging`.
- Wave 0 merged: L2 (2cf8ee5) ✓, L1 (6ae259f) ✓, L8 (b2a60d7) ✓, L3 (b5a4120, tester agent running), L9 (538bfea, manual test queued — use report steps: /analytics 404, dashboard Top Agents real + Avg Response Time card, Conversations header no fake trend, heartbeat resumes after tab hide/show, Feedback nav → Open conversation scrolls to message).
- Running: L5 Shopify agent (claude/d6-shopify-guards, D6-1, D6-4); tester for L3.
- Wave 0 still to start: L10 (D11-3, D11-4 refresh tokens; owns dashboard/utils/api.ts + stores/auth.ts), L6 (D12-8 widget hygiene; also remove dead WS loadHistory/sendMessage in webchat per L1 follow-up), X: D1-4 backoffice (also read `billableResolutions`, tolerate lower totals), D12-2 (WP plugin real source haychat-svn/trunk + Shopify app embed), D15-1 (Stripe portal: rename button to "Manage or cancel plan", explicit cancel entry point; portal already has cancel at period end + reason ON).
- Then: Wave 0 review agent over `git diff 5bfee16..staging` → fixes → tag `wave-0-done` → PR staging→master with body (tickets, migration AddConversationHandedOffAt1784600000000, tests, manual results + GIFs, Needs Roger, and the D8 after-deploy steps: deploy → `docker cp scripts/make-media-private.cjs hay-server:/tmp/` → dry run → `--apply` → `doctl compute cdn flush <id> --files 'uploads/*'` (hay-ams ff84a7bc-8770-4a41-af22-2192d46e9473, hay d67a8597-cd2c-4825-b902-a788706e0647) → Spaces listing Restricted → check old URL 403; image needs sharp's optional Linux binaries).
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

## Wave 0 — security, honesty, quick fixes (tag `wave-0-done`)

Agent branches (one per lane):

| Lane | Branch                                                  | Tickets (order)                                      | Status            |
| ---- | ------------------------------------------------------- | ---------------------------------------------------- | ----------------- |
| L1   | claude/d9-public-widget-hardening                       | D9-1, D9-3, D9-2, D3-1, D12-1                        | queued            |
| L2   | claude/d1-billing-honesty                               | D1-1+D7-1, D1-2                                      | queued            |
| L8   | claude/d8-private-media                                 | D8-1, D8-2                                           | queued            |
| L3   | claude/d5-honest-handoff                                | D5-2, D5-3, D11-1, D11-2                             | queued (after L2) |
| L9   | claude/d3-dashboard-trust                               | D3-2 (delete Analytics+Reports), D5-1 (=D11-6), D3-3 | queued (after L2) |
| L5   | claude/d6-shopify-guards                                | D6-1, D6-4                                           | queued            |
| L10  | claude/d11-session-refresh                              | D11-3, D11-4                                         | queued            |
| L6   | claude/d12-widget-hygiene                               | D12-8                                                | queued            |
| X    | backoffice claude/d1-4-metering-integrity               | D1-4                                                 | queued            |
| X    | WP plugin (haychat-svn/trunk) + hay-shopify-app-haychat | D12-2                                                | queued            |
| X    | D15-1 (Stripe portal stopgap)                           | D15-1                                                | queued            |

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
- **Before deploying Wave 0 (answered 2026-10-27):** (a) allowed-domains enforcement: Roger OK. (b) Proxy checked read-only on homeserver: Traefik v3.6 (`coolify-proxy`) static config has no `forwardedHeaders.trustedIPs`/`insecure`, so it ignores client X-Forwarded-For and sets its own; eu.hay.chat → 94.63.38.3 (house IP, no Cloudflare proxy, no cf-ray) → per-IP limits see the real visitor IP. (Dynamic dir `/data/coolify/proxy/dynamic` unreadable without sudo, but entrypoint forwarded-header trust can't be set there.) (c) D8 media switch-over: Roger asked me to do it after he deploys. Plan: run a one-off script inside `hay-server` (it already has `@aws-sdk/client-s3` + its S3 env) that sets ACL private on `uploads/*/{conversation-media,documents,plugin-zips}/`; then `doctl compute cdn flush` for the prod bucket's CDN (CDNs exist for hay-ams.ams3 and hay.sfo3); verify an old media URL returns 403 and an old WhatsApp photo still renders. Needs permission to run commands inside the prod container (the classifier blocked reading its env).
- **Copy:** neutral hand-off line until D5-6/7 — en "I've passed this to the team. They'll reply to you here in this chat." / pt "Encaminhei sua mensagem para a equipe. Eles vão te responder aqui neste chat." OK? Planner local time is hour-precision to keep prompt caching.
- **Decision (D1, Wave 0):** inactivity closes (incl. "hi" then silence) are still billed until D1-3's close classifier lands; the pricing page says unresolved chats don't count. Keep billing (agent's recommendation; pull the D1-12 pricing copy forward) or add a one-line exclusion now (revenue drops)? Default: keep, until you say otherwise.
- **Backoffice:** read `billableResolutions` (fallback `resolvedConversations`) in `hay-api.ts` / `usage-tracking.service.ts`; overage delta logic must tolerate a lower total (folded into the D1-4 X ticket).

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
