# PR bodies — billing slice 2 (2026-10-26)

`gh` is not installed on this machine. Open each PR from its compare URL and paste the body.
Land order: hay-backoffice `claude/overage-billing` → `claude/billing-currencies-usage-alerts`; the other three are
independent of each other but the website and dashboard copy assume the backoffice branch is deployed.

---

## 1. hay-backoffice — https://github.com/hay-chat/hay-backoffice/compare/claude/overage-billing...claude/billing-currencies-usage-alerts

**Title:** Price plans in EUR/USD/GBP/BRL, warn at 50/80/100 % usage, add the overage switch, change plans in place

Stacked on #claude/overage-billing (the metered overage item). Review only the top five commits.

### What changes
- `billing-plans.json` is the single source of prices in four currencies. `npm run stripe:sync` writes them as Stripe
  `currency_options` on the existing lookup-key prices (flat + metered), idempotently (`--dry-run` supported);
  `verifyStripeCatalog` reports missing currencies at boot.
- Checkout takes `currency` (default EUR); `subscriptions.currency` is stored and every amount (overview, plans, emails)
  is shown in it. The currency is fixed for the life of the subscription (Stripe rule).
- `POST /api/billing/checkout` with an **active** subscription now updates that subscription in place
  (`subscriptions.update`, flat + metered items swapped, `proration_behavior: create_prorations`) and answers
  `{ action: "changed" }`. Past due → 409 `payment_overdue`; same plan + interval → 400 `same_plan`. No second
  subscription is possible from the page anymore.
- `invoice.paid` resets the period and usage only for `subscription_cycle` / `subscription_create` invoices, so a
  proration invoice no longer wipes the month's counter. Annual allowance = monthly × 12 (fixes annual metering).
- Usage job: crossing 50 / 80 / 100 % sends one `usage-threshold` email per threshold per period (dedup via
  `usage_records.alerted_threshold` + `email_send_log`); ≥ 80 % pushes a dashboard notice to hay-core
  (`usage_warning`, `usage_exceeded`, `usage_paused`).
- `accounts.overage_enabled` (default **true**), editable via `POST /api/billing/settings`. Off + 100 % → no meter
  events to Stripe and hay-core receives `agentPause: { reason: "usage_limit" }` (AI parked, dashboard stays usable).
  Switching it back on, upgrading or the next renewal lifts the pause.
- Migration `1785000000000-AddBillingCurrencyAndUsageAlerts` (subscriptions.currency, accounts.overage_enabled,
  accounts.agent_paused_reason, usage_records.alerted_threshold + included_resolutions).

### Verification
- `npx vitest run`: 11 files, 138 tests passed (stripe.service, usage-tracking, account-access, stripe-webhook-handler,
  billing route via supertest).
- Independent review: 5 should-fix findings, all fixed in the last commit (currency locked per Stripe customer even after a
  cancellation, usage reset when `subscription.updated` rolls the period, alert thresholds reset on allowance change,
  past-due keeps a usage pause, send-log claimed before the email). Table in hay-core `tasks/todo.md` → Results.
- `npx tsc --noEmit` clean; prettier clean.
- Not run: Stripe test-mode end to end (no Stripe key in this environment). The reviewer's findings are recorded in
  hay-core `tasks/todo.md` → Results.

### After merge (Roger)
1. `npm run stripe:sync:dry` then `npm run stripe:sync` against **test** and **live** keys.
2. `npm run migration:run`.
3. Admin UI does not show currency / overage yet (TODO in code).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## 2. hay-core — https://github.com/hay-chat/hay-core/compare/master...claude/billing-usage-limits

**Title:** Let the billing operator pause an organization's AI agent at the usage limit

### What changes
- `organizations.agent_paused_at` / `agent_pause_reason` (migration `1784500000000-AddOrganizationAgentPause`,
  `ADD COLUMN IF NOT EXISTS`).
- `internal.organizations.setAccessState` accepts `agentPause: { reason: "usage_limit" } | null` (optional, default
  null = resumed). `toAccessState` / `auth.me` / the WebSocket event / the dashboard store carry the two new fields.
- Orchestrator: a conversation of a paused organization is parked exactly like one of a disabled agent
  (`parkForPausedAgent`: pending-human when the shopper has written, no greeting otherwise). The skip log now carries
  `cause` (`organization_paused` | `agent_disabled`) and the pause reason.
- Dashboard notices `accessNotice.usage_warning`, `usage_exceeded`, `usage_paused` in en + pt-BR (params: percent,
  used, included, periodEnd, rate). Rendered by the existing `AccessNoticeBanner`.
