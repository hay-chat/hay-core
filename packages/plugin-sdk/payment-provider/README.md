# Payment provider tool contract (`payment_provider`)

A payment provider plugin (Mercado Pago today; PagBank, Pagar.me, Asaas and others next) connects
the payment processor behind a store, so Hay.chat can answer "where is my refund?" with the
provider's real status, resend an unpaid Pix code, and refund within what was paid.

Every provider plugin exposes the **same five tools**, under its own prefix, with the **same shapes
and rules**. Playbooks and the agent can then treat providers alike. Core stays generic: it never
knows which providers exist. It only sees MCP tools and their risk classes.

Helpers live in `@hay/plugin-sdk/payment-provider` (plain CommonJS, usable from a local `mcp/`
server). The reference implementation is `plugins/core/mercadopago`.

## The tools

| Tool                      | Risk     | Does                                                                         |
| ------------------------- | -------- | ---------------------------------------------------------------------------- |
| `<prefix>_get_payment`    | `read`   | One payment, normalised. Never includes a Pix code.                          |
| `<prefix>_find_payments`  | `read`   | The payments behind a store order (from order references, see below).        |
| `<prefix>_resend_payment` | `read`   | Pix copy-paste code / payment link of an **unpaid** payment, after identity. |
| `<prefix>_refund`         | `refund` | Refund all or part of a paid payment. Bounded, idempotent.                   |
| `<prefix>_refund_status`  | `read`   | The payment's refunds with normalised status and dates.                      |

`contractToolNames(prefix)` gives the names and `contractToolRisk(prefix)` the
[tool-risk](../tool-risk/index.cjs) spec. Spread it into the plugin's
`mcp/tool-risk.js` so the refund tool is always the `refund` category: destructive, so Hay.chat holds
it for a person's approval under the org's action policy. Extra provider-specific tools are fine;
classify them too.

## Shapes

**Payment** (`get_payment`, `find_payments`, and the `payment` field of the others):

```jsonc
{
  "provider": "mercadopago",
  "paymentId": "123456789",
  "orderReference": "WC-1042", // provider's link to the store order, or null
  "status": "paid", // PAYMENT_STATUSES
  "providerStatus": "approved", // raw, for staff
  "providerStatusDetail": "accredited",
  "method": "pix", // pix | card | boleto | other
  "amount": 199.9,
  "currency": "BRL",
  "refundedAmount": 0, // done + pending refunds
  "refundableAmount": 199.9,
  "createdAt": "2026-10-27T14:03:11.000-03:00",
  "paidAt": "2026-10-27T14:04:02.000-03:00",
  "refunds": [
    /* Refund */
  ],
}
```

`PAYMENT_STATUSES`: `pending`, `authorized`, `paid`, `partially_refunded`, `refunded`,
`cancelled`, `failed`, `in_dispute`.

**Refund**: `{ refundId, status, providerStatus, amount, createdAt }`, where `status` is one of
`REFUND_STATUSES`: `pending`, `succeeded`, `failed`.

`pending` is the honest answer for a Pix refund the bank has not confirmed yet (Mercado Pago
`in_process`, Pagar.me `pending_refund`, Asaas `PENDING`). The tool's text must tell the agent not to
say the money has arrived. `succeeded` on a card means the provider sent it; when the shopper sees it
on the statement depends on their card issuer.

`assertPaymentShape(payment)` returns the list of contract violations; use it in plugin tests.

## Rules

1. **No Pix code outside `resend_payment`.** `get_payment` and `find_payments` never return the
   copy-paste code, QR image or payment link.
2. **Identity before payment details.** `resend_payment` takes the `email` or `phone` the shopper
   gave in the conversation and returns the code only when it matches the payer the provider has on
   the payment (`@hay/plugin-sdk/identity`). No match, nothing returned (`PRECONDITION`,
   `IDENTITY_MISMATCH`). When the provider has no payer email or phone, it refuses and points the
   agent to the store's own resend tool (`woocommerce_resend_pix`, `shopify_send_payment_link`),
   which checks the order's identity. This is Roger's D10 rule: the code goes out automatically once
   the shopper matches.
3. **Only unpaid, unexpired codes.** A paid, cancelled or expired payment returns `found: false` and
   a message telling the agent to send a fresh payment link from the store or hand off.
4. **Refunds are bounded.** `refundBound({ paidCents, refundedCents, requestedCents })` caps the
   amount at paid minus already refunded (done and pending). No amount means the full remainder.
   Over the cap, zero, or nothing left refuses with `PRECONDITION` / `BAD_INPUT` before any provider
   call. Work in integer cents (`toCents`).
5. **Refunds are idempotent.** Send `refundIdempotencyKey(...)` as the provider's idempotency key:
   the same request against the same payment state always collapses into one refund. Also check
   `findDuplicateRefund(...)` before posting: a same-amount refund created in the last 10 minutes is
   returned as `alreadyRequested: true` instead of a second refund. A 5xx or a network error on the
   refund call is `OUTCOME_UNKNOWN`: the agent checks `refund_status` before anything else.
6. **No legal deadlines.** Tools state provider facts (status, dates, amounts). They do not compute
   or state consumer-law deadlines (Art. 49 CDC withdrawal, Art. 132 counting): those wait for a
   lawyer's sign-off (D10-4/5).
7. **Errors** use the shared vocabulary in `@hay/plugin-sdk/tool-errors`. A 401 is `AUTH_FAILED`
   ("reconnect the provider").
8. **Auth** is OAuth wherever the provider offers it (no pasted API keys). The OAuth app's client
   id and secret come from the Hay.chat server env; with them unset the plugin page says connecting
   is unavailable.

## Finding the payment behind an order

Order tools expose what they know, and the agent passes it to `<prefix>_find_payments`:

| Store       | Field on the order tool                                                  | Notes                                                                 |
| ----------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| WooCommerce | `woocommerce_get_order` → `paymentReferences: [{ provider, paymentId }]` | Allowlisted gateway meta (Mercado Pago: `_Mercado_Pago_Payment_IDs`). |
| WooCommerce | `transactionId`, `id`                                                    | Fallbacks: id lookup, then `external_reference` search.               |
| Shopify     | `shopify_get_order` → `transactions[].paymentId` (+ `gateway`)           | Which id the provider's Shopify app stores is unverified.             |

`find_payments` takes `payment_ids` (any of the above) and/or `order_id`, and tries a direct lookup
for numeric ids, then the provider's order-reference search. The provider-specific candidate list
(e.g. Mercado Pago's Woo `WC-<id>` prefix) lives in the plugin.

## Adding a provider

1. Build the plugin with the `build-plugin` skill (archetype A, local `mcp/`).
2. Register the five contract tools with the prefix; map the provider's statuses to the enums.
3. `mcp/tool-risk.js`: spread `contractToolRisk(prefix)`.
4. Tests (mocked HTTP): `assertPaymentShape`, identity gate, refund bound, idempotency header,
   pending refund, every tool classified.
5. If the store plugins hold the provider's payment id in order meta, add the key to the
   WooCommerce `paymentReferences` allowlist (`plugins/core/woocommerce/mcp/lib/pix.js`).

Candidate providers and their APIs: [NEXT_PROVIDERS.md](./NEXT_PROVIDERS.md).
