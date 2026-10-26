# Billing: currencies, usage alerts, overage switch, in-place plan change (2026-10-26)

Slice 2 of the "fix or stop claiming" list (`tasks/prospect-faq-answers-2026-10-26.md`, items 1-3).
Three repos, three stacked branches, land one at a time:

| Repo           | Worktree                                 | Branch                                   | Based on                                                           |
| -------------- | ---------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| hay-backoffice | `/srv/hay/wt-billing-currencies`         | `claude/billing-currencies-usage-alerts` | `claude/overage-billing` (unmerged, owns the metered overage item) |
| hay-core       | `.claude/worktrees/claude+billing-usage` | `claude/billing-usage-limits`            | `claude/agent-pause` (unmerged, owns `parkForPausedAgent`)         |
| hay-website    | `/srv/hay/wt-website-billing`            | `claude/billing-change-plan`             | `main`                                                             |

## Goal

1. Stripe catalog carries EUR, USD, GBP and BRL (the prices the site already shows); a customer checks out in
   one currency and stays in it.
2. Usage warnings at 50 %, 80 % and 100 % of the included resolutions: email at each, dashboard banner from 80 %.
3. Account setting "allow extra resolutions" (overage), on by default. Off + 100 % → the AI pauses until renewal
   or upgrade, humans keep working, nothing extra is billed.
4. "Change plan" on hay.chat/billing changes the existing subscription in place (prorated), never a second one.

## Acceptance criteria

- [ ] `billing-plans.json` is the single source of prices in four currencies; `npm run stripe:sync` writes them as
      Stripe `currency_options` on the existing lookup-key prices (flat + metered), idempotently.
- [ ] `POST /api/billing/checkout` with no live subscription → Checkout in the requested currency (default EUR).
- [ ] `POST /api/billing/checkout` with an active subscription → `subscriptions.update` swapping flat + overage
      items, `proration_behavior: create_prorations`; response `{ action: "changed" }`; same plan+interval → 400.
- [ ] `Subscription.currency` stored; overview/plans/emails show amounts in that currency.
- [ ] Annual plans: allowance for the period = monthly allowance × 12 (fixes the annual metering bug).
- [ ] Usage job: crossing 50/80/100 % sends one email per threshold per period (dedup in `email_send_log`);
      ≥ 80 % pushes a dashboard notice; 100 % notice says overage billing started or the AI is paused.
- [ ] `Account.overageEnabled` (default true) editable via `POST /api/billing/settings`; off + 100 % → hay-core
      `agentPause: { reason: "usage_limit" }`, no meter events; on again / renewal → pause lifted.
- [ ] hay-core: `internal.organizations.setAccessState` accepts `agentPause`; orchestrator parks conversations for a
      paused org exactly like a paused agent; `auth.me` exposes the fields; en + pt-BR notice strings.
- [ ] Tests: backoffice vitest (stripe.service, usage-tracking, account-access, billing route via supertest);
      hay-core jest (internal router, access service, orchestrator skip); Playwright spec for the banner.
- [ ] Docs: `docs/user-guide/faq.md` + `settings.md` billing answers match the product; website copy lines listed.

## Decisions (defaults taken, state in PR)

- Currency is chosen at checkout (plans page selector, pre-selected from the `hay_region` cookie) and locked to the
  subscription afterwards. Stripe forbids mixing currencies on one customer anyway.
- One Stripe price per plan/interval with `currency_options` (not 4× prices) so lookup keys and the Customer Portal
  keep working unchanged.
- All plan changes apply immediately with proration (upgrades and downgrades). Refund policy §4 must change.
- Overage off → AI pauses at 100 %; the dashboard stays usable and conversations land in Needs Attention
  (reuses `parkForPausedAgent` from `claude/agent-pause`). Hard suspension would lock humans out too.
- Email at 50/80/100, banner only at 80/100 (a 50 % banner is noise).
- Admin UI does not show currency/overage yet (follow-up TODO).

## Checklist

- [x] Read WIP, FAQ sheet, backoffice billing code, website billing.js, hay-core access state
- [x] Worktrees created, node_modules linked
- [x] Backoffice: billing-plans.json + PLAN_CONFIG + planPricing/includedResolutionsFor
- [x] Backoffice: sync script currency_options; verifyStripeCatalog currency check
- [x] Backoffice: migration 1785000000000 (subscriptions.currency, accounts.overage_enabled, accounts.agent_paused_reason,
      usage_records.alerted_threshold + included_resolutions)
