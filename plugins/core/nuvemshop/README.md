# Nuvemshop / Tiendanube Plugin

Connects a Nuvemshop (Brazil) or Tiendanube (Spanish-speaking LatAm) store — same
platform, same API — so the Hay agent can look up products, orders and customers,
cancel orders, track refund state, and recommend real catalog products.

## Connecting a store

The plugin uses a store-scoped **custom app** token (no OAuth required):

1. In the store admin, open **Aplicativos a medida** (BR) / **Aplicaciones a medida** (ES).
2. Create an app and grant it **products**, **orders** and **customers** permissions
   (read/write for orders; read is enough for products and customers).
3. Copy the **access token** (shown only once) and your numeric **store ID**.
4. Paste both into the plugin settings in Hay.

Tokens don't expire — they are invalidated only when re-issued or when the app is
uninstalled, so there is no refresh cron. Re-issuing a token requires reconnecting.

> TODO: a managed OAuth mode (Hay partner app) needs core support for Tiendanube's
> nonstandard authorize URL (`https://www.tiendanube.com/apps/{app_id}/authorize`,
> no scope parameter).

## What the agent can do

**Products** — `nuvemshop_search_products` (free text over names/descriptions/SKUs),
`nuvemshop_get_product`, `nuvemshop_get_product_by_sku`, `nuvemshop_list_categories`.
With the `products` capability enabled, `onStart` also bulk-syncs the catalog into
core (CanonicalProduct upserts) for `recommend_products`.

**Orders** — `nuvemshop_get_order`, `nuvemshop_get_order_by_number` (the customer's
"#101"), `nuvemshop_list_customer_orders`, `nuvemshop_cancel_order`,
`nuvemshop_add_order_note`. There is deliberately **no store-wide free-text order
search**: a customer-facing agent must only see the verified customer's orders.

**Customers** — `nuvemshop_find_customer` (exact email match or name/document text),
`nuvemshop_get_customer`.

**Store** — `nuvemshop_get_store` (doubles as a connectivity check).

## Refunds — what the API can and cannot do

The Nuvemshop merchant API **cannot move money**. There is no refund endpoint for
regular apps; the Transactions refund flow is exclusive to approved payment-provider
apps, and `POST /orders/{id}/cancel` only changes status/stock/notifications.
Actual refunds are executed by the payment provider — Nuvem Pago via the admin's
"Estornar pagamento", other gateways (Mercado Pago etc.) via their own panel or API.

The plugin encodes that honestly:

- `nuvemshop_check_refund_status` reports the order's refund state (`payment_status`,
  transactions and value history when readable) and explains how a refund is executed.
- `nuvemshop_cancel_order` refuses shipped orders, requires
  `confirm_paid_cancellation=true` for paid orders, and its response states explicitly
  that no money was moved.
- Nothing ever claims a refund was executed via the API.

## API notes

- Base URL `https://api.nuvemshop.com.br/{version}/{store_id}` (the
  `api.tiendanube.com` twin is interchangeable); default version `2025-03`.
- Auth header is the nonstandard `Authentication: bearer <token>` (lowercase
  "bearer") — `Authorization` gets a 401. A `User-Agent` is mandatory.
- Rate limit: leaky bucket ~2 req/s with bursts of 40; the client retries 429/5xx
  and honors `X-Rate-Limit-Reset` (milliseconds).
- `402 Payment Required` means the store's subscription lapsed and the API is
  suspended — surfaced with a distinct message.
- i18n fields (`name`, `description`, variant `values`, …) are objects keyed by
  language (`{"es": …, "pt": …, "en": …}`); tools flatten them to one language
  (store main language by default, override per call with `language`).
- Variant stock: v1 uses `stock`; `2025-03` uses per-location `inventory_levels`.
  Helpers resolve both (`null` stock = unlimited).

## Development

```bash
npm install --workspace=plugins/core/nuvemshop
npm run build --workspace=plugins/core/nuvemshop   # tsc → dist/
cd plugins/core/nuvemshop/mcp && npm install        # MCP server deps (also done by scripts/build-plugins.sh)
```

`mcp/` is plain CommonJS run directly by `node` (excluded from the TS build).
