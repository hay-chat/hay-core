# Wix Stores plugin

Connects a [Wix Stores](https://www.wix.com/) site to Hay so the agent can find a customer's
orders, track shipments, cancel or re-route undispatched orders, issue refunds (with an
external-refund fallback), and browse the catalog — the same semantic action set as the Shopify,
WooCommerce and Magento connectors.

Implements **HAY-240, phase one (API key)**.

## How it connects (phase one: API key)

Wix offers an [API Key authorization strategy](https://dev.wix.com/docs/sdk/articles/set-up-a-client/authorization-strategies)
intended for external integrations and headless admins, scoped to a site or account. The merchant
generates a scoped key and pastes it into Hay along with their site ID.

Two settings:

- **API Key** — created in Wix under **Settings → API Keys**. Grant it **no more than** these
  scopes so it stays in line with the Shopify/WooCommerce connectors:
  - Stores - **Orders** (read & manage)
  - Stores - **Order Transactions / Order Billing** (for refunds)
  - Stores - **Order Fulfillments** (read)
  - Stores - **Catalog** (read)
- **Site ID** — the site the key is scoped to (from your dashboard URL `.../dashboard/<SITE_ID>/...`
  or Wix's Query Sites API). Wix routes site-level calls by the `wix-site-id` header.

Wix API keys are **long-lived**, so the connection persists with no token-refresh step. Calls send
the key **raw** in the `Authorization` header (no `Bearer` prefix) plus the `wix-site-id` header,
against `https://www.wixapis.com`.

### Phase two (deferred)

An OAuth app on the **Wix App Market** removes the key-paste friction and is the proper multi-merchant
distribution path. Per HAY-240 it is intentionally **deferred** behind a demand trigger and is **not**
implemented here.

## Tools

One tool per support action, not per Wix endpoint. Reads merge several endpoints into one call;
writes are bounded server-side. All names are prefixed `wix_` so they never collide with another
store plugin installed in the same organisation.

| Tool                                | What it does                                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `wix_find_customer`                 | Email → customer (derived from their orders) + 5 most recent orders                                                               |
| `wix_list_customer_orders`          | Paged order history for an email                                                                                                  |
| `wix_get_order`                     | Order by id **or** number, merged with transactions + fulfilments; `supportSummary` (cancellable, refundable, remaining, address) |
| `wix_get_order_tracking`            | Fulfilment status + one row per shipment (carrier, number, link)                                                                  |
| `wix_cancel_order`                  | Cancel before dispatch only; optional restock + buyer email. Does **not** refund                                                  |
| `wix_create_refund`                 | Full/partial refund: picks payments, checks refundability, caps at the remaining balance; external-refund fallback                |
| `wix_update_order_shipping_address` | Change the shipping destination before dispatch only; merges with the existing address                                            |
| `wix_search_products`               | Free-text catalog search                                                                                                          |
| `wix_get_product`                   | Product with variants (sku, choices, price, in-stock)                                                                             |

There is deliberately **no store-wide order search** (a customer-facing agent must only see the
verified customer's orders) and **no fulfilment create/update/delete** (warehouse actions, not
support actions).

### Refund fallback

`wix_create_refund` reads the order's transactions, allocates the amount across refundable
payments and checks Wix's refundability assessment. If a payment provider can't be refunded via
the Wix API, it returns `{ refunded: false, reason: "provider_not_api_refundable", message: … }`
with a clear instruction to refund the customer in the provider and re-call with
`external_refund: true` — it never fails silently and never silently "records only".

## Tests

```bash
npm test --workspace=plugins/core/wix   # vitest: mocked-fetch unit tests + stdio list-tools smoke
```

## Build

This is an Archetype A plugin: a thin SDK entry (`src/index.ts`) that spawns a local Node MCP
server (`mcp/`) which calls the Wix REST API with native `fetch`. The only `mcp/` runtime deps are
`@modelcontextprotocol/sdk` and `zod`. The repo's `scripts/build-plugins.sh` runs `npm install`
inside `mcp/` at build time, so `mcp/node_modules` is **gitignored** (not committed). To build the
plugin directly:

```bash
cd plugins/core/wix/mcp && npm install --omit=dev   # one-time, for local runs
# then, from the repo root (so the @hay/plugin-sdk file: link resolves):
npm install --workspace=plugins/core/wix
npm run build  --workspace=plugins/core/wix
```

## Notes / assumptions to verify against a live store

- The refund money shape is sent as `paymentRefunds[].amount = { amount: "<decimal-string>" }`
  (major units; currency comes from the order). It's encapsulated in `mcp/lib/format.js → money()`
  so it's a one-line change if a live call rejects it.
- Order and product search post the documented `{ search: { filter, sort, cursorPaging } }` envelope
  (Wix ignores unknown top-level keys, so a bare `{ filter }` silently returns the newest rows of the
  whole store). Every search hit is verified afterwards: the order number must match, and customer
  lookups drop rows whose `buyerInfo.email` differs.
- Refunds use the Order Billing API as documented: `paymentRefunds[].paymentId`, `customerReason`,
  `sideEffects.restock.lineItems[]` / `sideEffects.notifications.sendCustomerEmail`. Restocking
  only happens on a full refund (restock quantities may not exceed what is refunded per line).
- `get-order-refundability` is parsed from its documented one-of shape per payment
  (`refundable: true` | `manuallyRefundable: { reason }` + `providerLink` | `nonRefundable: { reason }`).
- Clients never retry a non-GET request that timed out or returned 5xx: it may already have been
  processed (double refund / double cancel).
- `wix_get_order` returns a projection (buyer, totals, shipping destination, line items, payments,
  tracking, supportSummary), not the raw Wix order.
- `wix_update_order_shipping_address` PATCHes `/ecom/v1/orders/{id}` with `shippingInfo.logistics.shippingDestination` + a field mask; confirm Wix accepts that field on Update Order.
- `wix_cancel_order` POSTs `/ecom/v1/orders/{id}/cancel` with `restockAllItems` / `sendOrderCanceledEmail`.
- The plugin icon ships as `thumbnail.svg`. Core resolves plugin thumbnails as **svg > png > jpg**.
