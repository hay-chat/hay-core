# Correios (Hay.chat plugin)

Read-only shipment tracking for the Brazilian postal service. Archetype A: a
local stdio MCP server in `mcp/` calls the Correios CWS REST APIs (Token + SRO
Rastro) with the merchant's own contract credentials.

## Connect

There is no Hay.chat-wide Correios key: each merchant connects their own
contract. In the plugin settings they enter:

| Field              | What it is                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correios user      | The Meu Correios user of the company account (idCorreios, usually the CNPJ).                                                                       |
| API access code    | The "código de acesso" generated in [CWS](https://cws.correios.com.br) → Gestão de acesso a APIs. Stored encrypted. Not the Meu Correios password. |
| Cartão de postagem | The posting card number. Enter this, the contract number, or both.                                                                                 |
| Contract number    | The Correios contract number. Needed only without a cartão de postagem.                                                                            |
| Stale tracking     | Days without movement after which a shipment counts as stuck (default 5).                                                                          |

Requirements on the Correios side: a company (PJ) Meu Correios account, a
commercial contract, and API Rastro enabled for it.

The connection test (`onValidateAuth`) asks the Token API for a token with the
entered credentials.

## Tool

| Tool                      | Risk | What it does                                                                                                                                                                                                                                                     |
| ------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `correios_track_shipment` | read | Tracks one object by its 13-character code (`AA123456789BR`; spaces, hyphens and lower case accepted): status, latest event, history (newest first, up to 20), delivery date, Correios' expected date, stale-tracking flag, and a `summary` the agent can relay. |

- `status` is `in_transit`, `out_for_delivery`, `awaiting_pickup` or `delivered`;
  `statusDescription` and event descriptions are Correios' own Portuguese text.
- `tracking` is the shared stale-tracking result (`@hay/plugin-sdk/stale-tracking`):
  `isStale` when the parcel is not delivered and its latest event is older than
  the configured number of days.
- The result carries no personal data (recipient and sender fields are dropped),
  so the tool does not need a verified customer.
- **Object not found.** Since a 2025 security change, API Rastro only returns
  objects posted under the caller's own contract. For any other code (mistyped,
  not posted yet, posted by a marketplace or another contract) the tool answers
  `NOT_FOUND`, explains this, and gives the public tracking page
  (`https://rastreamento.correios.com.br/app/index.php`).
- Errors use the shared codes: `BAD_INPUT` (malformed code, no request sent),
  `AUTH_FAILED` (credentials rejected), `SCOPE_MISSING` (contract not authorised
  for API Rastro), `RATE_LIMITED`, `PROVIDER_DOWN`.

Out of scope for now: price and delivery-time quotes, pre-posting, reverse
logistics, tracking webhooks.

## Correios API notes

Verified against the public OpenAPI documents
(`https://api.correios.com.br/token/v3/api-docs`,
`https://api.correios.com.br/srorastro/v3/api-docs`), the
[Token API manual](https://www.correios.com.br/atendimento/developers/manuais/manual-uso-da-api-token),
the [CWS manual](https://www.correios.com.br/atendimento/developers/manuais/correioswebservice)
and unauthenticated calls to the production gateway:

- `POST /token/v1/autentica/cartaopostagem` with body `{ numero, contrato? }`, or
  `POST /token/v1/autentica/contrato` with body `{ numero }`, and
  `Authorization: Basic base64(user:accessCode)` → `201 { token, expiraEm, zoneOffset, … }`.
- A token lasts 24 hours; Correios returns the same one until 30 minutes before
  `expiraEm`, and limits the Token API to 3 requests per second. The MCP server
  caches the token until 5 minutes before `expiraEm`.
- `GET /srorastro/v1/objetos/{codigoObjeto}?resultado=T` with
  `Authorization: Bearer <token>` → `200 { objetos: [{ codObjeto, tipoPostal, dtPrevista, mensagem, eventos: [{ codigo, tipo, dtHrCriado, descricao, detalhe, unidade, unidadeDestino, dtLimiteRetirada }] }] }`.
- Errors are `{ msgs: string[] }`. A bad bearer token gets `403 GTW-006: Token inválido.`
  (the server drops its token and retries once); a wrong user or access code gets
  `401` with an empty body.

Not verifiable without credentials, marked `TODO(verify)` in the code:

- Whether `dtHrCriado` / `expiraEm` come without a UTC offset (read as Brasília
  time, UTC-03:00) and the format of `zoneOffset` (`mcp/lib/dates.js`).
- Event codes: `BDE`/`BDI`/`BDR` with `tipo` `01` as delivered (from the legacy
  SRO XML manual), `OEC` as out for delivery, `LDI` as awaiting pickup
  (`mcp/lib/tracking.js`). A delivery is also recognised by its description
  ("Objeto entregue ao destinatário").
- That an unknown object comes back as `200` with `mensagem` on the object and no
  events. An empty answer and a `404` are handled the same way.

Only production (`api.correios.com.br`) is supported; the homologation host is
not configurable.

## Develop

```bash
npm install --workspace=plugins/core/correios
npm run build --workspace=plugins/core/correios
cd plugins/core/correios && npm test   # mocked HTTP, no Correios account needed
```

`mcp/` is plain CommonJS with its own `package.json` and `package-lock.json`,
outside the npm workspace. `scripts/build-plugins.sh`, CI and the Dockerfile
install its dependencies (`npm ci` inside `mcp/`); `mcp/node_modules` is not
committed.