- [x] Backoffice: checkout currency + changeSubscriptionPlan + route branches + /settings
- [x] Backoffice: usage thresholds (email template, send log, notice) + overage cap + access sync with agentPause
- [x] Backoffice: tests green (`npx vitest run` 11 files / 138 tests), `tsc --noEmit`, prettier
- [x] hay-core: types/entity/migration/service/router/run.ts/auth.me/store/i18n
- [x] hay-core: jest (49 tests in orchestrator/access/internal), typecheck, lint; Playwright spec written (not run: no stack)
- [x] hay-core: docs/user-guide updates (hay-docs `claude/billing-usage-docs`, submodule pointer bumped)
- [x] Website: billing.js currency, change-plan flow, overage toggle; `node --check` + prettier
- [x] Reviewer agent on the four diffs; findings addressed (see Results)
- [x] WIP.md entries in all three repos; branches pushed; PR bodies in `tasks/prompts/pr-billing-slice-2.md`
- [ ] Roger: force-push `claude/billing-usage-limits` (rebased onto master; the classifier blocked `--force-with-lease`),
      open the four PRs, `npm run stripe:sync` (test + live), both `migration:run`

## Working notes

- Backoffice `main` is at 8c171fe; `claude/overage-billing` (7 commits) is unmerged and holds the overage item code.
- hay-core `claude/agent-pause` was merged into master during this session → branch rebased onto origin/master
  (`git rebase --onto origin/master 7a98494`; conflicts in run.ts log shape and the shared note files).
- hay-core dev stack is not running locally (ports 3000/3001 are other apps; hay-core runs in Docker on 8088/8089).
- `gh` is not installed on this machine: PRs are opened from the compare URL with the body files in `tasks/prompts/`.
- hay-docs remote is https (no credentials); push with the ssh URL: `git push git@github.com:hay-chat/hay-docs.git <branch>`.
- Stripe SDK v20: `prices.create/update` take `currency_options`; `checkout.sessions.create` takes `currency`;
  `subscriptions.update` items take `{ id, price }` and `proration_behavior`.

## Results

Independent review (general-purpose agent, four diffs + task + acceptance criteria): 5 should-fix, 7 nits, 0 blockers.

| # | Finding | Outcome |
| - | ------- | ------- |
| 1 | Currency selectable again after a cancelled subscription; Stripe fixes the customer currency → checkout 500 | Fixed: `/plans` + `/checkout` lock to any previous subscription's currency; FAQ says contact support to change currency; tests |
| 2 | `pending-human` made sticky for every org (from the already-merged agent-pause branch) | Out of scope (shipped deliberately in agent-pause); FAQ now says parked conversations stay in Needs Attention until Return to AI |
| 3 | Renewal: `subscription.updated` moved the period but kept the counter → pause lingers until `invoice.paid` | Fixed: counter resets when the period start moves forward; tests |
| 4 | `alertedThreshold` never lowered when the allowance grows → no 80/100 % email after an upgrade | Fixed: `usage_records.included_resolutions` + reset to the threshold the new allowance reached; tests (upgrade + downgrade) |
| 5 | Past-due subscription lifted the usage pause | Fixed: sync loads ACTIVE + PAST_DUE, grace branch keeps `agentPause`; tests |
| 6 | Locked page ignored the region cookie | Fixed |
| 7 | Stale `Account` write after `subscriptions.update` | Fixed: account reloaded before `recordActiveSubscription` |
| 8 | Email sent before the dedup row | Fixed: send-log row claimed first, removed on failure; tests |
| 9 | FAQ copy not backed by code; month↔year switch invoiced immediately | Fixed in FAQ + website confirm copy |
| 10 | Dead code: unused `isAgentPaused`, exported `isCurrency`, duplicate `AgentPauseReason` | Removed / reused |
| 11 | `resetButton` innerHTML | Now `textContent` |
| 12 | Stale `overageRate` product metadata | `stripe:sync` deletes it |

Verification after fixes: backoffice `tsc` clean, vitest 11 files / 138 tests; hay-core server `tsc` clean, eslint clean,
Jest 49/49 in the touched suites (full run: 57 suites pass, 5 DB-backed integration suites fail with
`Driver not Connected`, no Postgres here); website `node --check` + prettier; dashboard `nuxt typecheck` clean.

# Inbound email channel — Phase 0 spike + Phase 1 MVP (branch claude/email-channel)

Spec: `tasks/email-channel-strategy-2026-10-26.md` (§4 threading, §4a forwarding model, §5 core changes, §6 phases, §7 defaults).
Defaults confirmed by Roger 2026-10-26: Resend inbound, forwarding first, dashboard is the reply surface, From
`"<Store> Support" <support@mail.hay.chat>` + Reply-To token, new plugin `plugins/core/email-channel` (`hay-channel-email`,
channel `email`), DMARC-fail/bulk → stored, not auto-replied.