- Docs submodule → hay-docs `claude/billing-usage-docs` (FAQ "Pricing & Plans" + "Billing & Account", settings page).

### Verification
- `npm run typecheck` (server + dashboard, dashboard needs `API_DOMAIN` set) clean; eslint + prettier clean on changed
  files.
- Jest: `tests/orchestrator/paused-agent-skip.test.ts` (3 new org-paused cases), `tests/services/organization-access.service.test.ts`
  (pause set / kept / cleared), `tests/routes/internal.test.ts` (reason validation + passthrough) → 49 tests pass in
  the orchestrator/access/internal set. Full `npx jest`: 57 suites pass, 5 fail — all five are DB-backed integration
  suites (`tests/integration/*`, `routes/v1/privacy/privacy.test.ts`) failing with `Driver not Connected` because no
  Postgres is reachable here; untouched by this branch.
- Playwright `tests/billing-usage-notice.spec.ts` written (pushes a notice through the internal API, asserts the
  banner text / CTA / WebSocket clear). **Not run**: no dev stack on :3000/:3001 here and the spec skips without
  `INTERNAL_API_SECRET` in `.env.test`.

### After merge (Roger)
- `cd server && npm run migration:run`.
- Set `INTERNAL_API_SECRET` in `.env.test` to run the new spec.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## 3. hay-docs — https://github.com/hay-chat/hay-docs/compare/main...claude/billing-usage-docs

**Title:** FAQ and settings: plans in four currencies, usage warnings, extra-resolution switch, in-place plan change

Rewrites the "Pricing & Plans" and "Billing & Account" FAQ sections (currencies, warnings at 50/80/100 %, the
**Allow extra resolutions** switch and what happens at 100 % either way, in-place plan changes with proration) and
replaces the "no billing page" line on the settings page with where billing lives plus a "why is there a usage
banner" answer. Merge together with hay-core `claude/billing-usage-limits`, which points the submodule here.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## 4. hay-website — https://github.com/hay-chat/hay-website/compare/main...claude/billing-change-plan

**Title:** Billing page: prices in four currencies, change plan in place, extra-resolution switch

### What changes (`src/js/billing.js` only)
- Plans page renders the backoffice's per-currency prices (`plan.prices[currency]`, annual price from the server
  instead of `monthly × 12 × 0.9` computed client-side). Currency toggle pre-selected from the `hay_region` cookie,
  hidden once a subscription exists (`currencyLocked`). Interval defaults to the current one for subscribers.
- Subscribers see "Switch to <plan>" / "Switch to yearly billing"; a second click confirms ("prorated on your next
  invoice"). `POST /checkout` → `{ action: "changed" }` → `/billing/overview/?changed=<plan>` with a success alert.
  409 `payment_overdue` → alert with an "Update payment method" portal shortcut. Non-subscribers still go to Stripe
  Checkout. **The page no longer sends a subscriber into a second Checkout.**
- Overview: `usagePercent` / `agentPaused` from the server, paused-agent card with "Allow extra resolutions" and
  "Upgrade plan", new "Extra resolutions" switch card (`POST /settings`, re-renders from the server), every amount via
  `fmtMoney(amount, currency)` (Intl, cents dropped for whole amounts).

### Verification
- `node --check` and prettier clean. Review nits fixed (region cookie on the locked page, `textContent` labels,
  month↔year copy says the new cycle is invoiced right away). Not run in a browser (no local Eleventy build / backoffice here): please click
  through overview → plans → switch → overview once the backoffice branch is deployed to test.

### Website copy that now contradicts the product (not changed in this PR — says the task)
- `src/pricing/en.locale.js:33` and `src/pricing/pt.locale.js:34` — "upgrade or downgrade ... prorate" is now true; keep,
  but `src/refund-policy.md:62-65` (§4 "Downgrades take effect at the start of the next billing cycle") contradicts
  it: downgrades are now immediate and prorated.
- `src/pricing-machine-readable.njk:74-78` — same downgrade-timing sentence.
- `src/pricing-machine-readable.njk:29` and `:48` — "EUR, the default currency / Other currencies": still accurate,
  but should mention that the checkout currency is chosen at purchase and fixed afterwards.
- `src/refund-policy.md:16-36` (30-day money-back) and `:54-58` (10 % early-exit fee) — still no code behind either;
  out of scope for this slice (listed in `tasks/prospect-faq-answers-2026-10-26.md`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
