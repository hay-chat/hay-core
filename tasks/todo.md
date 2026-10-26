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
- [x] Wix: rename/prefix, fold refund steps, add find_customer/list_customer_orders/cancel/address, drop fulfilment writes, tests (ee9be5d)
- [x] WooCommerce: rewrite MCP (CJS, native fetch, no axios), 12 semantic tools, tracking fallbacks, tests (b7a1de4)
- [x] Magento: rewrite MCP (no axios/date-fns/dotenv, delete vendored cruft), 12 semantic tools, tests (1b7e8eb)
- [x] i18n en + pt-BR/pt for all three
- [x] Verify: plugin builds, vitest per plugin, MCP stdio smoke (list tools), `npm run typecheck`, `npm run lint`
- [x] Docs: user-guide pages (docs submodule branch 949ee4e), README per plugin, website lines listed below
- [x] Independent review agent on `git diff master...HEAD`; findings addressed (d504c6a, see "Review outcome")
- [x] WIP.md; both branches pushed. Opening the two PRs is the next step (no `gh` on this box) — see "PR body"

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

## Review outcome (independent reviewer on `git diff master...HEAD`)

All findings accepted and fixed in d504c6a unless noted.

| #              | Finding                                                                                                      | Outcome                                                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1             | fetch-exception path retried POSTs after a timeout (double refund)                                            | Fixed in all three clients: non-GET never retried on exception; tests "POST that timed out is called once"                                                                                                                    |
| H2             | Wix search body lacked the `search` envelope; `orders[0]` trusted; find_customer could expose any order       | Verified against the dev.wix.com reference; envelope fixed for orders + products, number must match, email rows filtered; tests pin the body and the rejection                                                                |
| M1             | Magento full refund pinned shipping to 0                                                                      | `shipping_amount` omitted on a full refund, `shipping − shipping_refunded` otherwise; the mock now computes `total_refunded` from the posted body                                                                               |
| M2             | Woo pre-dispatch guard ignored recorded tracking                                                              | `assertPreDispatch` reads tracking; `isCancellable` / `addressChangeable` require none; tests                                                                                                                                 |
| M3             | Magento `holded` / `payment_review` reported cancellable                                                      | Removed from `CANCELLABLE_STATES`; explicit merchant-action errors; tests                                                                                                                                                     |
| M4             | Wix refund endpoint / field names unverified                                                                  | Verified: `/ecom/v1/order-billing/refund-payments` with `paymentRefunds[].paymentId`, `customerReason`, `sideEffects.restock.lineItems` / `notifications.sendCustomerEmail`; refundability parsed from the documented one-of |
| M5             | Wix dumped raw order / product objects                                                                        | Projected (`buyer`, `totals`, `shippingAddress`, `lineItems`, `payments`, `tracking`, `supportSummary`; product detail without media/SEO)                                                                                      |
| L1–L7          | isRefundable vs status, guest paging counts, phone search, AST link, cancel `remainingRefundable`, dead branch, open-invoice fallback | All fixed                                                                                                                                                                                                       |
| Conventions    | `catch (error: any)` + no-op `onEnable` in the Magento entry; dead Wix exports; `orderId` vs `id` result keys | Fixed; Wix refund/cancel return `id` / `number` / `orderStatus` like Woo/Magento                                                                                                                                              |
| Missed sites   | build-plugin skill, anti-patterns and docs quick-reference cited magento/woocommerce as the anti-pattern      | Rewritten (skill in this branch, quick-reference on the docs branch)                                                                                                                                                          |
| Docs pointer   | `M docs` drift                                                                                                | Submodule pointer deliberately not committed; docs ship as a separate hay-docs PR                                                                                                                                             |

Not done from the reviewer's test-gap list (low value for this PR): a Woo `create_refund` test combining `line_items` +
`amount`, a 401 on the tracking endpoint, and asserting i18n coverage inside the stdio smoke test (checked by hand:
9/9, 12/12, 12/12 in both locales).

## Results

**Changed**: `plugins/core/{wix,woocommerce,magento}` rewritten (`mcp/index.js`, `mcp/lib/{client,format,orders}.js`,
`mcp/tools/*.js`, `mcp/tests/*`, `i18n/*`, `README.md`, `src/index.ts`, `vitest.config.ts`); Magento vendored GPL tree
deleted; `.claude/skills/build-plugin` references updated; docs pages on hay-docs branch `claude/commerce-semantic-actions`.

**Verification (run on this branch, 2026-10-26)**

| Check                                                                            | Result               |
| -------------------------------------------------------------------------------- | -------------------- |
| `npx vitest run --root plugins/core/wix`                                         | 5 files, 35 passed   |
| `npx vitest run --root plugins/core/woocommerce`                                 | 5 files, 37 passed   |
| `npx vitest run --root plugins/core/magento`                                     | 5 files, 31 passed   |
| `npm run build` in the three plugin dirs (tsc)                                   | exit 0               |
| `npm run typecheck:server`                                                       | exit 0               |
| `npm run lint` (root, `--max-warnings 0`)                                        | exit 0               |
| `API_DOMAIN=localhost npx nuxt typecheck` (dashboard, run from the main checkout) | exit 0, 0 TS errors  |

The dashboard typecheck fails inside the worktree only because its symlinked `dashboard/node_modules` cannot resolve
`@types/node` (TS2688); the dashboard is untouched by this branch, so it was run from `/srv/hay-core/repo/dashboard`.
Playwright: no UI change; tool lists on the plugin page need live store credentials, so the e2e is the MCP stdio
smoke test (spawns `node index.js`, lists tools, pins the exact names) plus the mocked-fetch unit tests.

