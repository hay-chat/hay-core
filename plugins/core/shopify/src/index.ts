/**
 * Shopify Plugin (self-hosted) — HAY-221
 *
 * Shopify deprecated legacy custom apps (Jan 1, 2026). Self-hosted Hay users now
 * create their own app in the Shopify Dev Dashboard and authenticate via the
 * **client credentials grant**, which issues access tokens that expire every 24
 * hours. This plugin stores the app's `clientId` + `clientSecret`, obtains a token
 * on demand, and registers a cron job that refreshes the token every 20 hours
 * (buffer before the 24h expiry) — keeping the Shopify MCP server authenticated
 * without any core changes.
 *
 * The token-refresh cron is the focus of HAY-221. The full Admin API tool surface
 * (orders, customers, products, fulfillments) is HAY-219 — the MCP here exposes a
 * single `shopify_get_shop` tool to prove the token round-trips.
 *
 * @see https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant
 */

import { defineHayPlugin, type HayCronContext } from "@hay/plugin-sdk";

/** Strip protocol / trailing slash from a shop domain (mystore.myshopify.com). */
function normalizeShopDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

interface ShopifyToken {
  accessToken: string;
  /** Unix epoch seconds when the token expires. */
  expiresAt: number;
}

/**
 * Perform the Shopify client credentials grant to obtain a fresh access token.
 *
 * @see https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant
 */
async function clientCredentialsGrant(
  shopDomain: string,
  clientId: string,
  clientSecret: string,
): Promise<ShopifyToken> {
  const shop = normalizeShopDomain(shopDomain);
  const url = `https://${shop}/admin/oauth/access_token`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Shopify client credentials grant failed (HTTP ${response.status}): ${text.slice(0, 200)}`,
    );
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error("Shopify token response did not include an access_token");
  }

  // Shopify access tokens from this grant last 24h; default defensively if absent.
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 24 * 60 * 60;
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

  return { accessToken: data.access_token, expiresAt };
}

/** Read + validate the three config fields needed for the grant. */
function readCredentials(ctx: {
  config: { getOptional: <T = unknown>(key: string) => T | undefined };
}): { shopDomain: string; clientId: string; clientSecret: string } | null {
  const shopDomain = ctx.config.getOptional<string>("shopDomain");
  const clientId = ctx.config.getOptional<string>("clientId");
  const clientSecret = ctx.config.getOptional<string>("clientSecret");
  if (!shopDomain || !clientId || !clientSecret) return null;
  return { shopDomain, clientId, clientSecret };
}

export default defineHayPlugin((globalCtx) => ({
  name: "Shopify",

  onInitialize(ctx) {
    globalCtx.logger.info("Initializing Shopify plugin");

    ctx.register.config({
      shopDomain: {
        type: "string",
        label: "Store domain",
        description: "Your myshopify.com domain, e.g. mystore.myshopify.com (without https://).",
        placeholder: "mystore.myshopify.com",
        required: true,
      },
      clientId: {
        type: "string",
        label: "Client ID",
        description:
          "Your Shopify app's Client ID. Create an app in the Shopify Dev Dashboard " +
          "(Settings → Apps) and copy the Client ID from its API credentials.",
        required: true,
      },
      clientSecret: {
        type: "string",
        label: "Client secret",
        description:
          "Your Shopify app's Client secret. Treated as a secret; Hay uses it to mint and " +
          "refresh 24h access tokens automatically.",
        required: true,
        encrypted: true,
      },
      apiVersion: {
        type: "string",
        label: "Admin API version",
        description: "Shopify Admin API version to use.",
        default: "2026-04",
      },
    });

    // The user-entered credential is the client secret; validating it runs the grant.
    ctx.register.auth.apiKey({
      id: "shopify-credentials",
      label: "Shopify App Credentials",
      configField: "clientSecret",
    });

    // HAY-221: refresh the 24h token every 20 hours.
    ctx.register.cron({
      name: "refresh_shopify_token",
      schedule: "0 */20 * * *",
      handler: refreshTokenHandler,
      retryPolicy: { maxRetries: 3, backoff: "exponential" },
    });

    globalCtx.logger.info("Shopify plugin config, auth and cron registered");
  },

  async onValidateAuth(ctx) {
    ctx.logger.info("Validating Shopify credentials");

    const creds = readCredentials(ctx);
    if (!creds) {
      throw new Error("Store domain, Client ID and Client secret are all required");
    }

    try {
      await clientCredentialsGrant(creds.shopDomain, creds.clientId, creds.clientSecret);
      ctx.logger.info("Shopify credentials validated successfully");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.logger.error("Failed to validate Shopify credentials", { error: message });
      throw new Error(`Could not authenticate with Shopify: ${message}`);
    }
  },

  async onStart(ctx) {
    ctx.logger.info("Starting Shopify plugin for org", { orgId: ctx.org.id });

    const creds = readCredentials(ctx);
    if (!creds) {
      ctx.logger.info(
        "Shopify credentials not configured — plugin enabled but MCP tools unavailable. " +
          "Add your store domain, Client ID and Client secret in the plugin settings.",
      );
      return;
    }

    let token: ShopifyToken;
    try {
      token = await clientCredentialsGrant(creds.shopDomain, creds.clientId, creds.clientSecret);
    } catch (error) {
      ctx.logger.error("Failed to obtain Shopify access token on start", error);
      return; // Stay installed but degraded; the cron will retry.
    }

    try {
      await ctx.mcp.startLocalStdio({
        id: "shopify-mcp",
        command: "node",
        args: ["index.js"],
        cwd: "./mcp",
        env: {
          SHOPIFY_SHOP: normalizeShopDomain(creds.shopDomain),
          SHOPIFY_ACCESS_TOKEN: token.accessToken,
          SHOPIFY_API_VERSION: ctx.config.getOptional<string>("apiVersion") || "2026-04",
        },
      });
      ctx.logger.info("Shopify MCP server started successfully");
    } catch (error) {
      ctx.logger.error("Failed to start Shopify MCP server", error);
      throw error;
    }
  },

  async onConfigUpdate(ctx) {
    // The platform restarts the stdio MCP server with fresh env after this hook.
    ctx.logger.info("Shopify plugin config updated");
  },

  async onDisable(ctx) {
    ctx.logger.info("Shopify plugin disabled for org", { orgId: ctx.org.id });
  },
}));

/**
 * Cron handler: mint a fresh access token via the client credentials grant and
 * persist it. Hay Core restarts the worker afterwards so the MCP server picks up
 * the new token.
 */
async function refreshTokenHandler(ctx: HayCronContext): Promise<void> {
  ctx.logger.info("Refreshing Shopify access token");

  const shopDomain = ctx.config.getOptional<string>("shopDomain");
  const clientId = ctx.config.getOptional<string>("clientId");
  const clientSecret = ctx.config.getOptional<string>("clientSecret");

  if (!shopDomain || !clientId || !clientSecret) {
    ctx.logger.warn("Shopify credentials missing — skipping token refresh");
    return;
  }

  const token = await clientCredentialsGrant(shopDomain, clientId, clientSecret);

  ctx.auth.update({ accessToken: token.accessToken, expiresAt: token.expiresAt }, "shopify-oauth");

  ctx.logger.info("Shopify access token refreshed", { expiresAt: token.expiresAt });
}
