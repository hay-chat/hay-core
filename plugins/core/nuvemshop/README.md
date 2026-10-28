# Nuvemshop / Tiendanube plugin

Connects a Nuvemshop (Brazil) or Tiendanube (Spanish-speaking LatAm) store — same platform, same
API, only the domains differ — so the agent can find a customer's orders, track shipments, cancel
or re-route undispatched orders, record refund requests honestly, send the Pix code of an unpaid
order, give capped goodwill coupons, and answer product and stock questions. With the `products`
capability it also syncs the catalogue into core for `recommend_products` and product cards.

## How it connects

A store-scoped **custom app** token:

1. Store admin → **Aplicativos a medida** (BR) / **Aplicaciones a medida** (ES) → create an app.
2. Permissions: read/write **orders**, **fulfillment orders**, **customers** and **coupons**;
   read **products**. (Coupons and fulfillment orders are new in v2: tokens created for v1 must be
   re-issued with them.)
3. Paste the **access token** (shown once) and the numeric **store ID** into the plugin settings.
   Hay verifies them against `GET /store`.

Tokens never expire; they are invalidated only when re-issued or when the app is uninstalled, so
there is no refresh cron. OAuth is not wired yet; see [OAuth (partner app)](#oauth-partner-app).

### Settings

| Field              | Default   | Meaning                                                     |
| ------------------ | --------- | ----------------------------------------------------------- |
| `storeId`          | —         | Numeric store id (the OAuth `user_id`)                      |
| `accessToken`      | —         | Custom-app token (encrypted)                                |
| `apiVersion`       | `2025-03` | API version in every path                                   |
| `couponsEnabled`   | `true`    | Allow `nuvemshop_create_coupon` at all                      |
| `couponMaxPercent` | `10`      | Largest % coupon; `0` turns % coupons off                   |
| `couponMaxAmount`  | `0`       | Largest fixed coupon in store currency; `0` turns fixed off |
| `couponMaxDays`    | `30`      | Coupon expiry ceiling (clamped to 1–365)                    |

The fixed-amount cap defaults to off because stores price in BRL, ARS, MXN, COP or CLP; one number
cannot be sensible for all of them.

## Tools

One tool per support action, all prefixed `nuvemshop_`. Reads merge endpoints and return
projections (never raw API objects); writes are bounded in code. Every tool declares MCP
annotations (`readOnlyHint`, `destructiveHint`), which core caches from `tools/list`
(`server/services/plugin-tools.service.ts`) and the dashboard turns into read / write / destructive
badges (`dashboard/utils/toolClassification.ts`).

| Tool                                      | Kind        | What it does / precondition                                                                                                                                                                   |
| ----------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nuvemshop_get_store`                     | read        | Name, URL, country, languages, currency, contact (connectivity check)                                                                                                                         |
| `nuvemshop_find_customer`                 | read        | Exact email (`?email=`, then verified `?q=`) or CPF/CNPJ/DNI (digits must match); guest orders by verified `contact_email`; 5 recent orders. No phone search: the API's `q` does not cover it |
| `nuvemshop_get_customer`                  | read        | Customer by id with addresses                                                                                                                                                                 |
| `nuvemshop_list_customer_orders`          | read        | By email: account orders via `customer_ids` (with total), guest orders via verified `q` (no total)                                                                                            |
| `nuvemshop_get_order`                     | read        | Id **or** customer-facing number (fuzzy `q` exhausted, exact match required). Payment (method, Pix status, card brand, installments, gateway), tracking, `supportSummary`                     |
| `nuvemshop_get_order_tracking`            | read        | Per fulfillment order: status, tracking code + URL, carrier, delivery window, latest carrier event, delivered date; legacy `shipping_tracking_*` fallback                                     |
| `nuvemshop_cancel_order`                  | destructive | Only open orders with no tracking code, no label and every fulfillment unpacked / in preparation / packed. Paid or authorized orders need `confirm_paid_cancellation`. Never refunds          |
| `nuvemshop_update_order_shipping_address` | write       | Same pre-dispatch rule; PATCHes each fulfillment order's `destination` (merged) and `recipient`. Refused for pickup                                                                           |
| `nuvemshop_add_order_note`                | write       | Appends a timestamped line to `owner_note` (the one note field; PUT replaces it, so the tool reads first)                                                                                     |
| `nuvemshop_check_refund_status`           | read        | Refund state, provider, refund events with dates (when transactions are readable), value history, how to refund                                                                               |
| `nuvemshop_request_refund`                | write       | Paid and not fully refunded; amount ≤ total − refunded (or ≤ total when unknown). Writes the request on the order, returns `moneyMoved: false` and `handoff: true`                            |
| `nuvemshop_get_payment_link`              | read        | Unpaid order only, and only after the shopper's email or phone (last 8 digits) matches the order. Pix QR/code, boleto or link from the transaction, if exposed and not expired                |
| `nuvemshop_create_coupon`                 | write       | Merchant cap enforced; generated `HAY…` code; single use; ≤ `couponMaxDays`; no combining, no shipping; one per order; the shopper's email must match the order; marker written to the order before the coupon                           |
| `nuvemshop_search_products`               | read        | Published products by text (names, descriptions, SKUs), optional category                                                                                                                     |
| `nuvemshop_get_product`                   | read        | Product + variants (options, price, promotional price, stock), plain-text description                                                                                                         |
| `nuvemshop_check_inventory`               | read        | `GET /products/sku/{sku}` → that variant's stock (multi-inventory levels summed; `null` stock = unlimited)                                                                                    |
| `nuvemshop_list_categories`               | read        | Categories for browsing                                                                                                                                                                       |

Deliberately absent: store-wide order browsing (a data-exposure vector under prompt injection),
product/customer CRUD, webhooks, scripts, shipping carriers, and any tool that claims to move money.

### Money: what the API cannot do

The Nuvemshop merchant API has **no endpoint that returns money**. Refunds are executed by the
payment provider (Nuvem Pago: admin → order → "Estornar pagamento"; Mercado Pago, PagBank and the
rest: their own panels). The Transactions API refund flow is reserved to payment-provider apps:
Nuvemshop calls the provider's `info.refund_url` when the merchant refunds. `POST /orders/{id}/cancel`
only changes status, stock and the customer email. So:

- `nuvemshop_request_refund` records the request where the merchant works and tells the agent to
  hand off; `refundCanBeExecutedByAgent` is always `false` in `supportSummary`.
- `nuvemshop_cancel_order` says explicitly that no money moved and points at `request_refund`.
- `nuvemshop_get_payment_link` returns nothing unless the transaction exposes it. The order has no
  shopper-facing payment link (`gateway_link` is the provider's transaction page for the merchant
  and is never returned).

### API quirks encoded in `mcp/lib/client.js`

- Auth header is `Authentication: bearer <token>` (not `Authorization`); `User-Agent` is mandatory.
- Leaky-bucket rate limit (about 2 req/s, burst 40): 429 carries `X-Rate-Limit-Reset` in ms. 429 is
  retried for any method; a 5xx, transport error or timeout is retried for GET only.
- 402 = the store's subscription lapsed and the API is suspended; 401 = token re-issued/uninstalled.
- List endpoints 404 past the last page; `q` is a contains-match over number, name and email.
- i18n fields are `{pt, es, en}` objects; flattened to the store's main language.
- `GET /orders/{id}/transactions` is documented "for payment apps": read best-effort, never required.

## Parity with WooCommerce and Shopify

| Support action           | Nuvemshop                                  | WooCommerce                      | Shopify                                 |
| ------------------------ | ------------------------------------------ | -------------------------------- | --------------------------------------- |
| Store info               | `get_store`                                | `get_store`                      | `get_shop`                              |
| Find customer            | `find_customer` (email, CPF; no phone)     | `find_customer` (email, phone)   | `find_customer`                         |
| Get customer by id       | `get_customer`                             | —                                | `get_customer`                          |
| List customer orders     | `list_customer_orders`                     | `list_customer_orders`           | `list_customer_orders`                  |
| Get order (id or number) | `get_order`                                | `get_order`                      | `get_order` + `get_order_by_name`       |
| Tracking                 | `get_order_tracking` (+ carrier events)    | `get_order_tracking`             | `get_order_tracking`                    |
| Cancel before dispatch   | `cancel_order`                             | `cancel_order`                   | `cancel_order`                          |
| Address change           | `update_order_shipping_address`            | `update_order_shipping_address`  | `update_order_shipping_address`         |
| Order note               | `add_order_note` (appends)                 | `add_order_note`                 | `add_order_note`                        |
| Refund quote / status    | `check_refund_status`                      | in `get_order`                   | `calculate_refund`                      |
| Refund                   | `request_refund` (records only: API limit) | `create_refund` (gateway)        | `create_refund`                         |
| Payment link / Pix       | `get_payment_link`                         | — (D10 ticket)                   | — (D10 ticket)                          |
| Goodwill coupon          | `create_coupon` (capped)                   | — (D16 ticket)                   | — (D16 ticket)                          |
| Product search / get     | `search_products`, `get_product`           | `search_products`, `get_product` | `search_products`, `get_product`        |
| Product by handle/URL    | —                                          | —                                | `get_product_by_handle`                 |
| Inventory by SKU         | `check_inventory`                          | `check_inventory`                | `check_inventory`                       |
| Categories               | `list_categories`                          | —                                | —                                       |
| Customer profile updates | —                                          | —                                | `update_customer`, `_address`           |
| Returns                  | — (no returns API)                         | —                                | `get_returnable_items`, `create_return` |
| Catalogue sync           | `products` capability                      | —                                | `products` capability                   |

## OAuth (partner app)

Not built; the custom-app token stays. What a Hay partner app needs:

1. **Register** an app in the Nuvemshop partner portal (the docs link `dev.nuvemshop.com.br`) with scopes `read_products,
write_orders, write_customers, write_coupons, write_fulfillment_orders`, redirect URL
   `https://<hay>/oauth/callback`, plus the mandatory App URL, Preferences URL, privacy policy,
   support URL/email and the three LGPD webhooks (`store/redact`, `customers/redact`,
   `customers/data_request`, HMAC `x-linkedstore-hmac-sha256`).
2. **Authorize**: `https://www.tiendanube.com/apps/{app_id}/authorize?state=…` (or the
   `nuvemshop.com.br` twin). The app id is in the path, scopes are fixed at registration, and the
   redirect URL comes from the app settings.
3. **Token exchange**: `POST https://www.tiendanube.com/apps/authorize/token` with `client_id`,
   `client_secret`, `grant_type=authorization_code`, `code` (code lives 5 minutes). The response is
   `{ access_token, token_type: "bearer", scope, user_id }`; `user_id` is the store id. Tokens do
   not expire.

Core's OAuth (`server/services/oauth.service.ts`, used by Shopify) is close but misses two things:
it substitutes only `{shop}` in the authorize URL (here the client id must go in the path), and
`storeTokens` keeps only `access_token`/`refresh_token`/`expires_at`/`scope`, dropping `user_id`.
`onConnected` cannot recover the store id from the token alone because every API path needs it.
The core change is small: a `{client_id}` placeholder in `initiateOAuth`, and keeping `user_id` (or
`store_id`) in the stored credentials. Then `src/index.ts` registers `auth.oauth2` and reads
`storeId` from the merged credentials. The token exchange already posts form-encoded
`grant_type/code/client_id/client_secret`; Nuvemshop documents a JSON body, so that needs checking
against the live endpoint.

## Build & test

```bash
npm run build --workspace=plugins/core/nuvemshop   # tsc for src/
npm test      --workspace=plugins/core/nuvemshop   # vitest: mocked-fetch unit tests + stdio list-tools smoke
```

`mcp/` is plain runtime JavaScript (`@modelcontextprotocol/sdk` + `zod` only);
`scripts/build-plugins.sh` runs `npm install` inside it at build time.

Not yet verified against a live store: fulfillment-order PATCH (merge vs replace of `destination`),
whether a merchant token may read `/transactions`, the exact shape of `refunded_amount`, and whether
`POST /coupons` accepts `max_uses`.
