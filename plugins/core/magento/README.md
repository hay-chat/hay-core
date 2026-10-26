# Magento plugin

Connects a Magento 2 (Adobe Commerce) store to Hay so the agent can find a customer's orders,
track shipments, cancel or re-route unshipped orders, issue refunds, and answer product and stock
questions — the same semantic action set as the Shopify, WooCommerce and Wix connectors.

## How it connects

Two settings: **Magento Base URL** (`https://yourdomain.com/rest/V1`) and an **API Token** from an
integration (System → Integrations) with access to the Sales, Catalog and Customers resources. Hay
verifies them against `/store/storeConfigs` on save.

## Tools

One tool per support action, not per Magento endpoint. The previous server (vendored from a
GPL-licensed merchant-analytics project) exposed catalog reads, a catalog write and revenue
reports; it is replaced by an original implementation. All names are prefixed `magento_` so they
never collide with another store plugin in the same organisation.

| Tool                                    | What it does                                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `magento_get_store`                     | Store code, base URL, currency, locale (connectivity check)                                                 |
| `magento_find_customer`                 | Email → account (`/customers/search`) **and** orders by `customer_email` (guests), with 5 recent orders     |
| `magento_list_customer_orders`          | Paged order history for an email                                                                            |
| `magento_get_order`                     | Order by entity id **or** increment id, merged with shipments + invoices; `supportSummary`                  |
| `magento_get_order_tracking`            | Shipments with their tracking numbers                                                                       |
| `magento_cancel_order`                  | Only orders that were never invoiced/paid (Magento's own rule); paid orders are pointed at the refund       |
| `magento_create_refund`                 | Credit memo: full, by item, or by amount; online via the paid invoice by default; capped at paid − refunded |
| `magento_update_order_shipping_address` | Before any shipment exists; merges onto the existing address entity (`PUT /orders/{id}`)                    |
| `magento_add_order_note`                | Order status-history comment, optionally customer-visible + emailed                                         |
| `magento_search_products`               | Enabled products by name                                                                                    |
| `magento_get_product`                   | Product by SKU + stock item + configurable children                                                         |
| `magento_check_inventory`               | Stock item for a SKU                                                                                        |

Deliberately absent: revenue / order-count / product-sales analytics (merchant BI, a data-exposure
vector under prompt injection), catalog writes, and store-wide order browsing.

### Refunds

Magento refunds are credit memos. `magento_create_refund` refunds **online** by default: it finds
the order's paid invoice and posts `/invoice/{id}/refund`, so the money goes back through the
payment gateway. If there is no invoice or the gateway declines, the error is returned with the
explicit fallback — refund elsewhere, then re-run with `online=false` to post `/order/{id}/refund`,
an offline credit memo that only records the refund. It never falls back to offline on its own.

## Build & test

```bash
npm run build --workspace=plugins/core/magento   # tsc for src/
npm test      --workspace=plugins/core/magento   # vitest: mocked-fetch unit tests + stdio list-tools smoke
```

`mcp/` is plain runtime JavaScript (`@modelcontextprotocol/sdk` + `zod` only); `scripts/build-plugins.sh`
runs `npm install` inside it at build time.

## Assumptions to verify against a live store

- `PUT /V1/orders/{id}` with `{ entity: <order address> }` is Magento's `OrderAddressRepository::save`
  route; the plugin sends the existing shipping address entity with the changed fields merged in.
- Online credit memos use `POST /V1/invoice/{invoiceId}/refund` with `isOnline: true`; an arbitrary
  partial amount is booked as `adjustment_positive` with zero-quantity item lines.
