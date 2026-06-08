# Shopify plugin

Connect a Shopify store to Hay so the agent can answer order/customer/product
questions and take actions (cancel, refund, update address) via the Shopify
Admin API. Two connection modes, chosen by the **Connection mode** (`authMode`)
setting:

## Managed (recommended) — `authMode = "oauth"`

One-click connect via hay.chat's Shopify App Store app. No app to create.

1. In the plugin settings, keep **Connection mode: Managed**, enter your
   **Store domain** (`yourstore.myshopify.com`), and save.
2. Click **Connect with Shopify** and approve the permissions on Shopify.
3. Done — Hay stores a long-lived offline access token and starts the MCP server.

**Operator setup (hay.chat side, once):**

- Set `SHOPIFY_OAUTH_CLIENT_ID` / `SHOPIFY_OAUTH_CLIENT_SECRET` (the App Store
  app's credentials) in the server env.
- Add `${API_URL}/oauth/callback` (e.g. `https://eu.hay.chat/oauth/callback`) to
  the Shopify app's **Allowed redirection URL(s)**.
- Hay substitutes the per-merchant `{shop}` into the authorize/token URLs
  automatically (generic `{shop}` support added in `oauth.service.ts`).

Managed offline tokens don't expire, so the refresh cron is a no-op in this mode.

## Self-hosted — `authMode = "self_hosted"`

For users who run their own Hay and create their own Shopify app. Because Shopify
[retired legacy custom apps (Jan 2026)](https://changelog.shopify.com/posts/legacy-custom-apps-can-t-be-created-after-january-1-2026),
this uses the [client credentials grant](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant),
whose tokens **expire every 24h** — the plugin refreshes them automatically.

1. Create a Shopify Partners account + an app in the **Dev Dashboard**; configure
   Admin API scopes; install it on your store.
2. In the plugin settings, set **Connection mode: Self-hosted** and enter your
   **Store domain**, **Client ID**, and **Client secret**.
3. Hay mints a token immediately and **refreshes it every 20 hours** via the
   `refresh_shopify_token` cron (HAY-221).

## Tools (MCP)

Admin GraphQL (version `apiVersion`, default `2026-04`), mode-agnostic:

- **Orders** — get / by-name / status / list-by-customer / search; **cancel**,
  **refund**, **add-note** (write).
- **Fulfillments** — tracking / WISMO.
- **Customers** — find-by-email / by-identifier / get; **update**, **address
  create + update** (write).
- **Products** — get / by-handle / search.
- **Inventory** — stock check by variant id or SKU.
- **Shop** — `shopify_get_shop` (connectivity check).

> Several Admin API specifics for `2026-04` are marked `// TODO(HAY-219 §8)` in the
> tool files and must be confirmed against a real dev store (see `tasks/HAY-219-plan.md` §8).
