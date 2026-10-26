# Commerce plugins: semantic actions (WooCommerce, Wix, Magento) — branch claude/commerce-semantic-actions

## Goal

Replace per-endpoint tool sprawl with one small, bounded, _semantic_ action set per store platform,
mirroring the Shopify plugin's design (rich reads, narrow writes with server-side bounds, actionable errors).
A semantic action may call several platform endpoints to achieve one support goal (e.g. "get order" =
order + refunds + shipments + tracking in one call).

Before: WooCommerce 120 tools (raw REST passthrough, admin surface included), Wix 11 (no prefix,
store-wide search, 3-step refund), Magento 15 (catalog reads + merchant revenue analytics, no order actions).

## Acceptance criteria

- Each of the three plugins exposes only the common semantic surface below, prefixed by platform
  (`woocommerce_`, `wix_`, `magento_`) so names cannot collide inside one org (core resolves tools by bare name,
  `server/services/mcp-registry.service.ts:107`).
- Writes are bounded server-side: cancel/address change only before dispatch; refund never exceeds the
  remaining refundable balance; refunds never silently become "record only".
- No store-admin tools (settings, shipping zones, taxes, gateways, meta CRUD, catalog writes, WP posts,
  revenue analytics) remain.
- Every tool has an i18n label/description in `en` + `pt-BR`/`pt`.
- Unit tests (vitest, mocked `fetch`) cover: enrichment/supportSummary, every bound (cancel, address, refund cap),
  multi-endpoint merges (tracking fallbacks, refund transaction selection), and an MCP stdio smoke test that
  lists the exact tool names.
- `docs/user-guide/integrations/{woocommerce,wix,magento}.md` updated (docs submodule → separate PR);
  website lines that now need changing are listed in the PR.

## Common semantic surface (per platform)

| Action                                                  | WooCommerce (REST v3)                           | Wix (eCom REST)                                | Magento 2 (REST V1)                                                     |
| ------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------- |
| `find_customer` (email/phone → customer + recentOrders) | /customers?email + /orders?search (guest)       | orders/search by buyerInfo.email (derived)     | /customers/search + /orders?customer_email                              |
| `get_order` (id or number; supportSummary)              | /orders/{id} (+ shipment-trackings)             | order + transactions + fulfillments            | /orders search increment_id + /shipments + /invoices                    |
| `list_customer_orders`                                  | /orders?customer= or ?search=email              | orders/search                                  | /orders?customer_email                                                  |
| `get_order_tracking`                                    | /orders/{id}/shipment-trackings → meta fallback | fulfillments                                   | /shipments?order_id (tracks)                                            |
| `cancel_order` (pre-dispatch only)                      | PUT status=cancelled                            | POST orders/{id}/cancel                        | POST /orders/{id}/cancel                                                |
| `create_refund` (capped)                                | POST /orders/{id}/refunds api_refund            | refundability + transactions + refund-payments | /invoice/{id}/refund (online) or /order/{id}/refund (offline, explicit) |
| `update_order_shipping_address` (pre-dispatch)          | PUT shipping                                    | PATCH order shippingInfo                       | PUT /orders/{id} address entity                                         |
| `add_order_note`                                        | POST /orders/{id}/notes                         | — (no API)                                     | POST /orders/{id}/comments                                              |
| `search_products`                                       | /products?search                                | stores/v3/products/search                      | /products name like                                                     |
| `get_product` (+ variants + stock)                      | /products/{id} + /variations                    | /stores/v3/products/{id}                       | /products/{sku} + /stockItems/{sku}                                     |
| `check_inventory` (sku)                                 | /products?sku (+variations)                     | — (in get_product)                             | /stockItems/{sku}                                                       |
| `get_store` (connectivity + currency)                   | /system_status                                  | —                                              | /store/storeConfigs                                                     |

Deliberately dropped: Wix fulfilment create/update/delete (warehouse actions, not support), Magento
revenue/order-count/sales analytics (merchant BI, data-exposure risk under prompt injection),
Magento `update_product_attribute`, all WooCommerce admin/CRUD/report/meta/WP tools, WooCommerce
`username`/`password` config (only the WP post tools used them).

## Checklist

- [x] Restate goal + acceptance criteria
- [x] Locate existing implementation / patterns (Shopify = reference; tools resolved by bare name in core)
- [x] Design: common surface above; `lib/client.js` + `lib/format.js` + `tools/*.js` layout per plugin
- [ ] Wix: rename/prefix, fold refund steps, add find_customer/list_customer_orders/cancel/address, drop fulfilment writes, tests
- [ ] WooCommerce: rewrite MCP (CJS, native fetch, no axios), 12 semantic tools, tracking fallbacks, tests
- [ ] Magento: rewrite MCP (no axios/date-fns/dotenv, delete vendored cruft), 12 semantic tools, tests
- [ ] i18n en + pt-BR/pt for all three
- [ ] Verify: plugin builds, vitest per plugin, MCP stdio smoke (list tools), `npm run typecheck`, `npm run lint`
- [ ] Docs: user-guide pages (docs submodule branch), README per plugin, website lines listed
- [ ] Independent review agent on `git diff master...HEAD`; address findings
- [ ] WIP.md + PR

## Working notes

- Core: tool names are global per org (`mcp-registry.service.ts getTool` finds by name) → prefix mandatory.
- Playbook mentions store `${pluginId}:${toolName}`; renaming tools invalidates existing playbook chips
  (alpha, acceptable; no DB migration — chips resolve label at render time and show the raw name).
- Tool descriptors are cached per instance on worker start (`plugin-tools.service.ts`), so renamed tools
  appear after the worker restarts (plugin rebuild / config save).
- `docs/` is a submodule (hay-docs); docs changes go on a branch there + separate PR (as for WhatsApp).
- Playwright: no dashboard UI changes; tool lists on the plugin page need live store credentials, so the
  UI e2e is replaced by the MCP stdio smoke test + mocked-fetch unit tests (documented in PR).
- WooCommerce tracking: core WC has none. Official "Shipment Tracking" + AST expose
  `/wc/v3/orders/{id}/shipment-trackings` (AST: `/wc-ast/v3/...`) and both write `_wc_shipment_tracking_items`
  meta → try endpoint, fall back to meta, then to any meta key containing "tracking".
- Magento cancel only works before invoicing; paid orders need a credit memo (refund). Online refund needs the
  invoice id (`/invoices?order_id`). Never auto-fall-back to offline (no money moves) — explicit `online=false`.

## Results

(pending — filled in when verified)
