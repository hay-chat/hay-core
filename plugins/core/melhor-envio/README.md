# Melhor Envio plugin

Connects a [Melhor Envio](https://melhorenvio.com.br) account (the Brazilian shipping-label
aggregator) to Hay so the agent can answer "where is my order" questions: shipment status, carrier
and service, tracking code and link, posting and delivery dates, and parcels that look stuck.

Read-only. Quoting freight, buying, generating or cancelling labels, and webhooks are out of scope.

## How it connects

Two connection modes, chosen with **Connection mode**:

- **Connect with Melhor Envio** (OAuth, the default when the server has the app): the merchant
  clicks Connect and approves Hay.chat in their Melhor Envio account. Hay requests only the
  `orders-read` permission. Core stores the tokens and refreshes them (access tokens last 30 days,
  refresh tokens 45).
- **Access token**: the merchant pastes a token generated in the Melhor Envio panel (Integrações →
  Permissões de acesso) with permission to view shipping labels (`orders-read`), plus a technical
  contact email. Stored encrypted.

Melhor Envio requires a `User-Agent` with the application name and a technical contact on every
request. The plugin sends `Hay (<contact email>)`, or `Hay (https://hay.chat)` when there is no
contact email (OAuth mode).

**Stale tracking (days)**: a posted shipment not delivered after more than this many days is flagged
as stuck. Default 5.

On save in token mode Hay lists the account's shipments (`GET /api/v2/me/orders`) to check the
token: the same permission the tools use, so a token that passes the check can also track.

Production only (`https://melhorenvio.com.br`). The sandbox is a separate account with its own
tokens and is not supported.

### Server setup for OAuth

Register one app for the whole Hay server in the Melhor Envio panel (Integrações → Área Dev. →
Cadastrar aplicativo). The callback URL must be exactly `${API_URL}/oauth/callback`; Melhor Envio
answers `Client invalid` when it differs. Then set:

| Variable                           | Value                                                            |
| ---------------------------------- | ---------------------------------------------------------------- |
| `MELHOR_ENVIO_OAUTH_CLIENT_ID`     | The app's Client ID. Unset = only the access-token mode is used. |
| `MELHOR_ENVIO_OAUTH_CLIENT_SECRET` | The app's Secret.                                                |
| `MELHOR_ENVIO_CONTACT_EMAIL`       | Optional technical contact email sent in the `User-Agent`.       |

Melhor Envio also hosts its own MCP server (`https://melhorenvio.com.br/mcp`, OAuth with dynamic
client registration). It exposes buying and cancelling labels as well and returns raw API objects,
so this plugin ships a small local server instead.

## Tools

One tool per support step, not per endpoint. Names are prefixed `melhorenvio_`.

| Tool                                  | What it does                                                                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `melhorenvio_track_shipment`          | Tracking code, Melhor Envio protocol (`ORD-…`) or shipment id (up to 5) → status, stage, carrier, service, tracking code and link, lifecycle dates, delivery estimate, stale flag, and a `summary` the agent can relay    |
| `melhorenvio_find_customer_shipments` | Recipient CPF/CNPJ → that customer's shipments, most recent first (max 10). Customer data: runs only for a verified customer and returns only shipments whose recipient email or phone is theirs; staff see any recipient |

Deliberately absent: listing all of the merchant's shipments by status (store-wide browsing is a
data-exposure vector under prompt injection) and search by recipient name or email (the API does
not offer it: `q` matches an id, protocol, tracking code, authorization code or document only).

What the agent gets back per shipment:

- `status` (Melhor Envio's own) and `stage`: `awaiting_payment`, `label_paid`, `awaiting_posting`,
  `dropped_off`, `in_transit`, `delivered`, `not_delivered`, `action_required`, `suspended`,
  `canceled`, `expired` or `unknown`, with a `statusDescription` sentence.
- `carrier`, `service`, `trackingCode`, `trackingUrl` (Melhor Rastreio page), `estimatedDeliveryDays`.
- `createdAt`, `paidAt`, `generatedAt`, `postedAt`, `deliveredAt`, `canceledAt`, `expiredAt`, as
  Melhor Envio reports them.
- `recipient`: first name, city and state only. No address, document, phone or email.
- `tracking` (while in transit): `isStale`, `daysSinceLastUpdate`, `thresholdDays`, `staleReason`,
  from `@hay/plugin-sdk/stale-tracking`.

The API reports a lifecycle status and its dates, not carrier scan events. "Last update" for the
stale flag is therefore the posting date, and the tracking link is where the customer sees events.

Errors are `{ code, retryable, message }` from `@hay/plugin-sdk/tool-errors`: `NOT_FOUND` with the
next step to try, `BAD_INPUT`, `PRECONDITION` (customer not verified), `AUTH_FAILED` (token expired
or revoked), `SCOPE_MISSING`, `RATE_LIMITED` (250 requests per minute per account), `PROVIDER_DOWN`.

## Build & test

```bash
npm run build --workspace=plugins/core/melhor-envio   # tsc for src/
npm test      --workspace=plugins/core/melhor-envio   # vitest: mocked-fetch unit tests + stdio list-tools smoke
```

`mcp/` is plain runtime JavaScript (`@modelcontextprotocol/sdk` + `zod` only, native `fetch`);
`scripts/build-plugins.sh` runs `npm install` inside it at build time.

## Assumptions to verify against a live account

Checked against docs.melhorenvio.com.br; there were no credentials to test a successful call. Each
is marked `TODO(verify)` in the code.

- The search route answers `400 { "error": "Not Found" }` when nothing matches (documented); a 404
  or an empty array are handled too.
- REST dates (`"2022-03-29 21:00:06"`, no zone) are Brasília time. Only the stale-day count depends
  on it.
- The cancelled status is spelled `canceled` (as in `canceled_at`) or `cancelled` (as in the
  `order.cancelled` webhook event); both are mapped. Whether an `expired` status exists is unknown;
  `expired_at` is read as a fallback.
- `https://www.melhorrastreio.com.br/rastreio/<code>` (the `tracking_url` shape in the webhook
  docs) opens with the carrier tracking code for every carrier.
- `delivery_min` / `delivery_max` are days; business or calendar is not documented.
- A panel-generated token works as a bearer token on `/api/v2/me/orders*` with the view-labels
  permission, and the exact menu labels for generating it. The reference documents the OAuth flow
  only; the panel token is described in Melhor Envio's own integration guide.
