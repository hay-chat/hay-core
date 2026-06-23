# Wix Stores plugin

Connects a [Wix Stores](https://www.wix.com/) site to Hay so the agent can look up orders,
read their transaction history and fulfilment, issue refunds (with an external-refund fallback),
and browse the catalog — the Wix equivalent of the Shopify and WooCommerce connectors.

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
  - Stores - **Order Fulfillments** (manage)
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

| Tool                      | What it does                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `search_orders`           | Find orders by number, buyer email, status or date → order ID                                   |
| `get_order`               | Full order incl. items, totals, payment & fulfilment status                                     |
| `get_order_transactions`  | Every payment and refund on an order (transaction IDs/amounts)                                  |
| `get_order_refundability` | Whether each payment is API-refundable before refunding                                         |
| `refund_order`            | Full/partial refund; records an **external** refund when the provider can't be refunded via API |
| `get_order_fulfillments`  | An order's fulfilments — shipped items and tracking                                             |
| `create_fulfillment`      | Mark items shipped, with carrier + tracking                                                     |
| `update_fulfillment`      | Update a fulfilment's tracking                                                                  |
| `delete_fulfillment`      | Remove a fulfilment                                                                             |
| `search_products`         | Search the catalog                                                                              |
| `get_product`             | Product with variants, pricing and inventory                                                    |

### Refund fallback (HAY-240)

`refund_order` first checks `get_order_refundability`. If a payment provider can't be refunded via
the Wix API, it returns `{ refunded: false, reason: "provider_not_api_refundable", message: … }`
with a clear instruction to refund the customer manually and re-call with `externalRefund: true` —
it never fails silently. `externalRefund: true` records the manual refund against the order so the
transaction history stays accurate.

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
- `search_orders` posts a top-level `{ filter, sort, cursorPaging }` body with Wix MongoDB-style filters.
- The plugin icon ships as `thumbnail.svg`. Core resolves plugin thumbnails as **svg > png > jpg**.
