/**
 * Shopify Plugin — HAY-219 (managed OAuth) + HAY-221 (self-hosted cron)
 *
 * Supports TWO connection modes, selected by the `authMode` config field:
 *
 * - **Managed** (`authMode = "oauth"`, default): the merchant connects via
 *   hay.chat's Shopify App Store app with one click. Hay Core runs the
 *   authorization_code OAuth flow using the shared SHOPIFY_OAUTH_CLIENT_ID /
 *   SHOPIFY_OAUTH_CLIENT_SECRET server env credentials and stores a long-lived
 *   offline access token. `onStart` reads that token from `ctx.auth.get()`.
 *
 * - **Self-hosted** (`authMode = "self_hosted"`): the merchant creates their own
 *   Shopify Dev Dashboard app and pastes its Client ID + secret. The plugin runs
 *   the client-credentials grant (24h tokens) and a cron refreshes them (HAY-221).
 *
 * Both modes feed the same Shopify Admin GraphQL MCP server (`./mcp`), which only
 * ever sees SHOPIFY_SHOP + SHOPIFY_ACCESS_TOKEN + SHOPIFY_API_VERSION.
 *
 * @see https://shopify.dev/docs/apps/build/authentication-authorization
 */

import { defineHayPlugin, type HayCronContext } from "@hay/plugin-sdk";

type AuthMode = "oauth" | "self_hosted";

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
 * Self-hosted only: perform the Shopify client credentials grant for a 24h token.
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

  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 24 * 60 * 60;
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

  return { accessToken: data.access_token, expiresAt };
}

/** Read the self-hosted credential triple from config. */
function readSelfHostedCredentials(ctx: {
  config: { getOptional: <T = unknown>(key: string) => T | undefined };
}): { shopDomain: string; clientId: string; clientSecret: string } | null {
  const shopDomain = ctx.config.getOptional<string>("shopDomain");
  const clientId = ctx.config.getOptional<string>("clientId");
  const clientSecret = ctx.config.getOptional<string>("clientSecret");
  if (!shopDomain || !clientId || !clientSecret) return null;
  return { shopDomain, clientId, clientSecret };
}

function getAuthMode(ctx: {
  config: { getOptional: <T = unknown>(key: string) => T | undefined };
}): AuthMode {
  return ctx.config.getOptional<AuthMode>("authMode") === "self_hosted" ? "self_hosted" : "oauth";
}

