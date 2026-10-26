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
- [ ] Backoffice: billing-plans.json + PLAN_CONFIG + planPricing/includedResolutionsFor
- [ ] Backoffice: sync script currency_options; verifyStripeCatalog currency check
- [ ] Backoffice: migrations (subscriptions.currency, accounts.overage_enabled, accounts.agent_paused_reason,
      usage_records.alerted_threshold)
- [ ] Backoffice: checkout currency + changeSubscriptionPlan + route branches + /settings
- [ ] Backoffice: usage thresholds (email template, send log, notice) + overage cap + access sync with agentPause
- [ ] Backoffice: tests green (`npm test`), `tsc --noEmit`, prettier
- [ ] hay-core: types/entity/migration/service/router/run.ts/auth.me/store/i18n
- [ ] hay-core: jest tests, typecheck, lint; Playwright spec written (run if a dev stack is available)
- [ ] hay-core: docs/user-guide updates
- [ ] Website: billing.js currency, change-plan flow, overage toggle; `node --check`
- [ ] Reviewer agent on the three diffs; findings addressed
- [ ] WIP.md entries in all three repos; push; PR bodies with verification story + website copy list

## Working notes

- Backoffice `main` is at 27247d1; `claude/overage-billing` (6 commits) is unmerged and holds the overage item code.
- hay-core dev stack is not running locally (ports 3000/3001 are other apps; hay-core runs in Docker on 8088/8089).
- `gh` is not installed on this machine: PRs are opened from the compare URL with the body files in `tasks/prompts/`.
- Stripe SDK v20: `prices.create/update` take `currency_options`; `checkout.sessions.create` takes `currency`;
  `subscriptions.update` items take `{ id, price }` and `proration_behavior`.

## Results

(filled in when done)
