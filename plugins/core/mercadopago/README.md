# Mercado Pago (Hay.chat plugin)

First payment provider on the shared `payment_provider` contract
(`packages/plugin-sdk/payment-provider/README.md`). Archetype A: a local stdio
MCP server in `mcp/` wraps the Mercado Pago REST API.

## Connect

OAuth only. The OAuth app is Hay.chat's own Mercado Pago application; its
credentials come from the server env (`MERCADOPAGO_CLIENT_ID`,
`MERCADOPAGO_CLIENT_SECRET`, see `.env.example`). When they are unset the plugin
page says connecting is unavailable.

Application setup (mercadopago.com.br/developers/panel/app):

- Redirect URL: `${API_URL}/oauth/callback`
- PKCE enabled (core always sends `code_challenge`)
- Permissions: read, write, offline_access

Core runs the flow, stores the tokens and refreshes them (access tokens last
180 days). The worker passes the seller's access token to the MCP server as
`MERCADOPAGO_ACCESS_TOKEN`.

## Tools

| Tool                         | Risk                                    | What it does                                                                                                                                                                            |
| ---------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mercadopago_get_payment`    | read                                    | One payment in the contract shape. Never returns the Pix code.                                                                                                                          |
| `mercadopago_find_payments`  | read                                    | Payments behind an order: WooCommerce `paymentReferences` / `transactionId`, Shopify `transactions[].paymentId`, or the order id (searched as `external_reference`, also as `WC-<id>`). |
| `mercadopago_resend_payment` | read                                    | Pix copy-paste code + payment page of a pending payment, only after the shopper's email or phone matches the payer.                                                                     |
| `mercadopago_refund`         | refund (destructive, held for approval) | Full or partial refund, bounded by what is still refundable, with a deterministic idempotency key and a 10-minute duplicate guard.                                                      |
| `mercadopago_refund_status`  | read                                    | Refunds of a payment; a Pix refund the bank has not confirmed is `pending`.                                                                                                             |

## Develop

```bash
npm install --workspace=plugins/core/mercadopago
npm run build --workspace=plugins/core/mercadopago
cd plugins/core/mercadopago && npx vitest run   # mocked HTTP, no account needed
```

`mcp/` is plain CommonJS with its own `package.json`; install its deps with
`npm install` inside `mcp/` when running it outside the monorepo.