export default defineHayPlugin((globalCtx) => ({
  name: "Shopify",

  onInitialize(ctx) {
    globalCtx.logger.info("Initializing Shopify plugin");

    ctx.register.config({
      authMode: {
        type: "string",
        label: "Connection mode",
        description:
          "Managed: connect in one click via hay.chat's Shopify app. " +
          "Self-hosted: use your own Shopify app's Client ID and secret.",
        options: [
          { label: "Managed (recommended)", value: "oauth" },
          { label: "Self-hosted (own app)", value: "self_hosted" },
        ],
        default: "oauth",
        required: true,
      },
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
          "Self-hosted mode only. Your Shopify app's Client ID. " +
          "Managed mode resolves this from server configuration.",
        required: false,
        env: "SHOPIFY_OAUTH_CLIENT_ID",
        showWhen: { field: "authMode", equals: "self_hosted" },
      },
      clientSecret: {
        type: "string",
        label: "Client secret",
        description: "Self-hosted mode only. Your Shopify app's Client secret.",
        required: false,
        encrypted: true,
        env: "SHOPIFY_OAUTH_CLIENT_SECRET",
        showWhen: { field: "authMode", equals: "self_hosted" },
      },
      apiVersion: {
        type: "string",
        label: "Admin API version",
        description: "Shopify Admin API version to use.",
        default: "2026-04",
      },
    });

    // Managed: one-click OAuth. Hay Core substitutes {shop} from shopDomain and
    // resolves client id/secret from the SHOPIFY_OAUTH_CLIENT_* server env vars.
    ctx.register.auth.oauth2({
      id: "shopify-oauth",
      label: "Connect with Shopify",
      authorizationUrl: "https://{shop}/admin/oauth/authorize",
      tokenUrl: "https://{shop}/admin/oauth/access_token",
      scopes: [
        "read_orders",
        "write_orders",
        "read_customers",
        "write_customers",
        "read_products",
        "read_inventory",
        "read_fulfillments",
        "write_fulfillments",
      ],
      clientId: ctx.config.field("clientId"),
      clientSecret: ctx.config.field("clientSecret"),
    });

    // Self-hosted: client-credentials path. Validating the secret runs the grant.
    ctx.register.auth.apiKey({
      id: "shopify-credentials",
      label: "Self-hosted app credentials",
      configField: "clientSecret",
    });

    // HAY-221: refresh the 24h self-hosted token every 20h (no-op in managed mode).
    ctx.register.cron({
      name: "refresh_shopify_token",
      schedule: "0 */20 * * *",
      handler: refreshTokenHandler,
      retryPolicy: { maxRetries: 3, backoff: "exponential" },
    });

    globalCtx.logger.info("Shopify plugin config, auth and cron registered");
  },

  async onValidateAuth(ctx) {
    const mode = getAuthMode(ctx);
    ctx.logger.info("Validating Shopify credentials", { authMode: mode });

    const shopDomain = ctx.config.getOptional<string>("shopDomain");
    if (!shopDomain) {
      throw new Error("Store domain is required");
    }

    if (mode === "oauth") {
      // Managed: the OAuth flow proves credentials. Here we only require the
      // store domain so Hay can build the per-shop authorize URL.
      return true;
    }

    // Self-hosted: actually run the grant to prove the Client ID/secret work.
    const creds = readSelfHostedCredentials(ctx);
    if (!creds) {
      throw new Error("Self-hosted mode requires Store domain, Client ID and Client secret");
    }
    try {
      await clientCredentialsGrant(creds.shopDomain, creds.clientId, creds.clientSecret);
      ctx.logger.info("Shopify self-hosted credentials validated");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.logger.error("Failed to validate Shopify credentials", { error: message });
      throw new Error(`Could not authenticate with Shopify: ${message}`);
    }
  },

  async onStart(ctx) {
    const mode = getAuthMode(ctx);
    ctx.logger.info("Starting Shopify plugin for org", { orgId: ctx.org.id, authMode: mode });

    const shopRaw = ctx.config.getOptional<string>("shopDomain");
    if (!shopRaw) {
      ctx.logger.info("Shopify: no store domain configured yet — MCP not started.");
      return;
    }
    const shop = normalizeShopDomain(shopRaw);
    const apiVersion = ctx.config.getOptional<string>("apiVersion") || "2026-04";

    let accessToken: string | undefined;

    if (mode === "oauth") {
      // Managed: the offline access token was minted by Core's OAuth exchange.
      const authState = ctx.auth.get();
      if (authState?.methodId === "shopify-oauth") {
        accessToken = String(authState.credentials.accessToken ?? "") || undefined;
      }
      if (!accessToken) {
        ctx.logger.info(
          "Shopify managed mode: not connected yet (no access token). " +
            "Click Connect in the plugin settings. MCP not started.",
        );
        return;
      }
    } else {
      // Self-hosted: run the client-credentials grant for a fresh token.
      const creds = readSelfHostedCredentials(ctx);
      if (!creds) {
        ctx.logger.info("Shopify self-hosted: credentials missing — MCP not started.");
        return;
      }
      try {
        const token = await clientCredentialsGrant(
          creds.shopDomain,
          creds.clientId,
          creds.clientSecret,
        );
        accessToken = token.accessToken;
      } catch (error) {
        ctx.logger.error("Failed to obtain Shopify access token on start", error);
        return; // Stay installed but degraded; the cron will retry.
      }
    }

    try {
      await ctx.mcp.startLocalStdio({
        id: "shopify-mcp",
        command: "node",
        args: ["index.js"],
        cwd: "./mcp",
        env: {
          SHOPIFY_SHOP: shop,
          SHOPIFY_ACCESS_TOKEN: accessToken,
          SHOPIFY_API_VERSION: apiVersion,
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
 * Cron handler (self-hosted only): mint a fresh 24h access token via the client
 * credentials grant and persist it. Managed mode uses non-expiring offline tokens,
 * so this is a no-op there.
 */
async function refreshTokenHandler(ctx: HayCronContext): Promise<void> {
  const mode =
    ctx.config.getOptional<AuthMode>("authMode") === "self_hosted" ? "self_hosted" : "oauth";
  if (mode === "oauth") {
    ctx.logger.info("Shopify managed mode — offline token does not expire, skipping refresh");
    return;
  }

  ctx.logger.info("Refreshing Shopify access token (self-hosted)");

  const shopDomain = ctx.config.getOptional<string>("shopDomain");
  const clientId = ctx.config.getOptional<string>("clientId");
  const clientSecret = ctx.config.getOptional<string>("clientSecret");

  if (!shopDomain || !clientId || !clientSecret) {
    ctx.logger.warn("Shopify credentials missing — skipping token refresh");
    return;
  }

  const token = await clientCredentialsGrant(shopDomain, clientId, clientSecret);

  ctx.auth.update(
    { accessToken: token.accessToken, expiresAt: token.expiresAt },
    "shopify-credentials",
  );

  ctx.logger.info("Shopify access token refreshed", { expiresAt: token.expiresAt });
}
