# Shopify App Store resubmission (App Pricing + connect fix)

Goal: pass Shopify review. Rejection (Oct 2026): **1.2.1** off-platform billing (Stripe via
hay.chat/get-started) and **2.1.1** "app shows an error when connecting our store". Pause ends
2026-10-31; resubmit from the Partner Dashboard after that. Started 2026-10-28.

## What Shopify App Pricing gives us (researched 2026-10-28)

- Plans live in Partner Dashboard → Distribution → Manage listing → Pricing content. Shopify hosts
  the plan page: `https://admin.shopify.com/store/{store_handle}/charges/{app_handle}/pricing_plans`
  (open with `redirect(url, { target: "_top" })` from the embedded app).
- Usage: meters (≤5 per plan, ≤6 tiers, fixed/graduated/volume, monthly only, **no caps**). Report
  each unit with App Events `POST /app/<version>/events` — one event per request, `shop_id`,
  `event_handle` = meter handle, `timestamp`, `idempotency_key` (enforced permanently),
  `attributes.value` non-zero (negative = reversal). Always returns 202; billing failures
  (NO_SUBSCRIPTION, SUBSCRIPTION_NOT_METERED, IDEMPOTENCY_KEY_ERROR…) only show in Dev Dashboard
  logs. No PII in attributes.
- Status: no webhooks. Welcome link gets `plan_handle` (+ `shop`) params; source of truth is the
  Partner API `activeSubscription` (client with **Manage apps**; cancelling needs View financials).
- Dev stores of our own Partner org get every plan at no charge → test on haychat-2.
- Plan changes must be possible in-app (1.2.3): link to the same pricing_plans page.

## Decisions (defaults — Roger to confirm)

1. **Shopify merchants are billed only through Shopify.** The app never links to
   hay.chat/get-started or Stripe. Non-Shopify customers keep Stripe.
2. **Plans mirror hay.chat USD tiers**: Solo / Starter / Growth / Enterprise as recurring monthly
   plans, each with one graduated meter `resolution`: tier 1 = included resolutions at $0,
   tier 2 = overage price. Annual: skip for now (usage needs monthly). Trial 30 days.
   Pilot 50% → per-merchant discount in Dev Dashboard.
3. **Backoffice stays the billing source of truth** with a provider abstraction shared with Woo
   (`subscriptions.provider` stripe|shopify|woo, Stripe columns nullable, `provider_account_id`
   = shop GID). Core stays billing-agnostic (setAccessState / setLimits / setBillingPeriod).
4. **Onboarding is Shopify-native**: on first open the app creates (or links) the Hay org and
   connects the Shopify plugin with the token it already holds — no hop through the dashboard
   OAuth. This is also the most likely fix for 2.1.1 (see Phase 1).
5. Usage events are sent by the backoffice per billable resolution (idempotency key =
   resolution id; reversal = negative event with key `<id>:rev`). Token source: TBD in Phase 3
   (shop offline token held by apps.hay.chat vs. app client credentials).

## Plan

### Phase 0 — Roger (non-code)

- [ ] Partner Dashboard: switch pricing to Shopify App Pricing; create the 4 plans + `resolution`
      meter per decision 2; welcome link `/welcome`.
- [ ] Create a Partner API client with **Manage apps** (+ View financials) → token into Infisical
      prod for the backoffice (`SHOPIFY_PARTNER_API_TOKEN`, `SHOPIFY_PARTNER_ORG_ID`, `SHOPIFY_APP_GID`).
- [ ] 2.1.1 evidence: the reviewer screencast (Partner Dashboard → app → review history), or allow
      read-only prod logs on homeserver.

### Phase 1 — 2.1.1 connect error (hay-shopify-app + hay-core)

- [ ] Reproduce the reviewer path on haychat-2 with a brand-new Hay account (sign-up → email
      verification → connect intent → plugins.enable → OAuth initiate/callback → return_to).
- [ ] Fix root cause; candidates: connect intent lost across sign-up/verification; return_to
      origin not in `CONNECT_ALLOWED_REDIRECT_ORIGINS`; OAuth callback error page.
- [ ] Replace with Shopify-native onboarding (decision 4) if the dashboard hop is the cause.

### Phase 2 — Billing provider abstraction (hay-backoffice; shared with Woo)

- [ ] Migration: `subscriptions.provider`, `provider_account_id`, `provider_plan_handle`; Stripe
      columns nullable (follow DATABASE_CONVENTIONS).
- [ ] Provider interface: plan URL, reconcile, report usage, cancel. Stripe impl = current code.
- [ ] `account-access.service` decides from status only (provider-agnostic).

### Phase 3 — Shopify provider (hay-backoffice + hay-shopify-app)

- [ ] Partner API client: `activeSubscription(appId, shopId)` → map plan_handle → planKey,
      status, period; upsert subscription; push limits/access to core.
- [ ] Welcome route in the app (`/welcome?plan_handle=`) → backoffice reconcile → app home.
- [ ] App root loader: no active subscription → redirect `_top` to pricing_plans page.
- [ ] Reconcile cron (cancellations/freezes happen off-redirect).
- [ ] Usage reporter: billable resolutions above included → App Events; reversals negative.
- [ ] In-app "Change plan" link; remove get-started/Stripe links from the app.
- [ ] Dashboard: hide Stripe billing UI for Shopify-billed orgs; show "Billed through Shopify".

### Phase 4 — Resubmit

- [ ] Reviewer instructions + test path on a fresh store; screencast of install → plan → connect.
- [ ] Run the `app-store-review` pre-submission check.

## Acceptance criteria

- A fresh store installs, picks a plan on Shopify's page, lands back in the app, and the agent
  answers on the storefront without ever seeing a Hay error page or a Stripe checkout.
- Plan change and cancel work from the app; access in Hay follows `activeSubscription`.
- Overage resolutions show as Billable events in the Dev Dashboard; reversals net them out.

## Working notes

- Shopify app: `../hay-shopify-app/haychat` (React Router), prod apps.hay.chat on homeserver
  `/srv/hay-shopify`. Connect link today:
  `${dashboardUrl}/integrations/plugins/hay-plugin-shopify?connect=1&config.shopDomain=…&return_to=…`
  handled by `dashboard/pages/integrations/plugins/[pluginId].vue` `handleConnectIntent()`.
- Prod log reads over SSH were blocked by the auto-mode classifier — needs Roger's OK.
