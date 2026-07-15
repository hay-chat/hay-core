# Shopify plugin tool rework — DONE

Goal: reshape the MCP toolset around Solo/Starter support tickets — rich reads,
narrow writes, no back-office surface exposed to the customer-facing agent.

## Cuts / merges

- [x] Merged the three customer lookups into `shopify_find_customer` (email/phone → list) + `shopify_get_customer` (by id, enriched)
- [x] Removed `shopify_search_orders` (data-exposure; comment explains why)
- [x] Removed `shopify_create_customer_address`
- [x] Removed `shopify_get_order_status` (subsumed by enriched get_order/get_order_by_name)
- [x] Kept `shopify_get_shop` with TODO — SDK has no session-context injection yet

## Enriched reads

- [x] `shopify_get_customer`: embeds 5 most recent orders as `recentOrders`
- [x] `shopify_get_order` + `shopify_get_order_by_name`: shared ORDER_SUPPORT_FIELDS +
      derived `supportSummary` (isCancellable, isRefundable, remainingRefundable,
      deliveredAt, addressChangeable)
- [x] `shopify_get_order_tracking`: added `deliveredAt`

## New tools

- [x] `shopify_update_order_shipping_address` — orderUpdate; refuses unless
      fulfillment status is UNFULFILLED/SCHEDULED/ON_HOLD
- [x] `shopify_calculate_refund` — Order.suggestedRefund (amounts + transactions)
- [x] `shopify_get_returnable_items` + `shopify_create_return` (returns.js)
- [x] `shopify_create_refund` server-side bounds: rejects non-refundable orders and
      amounts > netPaymentSet remaining balance

## Plumbing / verification

- [x] Scopes: +read_returns +write_returns (existing connections must reconnect!)
- [x] returns.js registered in mcp/index.js
- [x] Docs-verified against shopify.dev 2026-04: no Order.cancelable (derived instead),
      @idempotent(key:) is real and MANDATORY for refunds in 2026-04, returnCreate's
      notifyCustomer/returnReason deprecated, MailingAddressInput wants code fields
- [x] node --check all mcp files; tsc --noEmit clean; MCP server boots, tools/list
      returns the intended 20 tools; no stale tool-name refs in live code

## Not built (logged, deliberate)

- Discount code lookup/creation (ranked 4th — next slice; cap value server-side)
- Order editing (swap item/qty) — complex on Shopify's side, deferred
- Session-start context injection for shop info — needs core/SDK support first

## Follow-up

- Verify orderCancel + refund-on-cancel and the new mutations against a dev store
  (remaining TODO(HAY-219 §8) markers)
