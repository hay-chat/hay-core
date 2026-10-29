# Woo Marketplace listing

Goal: list Hay.chat on the Woo Marketplace (woocommerce.com) as a SaaS product, billed through
Woo so it passes business review. Started 2026-10-28.

## What Woo requires (researched 2026-10-28)

- Approved Marketplace vendor account (woocommerce.com/partners) — **Roger**.
- Business review: product must share revenue with Woo (vendor gets 70%, per an undated Woo page),
  no upsell links outside the Marketplace, price on Woo ≤ price elsewhere, name follows Woo
  trademark rules ("Hay.chat for WooCommerce" style, never starting with "WooCommerce").
- SaaS with tiered monthly pricing **must** implement the Woo SaaS Billing API before launch.
  Sandbox keys are only issued after the product is submitted.
  - USD only. No usage/metered billing (no quantity). Trials, upgrades/downgrades with
    proration, one-time charges, webhooks: activated, updated, renewed, paused, canceled,
    prepaid_term_ended, refunded (HMAC-SHA256 `X-WC-Webhook-Signature`, base64, API secret).
  - Merchant must be able to cancel from inside our product. Refund requests are approved by us
    in the vendor dashboard (approving cancels the contract).
- Alternative: Partnership Agreement (keep Stripe), discretionary — ask Woo early.
- Code: PHP 7.4+, two latest WP and WC majors, HPOS compatible, block Cart/Checkout friendly,
  WP accessibility standards, must not break top extensions (Subscriptions, Bookings, …).
- QIT tests must pass: API, E2E, Activation, Security, PHPCompatibility, Malware, Validation.
- Review: business → code → UX → launch; decision within ~30 days of business review.

Sources: developer.woocommerce.com/docs/woo-marketplace/{submitting-your-product,
monetization-expectations, billing-api-saas}.

## Decisions (defaults — Roger to confirm)

1. **Billing route: Woo SaaS Billing API** (required for tiered monthly pricing). Ask Woo about a
   Partnership Agreement in parallel, but don't wait on it.
2. **Woo plans = flat monthly USD tiers, no overage.** The Billing API can't meter usage. When an
   org reaches its included resolutions the agent pauses (existing `agentPausedAt=usage_limit`)
   and the merchant is offered an upgrade (Billing API switch → Woo confirmation page).
   USD prices ≤ hay.chat USD prices (Woo adds tax on top).
3. **One plugin codebase** (`hay-chat/hay-wordpress`, slug `haychat`) for WordPress.org and the
   Woo Marketplace; WooCommerce features switch on when Woo is active. Confirm with Woo that a
   WP.org-hosted plugin can also be the Marketplace product.
4. Billing state lives in **hay-backoffice** (like Stripe); core stays billing-agnostic and keeps
   receiving `setAccessState` / `setLimits` / `setBillingPeriod`. The provider abstraction is
   shared with the Shopify App Pricing work (subscriptions get `provider`
   stripe|shopify|woo, Stripe columns nullable).

## Plan

### Phase 0 — Roger (non-code, start now; it gates everything)

- [ ] Apply for a Woo Marketplace vendor account.
- [ ] Email the Marketplace team: SaaS integration, our pricing, ask about Partnership Agreement
      and whether the WP.org plugin can be the Marketplace product.
- [ ] Submit the product (Submissions → Submit Product → SaaS) once Phase 1 is in → unlocks
      Billing API sandbox keys.

### Phase 1 — Plugin Marketplace readiness (hay-wordpress, branch `claude/woo-marketplace`)

- [x] Commit pending 1.0.1 + 1.1.0 patches into git (were only in haychat-svn-patches/).
- [x] Declare HPOS + cart_checkout_blocks compatibility; WC requires/tested headers.
- [x] Plugin Check clean on a `haychat/` build (WC 11.2.1, HPOS on, local docker demo).
- [ ] Sign-up from WP admin without leaving for hay.chat/get-started (create org + connect in one
      flow) — reuse the Shopify app's connect handshake (`generateConnectAuthCode`).
- [ ] Single onboarding: after connecting the org, chain the store-actions (wc-auth) connect.
- [ ] Billing screen in WP admin: current plan, usage, upgrade/downgrade/cancel (Billing API
      URLs come from the backoffice).
- [ ] Accessibility pass on the settings page (WP a11y standards).
- [ ] Run QIT locally once we have a vendor account (`qit` CLI needs partner credentials).

### Phase 2 — Hay core fixes on the Woo connector (seen in Wave 4 hand-tests)

- [ ] Dashboard Enable fails "Required field WordPress Site URL is not configured" with an empty form.
- [ ] Configuring while disabled leaves testConnection "unconfigured" until reconfigured.
- [ ] Health check says "no safe read-only tool" though `woocommerce_get_store` is readOnly.

### Phase 3 — Billing provider abstraction (hay-backoffice; shared with Shopify)

- [ ] `subscriptions.provider` + `provider_subscription_id`; Stripe columns nullable (migration).
- [ ] Provider interface: start checkout, change plan, cancel, reconcile, report usage (no-op for Woo).
- [ ] `account-access.service` keeps deciding access from subscription status, provider-agnostic.

### Phase 4 — Woo SaaS Billing API (hay-backoffice; needs sandbox keys from Phase 0)

- [ ] Client: `POST /subscriptions`, `POST /subscriptions/{id}` (switch), DELETE (cancel), `POST /charges`.
- [ ] Webhook route with HMAC verification + idempotency; map events → subscription status.
- [ ] Return-URL handler (contract id) — never activate before the `activated` webhook.
- [ ] Plans: Woo USD plan set in billing-plans.json; trial = 30 days (matches TRIAL_DAYS).
- [ ] Refund requests: document the vendor-dashboard process.

### Phase 5 — Submission

- [ ] Listing copy + assets (reuse .wordpress-org assets), testing instructions for reviewers,
      a reviewer test account path that never hits an error page.

## Acceptance criteria

- A merchant installs from the Woo Marketplace, connects (or signs up) without leaving WP admin
  except for Woo's own payment confirmation, picks a plan, pays through woocommerce.com, and the
  agent answers order questions on their store.
- Plan change and cancel work from inside WP admin; Hay access follows Woo webhooks.
- QIT suite passes; Plugin Check clean; HPOS on and off both work.

## Working notes

- Canonical plugin repo: `hay-woocommerce-demo/hay-wordpress` (github hay-chat/hay-wordpress).
  `../hay-wordpress` is an old uncommitted copy — ignore. SVN wc: `../haychat-svn`.
- Local test env: `hay-woocommerce-demo` docker (WP + WC 11.2.1, admin/admin, :8085). Re-installed
  2026-10-28 (volume was empty); mount a worktree with a compose override on
  `wp-content/plugins/hay-chat`. Plugin Check reports false text-domain errors unless the folder is
  named `haychat`.
- Woo core connector already has one-click wc-auth key connect (`plugins/core/woocommerce/src/wc-auth.ts`).
