# Shopify plugin (self-hosted)

Connect a Shopify store to Hay. Because Shopify [retired legacy custom apps on
Jan 1, 2026](https://changelog.shopify.com/posts/legacy-custom-apps-can-t-be-created-after-january-1-2026),
self-hosted Hay instances authenticate with a Dev Dashboard app via the
[client credentials grant](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant).
That grant issues access tokens that **expire every 24 hours** — this plugin
refreshes them automatically with a background cron job (HAY-221), so you only
ever paste in your Client ID and Client secret once.

## Self-hosted setup

1. **Create a Shopify Partners account** (free) at <https://partners.shopify.com>.
2. **Create an app in the Dev Dashboard** (Partners → _Dev Dashboard_ →
   _Apps_ → _Create app_). Configure the Admin API scopes your workflows need
   (e.g. `read_orders`, `read_customers`, `read_products`, `read_fulfillments`,
   `read_inventory`).
3. **Install the app on your store** from the Dev Dashboard.
4. **Copy the API credentials** — the app's **Client ID** and **Client secret**.
5. **Configure the Hay plugin** with:
   - **Store domain** — `yourstore.myshopify.com`
   - **Client ID**
   - **Client secret**
6. Save. Hay obtains a 24h access token immediately and **refreshes it every 20
   hours** automatically. No further action is needed.

## How the token refresh works (HAY-221)

- On enable / worker start, the plugin runs the client credentials grant and
  starts the Shopify MCP server with the fresh token.
- The plugin registers a cron job `refresh_shopify_token` (`0 */20 * * *`). Hay
  Core — not the worker — owns the schedule, so it survives worker idle-kills.
- When the cron fires, Core wakes the worker, the handler mints a new token and
  calls `ctx.auth.update(...)`. Core persists the new token (encrypted) and
  restarts the worker so the MCP server picks it up.

## Status

- ✅ Token acquisition + automatic 24h refresh (HAY-221).
- ⏳ Full Admin API tool surface — orders, customers, products, fulfillments,
  and write operations — is tracked in **HAY-219**. Today the MCP server exposes
  a single `shopify_get_shop` tool to verify connectivity.
