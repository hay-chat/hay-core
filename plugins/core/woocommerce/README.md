# WooCommerce plugin

Connects a WooCommerce store to Hay so the agent can find a customer's orders, track shipments,
cancel or re-route undispatched orders, issue refunds, and answer product and stock questions —
the same semantic action set as the Shopify, Wix and Magento connectors.

## How it connects

Three settings: **WordPress Site URL**, **Consumer Key** and **Consumer Secret** (WooCommerce →
Settings → Advanced → REST API → Add key, Read/Write). Hay verifies them against
`/wp-json/wc/v3/system_status` on save. Credentials are sent as query parameters, which works on
hosts that strip the `Authorization` header.

## Tools

One tool per support action, not per REST endpoint (the previous server exposed 120 raw
endpoints, most of them store administration). Reads merge several endpoints; writes are bounded
server-side. All names are prefixed `woocommerce_` so they never collide with another store plugin
in the same organisation.

| Tool                                        | What it does                                                                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `woocommerce_get_store`                     | Store URL, currency, versions (connectivity check)                                                                                     |
| `woocommerce_find_customer`                 | Email/phone → account (`/customers`) **and** guest orders (`/orders?search`, phones by last 8 digits), merged, 5 recent orders         |
| `woocommerce_list_customer_orders`          | Paged history: by customer id for accounts (exact counts), by verified `?search` for guests (counts unknown)                           |
| `woocommerce_get_order`                     | Order by id **or** number (sequential-number plugins handled) + tracking; `supportSummary`                                             |
| `woocommerce_get_order_tracking`            | Official Shipment Tracking endpoint → Advanced Shipment Tracking endpoint → `_wc_shipment_tracking_items` → any `*tracking*` meta      |
| `woocommerce_cancel_order`                  | Only pending / on-hold / processing **with no tracking recorded** (stores ship while `processing`); optional note. Does **not** refund |
| `woocommerce_create_refund`                 | Full, by item (amount computed from the order), or by amount; capped at total − refunded; unpaid orders refused                        |
| `woocommerce_update_order_shipping_address` | Only pending / on-hold / processing with no tracking recorded; merges with the existing address                                        |
| `woocommerce_add_order_note`                | Internal note, optionally emailed to the customer                                                                                      |
| `woocommerce_search_products`               | Published products by text                                                                                                             |
| `woocommerce_get_product`                   | Product + variations (sku, attributes, price, stock)                                                                                   |
| `woocommerce_check_inventory`               | Stock for a product **or variation** SKU                                                                                               |

Deliberately absent: store-wide order browsing (data-exposure vector under prompt injection), and
every admin surface — settings, shipping zones, taxes, payment gateways, coupons, reports, product
and customer CRUD, meta data, WordPress posts.

### Refunds

`woocommerce_create_refund` asks the payment gateway for the money (`api_refund: true`) by default.
When the gateway cannot refund through WooCommerce, the error is returned verbatim and tells the
agent not to re-run and to hand off: a person refunds in the gateway. `refund_payment=false`
(record only) is accepted only for offline methods (bacs, cod, cheque), where the store pays the
money back by hand; the result then says `moneyMoved: false, recordedOnly: true`.

## Build & test

```bash
npm run build --workspace=plugins/core/woocommerce   # tsc for src/
npm test      --workspace=plugins/core/woocommerce   # vitest: mocked-fetch unit tests + stdio list-tools smoke
```

`mcp/` is plain runtime JavaScript (`@modelcontextprotocol/sdk` + `zod` only); `scripts/build-plugins.sh`
runs `npm install` inside it at build time.
