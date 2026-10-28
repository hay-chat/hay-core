# Next payment providers after Mercado Pago (D10 research)

Candidates for the next plugins on the `payment_provider` contract
([README.md](./README.md)): PagBank (PagSeguro), Pagar.me, Iugu, Vindi, Asaas.

How this was checked (2026-10-28): web searches plus the Pix-meta research
behind the WooCommerce Pix block (`plugins/core/woocommerce/mcp/lib/pix.js`).
**Verified** means an official doc page was found. **Unverified** means it came
from memory, a community SDK or a forum, and needs checking against the
provider's docs (or a sandbox) before building that plugin.

## What the contract needs from a provider

| Contract tool                   | API need                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `get_payment` / `find_payments` | Read a charge by id, and search by our order reference                           |
| `resend_payment`                | Read the stored Pix copy-paste code / QR URL of an unpaid charge (no new charge) |
| `refund`                        | Full and partial refund, ideally with an idempotency key                         |
| `refund_status`                 | Refund state readable afterwards, including a "processing" state                 |
| Auth                            | OAuth or another connect flow, so merchants paste no keys (Roger, D10)           |

## Comparison

| Provider             | Pix code readable later                                                                                                         | Refund (full / partial)                                                                                                                                 | Refund status                                                                                                                     | Connect without pasted keys                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **PagBank**          | Yes: order `qr_codes[].text` + PNG link (unverified field names; the Woo plugins store `_pagbank_pix_text` / `pix_qrcode_text`) | `POST /charges/{id}/cancel` with `amount.value`; partial allowed (unverified)                                                                           | On the charge (`status`, refund amounts); forum reports `refund_temporarily_unavailable` (40008) errors that succeed on retry [1] | **PagBank Connect**, an OAuth-style app authorisation (unverified details)                                       |
| **Pagar.me** (Stone) | Yes: charge `last_transaction.qr_code` / `qr_code_url` / `expires_at` (unverified)                                              | `DELETE /charges/{id}` with optional `amount`; omitted = full [2] **verified**                                                                          | Charge status + `last_transaction` (unverified)                                                                                   | **Pagar.me Hub** install flow for platforms (unverified); some partners onboard via PartnerHub with API keys [3] |
| **Asaas**            | Yes: `GET /payments/{id}/pixQrCode` returns `payload` + image (unverified endpoint; Woo plugin stores the payment object)       | `POST /payments/{id}/refund`; Pix allows a full or several partial refunds, total ≤ paid, fees not returned, 400 if balance too low [4][5] **verified** | Refund list on the payment; processing / denied states, webhooks recommended [5] **verified**                                     | No OAuth found; API key per account (sub-accounts for platforms) (unverified)                                    |
| **Iugu**             | Invoice holds the Pix code (unverified)                                                                                         | `POST /invoices/{id}/refund`, invoice-level; partial unclear [6] (community SDK only)                                                                   | Invoice status `refunded` / `partially_refunded` (unverified)                                                                     | Marketplace sub-accounts with API tokens; no merchant OAuth found (unverified)                                   |
| **Vindi**            | Pix only for direct API clients, not via plugins [7]                                                                            | Charge refund endpoint exists in the API (unverified) [8]                                                                                               | Charge status (unverified)                                                                                                        | API key; no OAuth found (unverified)                                                                             |

Pix refunds in general are the Central Bank's _devolução_: initiated by the
receiver, linked to the original transaction, full or partial, within 90 days
[9]. Every provider above exposes some "processing" window, so
`refund_status` must keep reporting `pending` until the provider confirms.

## Recommended order

1. **PagBank.** Biggest Brazilian install base after Mercado Pago, two Woo
   plugins already parsed by the Pix block, and an app-authorisation flow that
   fits "OAuth from day one". Check first: the Connect flow details and the
   retry behaviour of `refund_temporarily_unavailable` (map to `PROVIDER_DOWN`).
2. **Pagar.me.** Verified partial refund API; strong with larger stores. Check
   first: whether Pagar.me Hub gives tokens without the merchant pasting keys.
3. **Asaas.** Best documented Pix refunds, but no OAuth found. Build only if
   Roger accepts a sub-account or key-based connect for it, or Asaas offers OAuth.
4. **Iugu, Vindi.** Low install signal among Hay.chat's target stores, no
   merchant OAuth found and thin public docs. Revisit on customer demand.

## Sources

1. PagBank developer forum, `/cancel` refund errors (v1.0 docs): https://developer.pagbank.com.br/discuss/69411f43078f4f22281c440a
2. Pagar.me API v5, "Cancelar cobrança": https://docs.pagar.me/reference/cancelar-cobran%C3%A7a
3. Pagar.me client registration via PartnerHub (partner guide): https://alteg.io/en/support/knowledge-base/172291
4. Asaas, "Refund payment": https://docs.asaas.com/reference/refund-payment
5. Asaas, "Payment refund": https://docs.asaas.com/reference/payment-refund
6. Iugu PHP SDK (community, invoice refund method): https://packagist.org/packages/egcservices/iugu-php-sdk
7. Vindi Pix availability (NFE.io): https://nfe.io/blog/financeiro/pix-vindi/
8. Vindi PHP SDK (community): https://packagist.org/packages/devsitarget/sdk-vindi-php
9. Pix devolução overview (Juspay): https://docs.juspay.io/hypercheckout-global/android/pix-via-open-finance/refunds

PagBank docs home (Connect, orders, charges): https://developer.pagbank.com.br/