## Phase 0 — spike (no product code)

- [ ] S1. Get Resend API access (prod SMTP_AUTH_PASS = Resend key, via Coolify env on homeserver; never print it)
- [ ] S2. Receive a Gmail auto-forwarded mail at the managed `<id>.resend.app` address; dump `headers` + `raw` → does
      `headers` include In-Reply-To / References / Auto-Submitted? Is `received_for` the original support@ address?
- [ ] S3. Send via Resend with custom `Message-ID`, `In-Reply-To`, `References`, `Reply-To` headers (API and SMTP) →
      which Message-ID does the recipient see? Is ours honoured?
- [ ] S4. Resend receiving GA vs beta; quota accounting; attachment URL expiry — write findings to the strategy doc §3
- [ ] S5. Add `inbound.hay.chat` receiving domain (API) + MX record on Cloudflare → verified

## Phase 1 — MVP (forwarding only)

Core (one commit each):
- [x] C1. `register.webhookRouting.signature.format: "svix"` (svix-id.svix-timestamp.body, whsec_ base64, `v1,` sigs) +
      `secretEnv: RESEND_WEBHOOK_SECRET`; routeKeyPath transform `"local-part" | "domain"` on `data.to[]`
- [x] C2. `messages.receive`: look up `findByExternalConversationId` first when `externalConversationId` given;
      accept `title` (subject) on new conversations
- [x] C3. plugin send: `email.send` tRPC capability (or extend `/send-email`) with from/replyTo/headers/attachments/
      messageId, returns the real Message-ID, surfaces failures (FAQ item 6, `plugin-api.service.ts:151-171`)
- [x] C4. (folded into plugin metadata: mid/subject/messageId/inReplyTo/references/holdReason) Message/conversation metadata shape for email (`metadata.email.{subject,from,to,cc,html,messageId,references,kind}`)

Plugin `plugins/core/email-channel`:
- [x] P1. Skeleton: package.json (`hay-plugin.category: channel`, `channel: email`), config (storeName, forwardingAlias
      read-only, idleAutoResolveDays), webhookRouting(svix), routes `/webhook` `/deliver` `/escalate` `/ui/*`
- [x] P2. Inbound: ack <15s → enqueue → fetch received email + attachments → classify (bounce/auto/bulk/echo/dmarc-fail)
      → reply-parser (strip quotes/signature) → thread match (token → headers → subject heuristic) → `messages.receive`
- [x] P3. Outbound `/deliver`: text+simple HTML, threading headers, Auto-Submitted, X-Hay-Conversation, Reply-To token,
      BCC merchant support@ (setting), store Message-ID
- [x] P4. Setup wizard UI (en + pt-BR): your support address → copy forwarding address → Gmail confirmation code
      capture → send test → status card; conversation header strip (subject/from/to) in dashboard
- [x] P5. Out-of-band reply detection → human-took-over + Needs attention
- [ ] P6. (deferred to Phase 2) Idle auto-resolve (scheduler) — may slip to Phase 2

Verify:
- [x] V1. Jest: svix verify, routeKey transform, thread matcher, classifier, reply-parser, deliver header builder
- [ ] V2. `npm run typecheck`, `npm run lint`, `npm run test:server`, plugin `npm test`, plugin build loads
- [ ] V3. Playwright `tests/email-channel-setup.spec.ts`: wizard end to end (chromium)
- [ ] V4. Independent reviewer agent on `git diff master...HEAD`; findings addressed/recorded here
- [ ] V5. Docs `docs/user-guide/integrations/email.md`; list hay.chat website lines to change in PR body
- [ ] V6. PR against master with verification story; WIP.md + lessons.md updated

Acceptance: a Gmail-forwarded shopper email creates an email conversation with subject as title; the AI reply reaches the
shopper threaded in their client; the shopper's reply lands in the same Hay conversation; a staff reply from the dashboard
goes out by email; bounces/auto-replies never trigger the AI; plugin failures are reported as failures.

## Working notes
- Only `sha256-hmac` signature format exists today (`packages/plugin-sdk/sdk/register.ts:233`).
- `findActiveByCustomerAndChannel` is the only thread lookup in `messages.receive` (`plugin-api/trpc.ts:217`).
- Resend webhook = metadata only; body via `GET /emails/receiving/:id`; attachment URLs 1 h; received mail counts in quota.