**Not verified against a live store** (flagged in each README's "assumptions"): Wix `PATCH /ecom/v1/orders/{id}`
shipping-destination field mask, Magento `PUT /orders/{id}` address entity, WooCommerce tracking endpoints on a real
Shipment Tracking / AST install.

## PR body (hay-core, `claude/commerce-semantic-actions` → `master`)

Compare URL: https://github.com/hay-chat/hay-core/compare/master...claude/commerce-semantic-actions?expand=1
Docs PR: https://github.com/hay-chat/hay-docs/compare/main...claude/commerce-semantic-actions?expand=1

Title: **Commerce plugins: one semantic action set for WooCommerce, Wix and Magento**

```
## Why
The three store plugins exposed one tool per REST endpoint (WooCommerce 120 incl. WordPress posts/users and
store admin; Wix 11 unprefixed incl. fulfilment writes; Magento 15 incl. merchant revenue analytics from a vendored
GPL repo). The agent had no usable surface and tool names could collide across plugins (core resolves tools by bare
name per org).

## What
One prefixed, bounded, semantic action set per platform, mirroring the Shopify plugin:
find_customer · list_customer_orders · get_order (with supportSummary) · get_order_tracking · cancel_order ·
update_order_shipping_address · add_order_note (Woo/Magento) · create_refund · search_products · get_product ·
check_inventory (Woo/Magento) · get_store (Woo/Magento). Wix 9, WooCommerce 12, Magento 12.

A semantic action composes several endpoints: Woo find_customer = /customers + guest /orders; Woo tracking =
Shipment Tracking → AST → `_wc_shipment_tracking_items` → any *tracking* meta; Wix get_order = order +
transactions + fulfilments; Wix refund = transactions + refundability + refund-payments; Magento get_order =
order + shipments + invoices; Magento refund = invoices + credit memo.

Bounds are server-side: cancel/address change only pre-dispatch (Woo also requires no tracking recorded; Magento
only new/pending_payment and never invoiced); refunds capped at the remaining refundable balance, unpaid orders
refused, and a refund never silently becomes "record only" (`refund_payment=false` / `external_refund=true` /
`online=false` must be explicit). No store-wide order search. Clients never retry a non-GET after a timeout/5xx.

## Dropped on purpose
Wix fulfilment create/update/delete; Magento revenue/sales analytics and product attribute writes; every WooCommerce
admin/CRUD/report/meta/WordPress tool; WooCommerce optional WordPress username/password config.

## Breaking
Tool names changed → existing playbook @-mention chips for these plugins point at old names (alpha; chips render the
raw name). Workers cache tool descriptors on start, so restart/rebuild the plugin to see the new tools.

## Verification
vitest: wix 35, woocommerce 37, magento 31 (mocked fetch + stdio list-tools smoke pinning exact names); plugin tsc
builds; typecheck:server; root lint; dashboard nuxt typecheck (from the main checkout). Independent reviewer run on
the diff; all H/M/L findings fixed in d504c6a (table in tasks/todo.md). Not verified live: Wix address PATCH,
Magento address PUT, Woo tracking endpoints (documented as assumptions in each README).

## Docs
hay-docs PR: branch claude/commerce-semantic-actions (user-guide pages for the three integrations + overview blurbs +
permissions section + plugin quick-reference). Submodule pointer not bumped here.

## hay.chat website lines to change (separate hay-website PR, not edited here)
- src/_data/integrations.js: woocommerce.actions 113 → 12 (the "113 + 7 WordPress" comment is obsolete),
  wix.actions 11 → 9, magento.actions 14 → 12; these feed llms.njk:50-51 and wordpress-chat-plugin.njk:201.
- src/integrations/woocommerce-integration.md: :4 "113 WooCommerce actions available"; :20 / :40 / :50-51 "Process
  refunds through Stripe" / "Works With Stripe" (Woo refunds go through the store's own gateway via
  /orders/{id}/refunds; Stripe is a separate plugin); :28 "update quantities, modify variations" (no product writes);
  :56-57 "113 WooCommerce Actions".
- src/integrations/wix-ai-chatbot.njk: :5 "11 native actions"; :31 and :66-71 (11 / 7 read / 4 write → 9 / 6 read /
  3 write: cancel, address change, refund); :48, :105-106, :199, :209, :219 "Get Order Fulfilments" and
  "Create/Update Fulfilment" (now wix_get_order_tracking; no fulfilment writes); :126 "11 native Wix actions …
  fulfilment"; :229 "Four of the eleven … write"; :254 scope "Order Fulfillments (manage)" → "(read)"; :258 the
  action list.
- src/integrations/wix.md:5 "tracks … refunds, and fulfilment" → orders, tracking, refunds, customers and products.
- src/integrations/magento.md:5 "Connect to Magento for order management" → orders, tracking, refunds, customers,
  products (integrations.js still points Magento at "/integrations/").
- src/integrations/wordpress-chat-plugin.njk:80 "changes an order's status" → cancels undispatched orders, changes
  shipping addresses; :201 "… customers and coupons" (no coupons).
- src/docs/content/** is the hay-docs submodule: bump it after the hay-docs PR merges.
- Compare pages (crisp.md:106, gorgias.md:35/99, tidio-lyro.md:104, intercom-fin.md:33/54/128, zendesk-ai.md:117/150,
  compare/index.njk:29) claim refunds and order changes on WooCommerce and the same depth on Magento — now accurate,
  no change needed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
