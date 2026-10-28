import { defineHayPlugin } from "@hay/plugin-sdk";
import { bulkSync, createWooGet } from "./catalog.js";

/** Re-sync the catalog this often while the worker runs (core keeps it alive). */
const CATALOG_RESYNC_MS = 6 * 60 * 60 * 1000;
let resyncTimer: ReturnType<typeof setInterval> | undefined;

/**
 * WooCommerce Plugin
 *
 * Connects a WooCommerce store so the agent can find a customer's orders,
 * track shipments, cancel or re-route undispatched orders, issue refunds and
 * answer product/stock questions — one semantic tool per support action (see
 * mcp/README.md), not one tool per REST endpoint.
 *
 * Spawns a local Node MCP server (./mcp/index.js) that calls the WooCommerce
 * REST API (wc/v3) with the store's consumer key + secret.
 *
 * With the `products` capability, `onStart` also mirrors the catalog (products
 * and variations) into core via `ctx.productSource` so `recommend_products`
 * works, and re-syncs every few hours while the worker runs (./catalog.ts).
 */
/** D6-13 "How to return" owner text → MCP env (unset = the agent hands off). */
function returnInstructionsEnv(config: {
  getOptional: <T = unknown>(key: string) => T | undefined;
}): Record<string, string> {
  const text = config.getOptional<string>("returnInstructions");
  return typeof text === "string" && text.trim() ? { RETURN_INSTRUCTIONS: text.trim() } : {};
}

/** D6-9 per-store stale-tracking thresholds → MCP env (the MCP falls back to 5/10). */
function staleTrackingEnv(config: {
  getOptional: <T = unknown>(key: string) => T | undefined;
}): Record<string, string> {
  const env: Record<string, string> = {};
  const domestic = config.getOptional<number | string>("staleTrackingDomesticDays");
  const international = config.getOptional<number | string>("staleTrackingInternationalDays");
  if (domestic !== undefined && domestic !== null && domestic !== "") {
    env.STALE_TRACKING_DOMESTIC_DAYS = String(domestic);
  }
  if (international !== undefined && international !== null && international !== "") {
    env.STALE_TRACKING_INTERNATIONAL_DAYS = String(international);
  }
  return env;
}

/**
 * D16 goodwill coupon cap → MCP env. Only set values are passed; the MCP
 * (@hay/plugin-sdk/coupon-policy) applies the defaults (on, 10%, fixed off, 30
 * days) and clamps bad values.
 */
function couponEnv(config: {
  getOptional: <T = unknown>(key: string) => T | undefined;
}): Record<string, string> {
  const env: Record<string, string> = {};
  const keys: Array<[string, string]> = [
    ["couponsEnabled", "WOOCOMMERCE_COUPONS_ENABLED"],
    ["couponMaxPercent", "WOOCOMMERCE_COUPON_MAX_PERCENT"],
    ["couponMaxAmount", "WOOCOMMERCE_COUPON_MAX_AMOUNT"],
    ["couponMaxDays", "WOOCOMMERCE_COUPON_MAX_DAYS"],
  ];
  for (const [key, name] of keys) {
    const value = config.getOptional<number | string | boolean>(key);
    if (value !== undefined && value !== null && value !== "") env[name] = String(value);
  }
  return env;
}

export default defineHayPlugin((globalCtx) => ({
  name: "WooCommerce",

  onInitialize(ctx) {
    globalCtx.logger.info("Initializing WooCommerce plugin");

    ctx.register.config({
      siteUrl: {
        type: "string",
        label: "WordPress Site URL",
        description: "Your WordPress/WooCommerce site URL (e.g., https://mystore.com)",
        required: true,
        encrypted: false,
      },
      consumerKey: {
        type: "string",
        label: "Consumer Key",
        description:
          "WooCommerce REST API Consumer Key (WooCommerce → Settings → Advanced → REST API, Read/Write)",
        required: true,
        encrypted: true,
      },
      consumerSecret: {
        type: "string",
        label: "Consumer Secret",
        description: "WooCommerce REST API Consumer Secret",
        required: true,
        encrypted: true,
      },
      couponsEnabled: {
        type: "boolean",
        label: "Allow goodwill coupons",
        description:
          "Let the agent create single-use apology coupons, restricted to the customer's email, " +
          "within the caps below. A coupon above the cap waits for a team member to approve it.",
        default: true,
      },
      couponMaxPercent: {
        type: "number",
        label: "Coupon cap: maximum percentage",
        description:
          "Largest percentage discount the agent may give (0 turns percentage coupons off).",
        default: 10,
      },
      couponMaxAmount: {
        type: "number",
        label: "Coupon cap: maximum fixed amount",
        description:
          "Largest fixed discount in your store currency (0 or empty turns fixed-amount coupons off).",
        default: 0,
      },
      couponMaxDays: {
        type: "number",
        label: "Coupon validity (days)",
        description: "Coupons the agent creates expire after at most this many days.",
        default: 30,
      },
      staleTrackingDomesticDays: {
        type: "number",
        label: "Stale tracking: domestic (days)",
        description:
          "Treat a domestic shipment as stuck when its tracking has not moved for more than " +
          "this many days.",
        default: 5,
      },
      staleTrackingInternationalDays: {
        type: "number",
        label: "Stale tracking: international (days)",
        description:
          "Treat an international shipment as stuck when its tracking has not moved for more " +
          "than this many days.",
        default: 10,
      },
      returnInstructions: {
        type: "string",
        label: "How to return",
        description:
          "Your return process, in your words: where to send items, any link or form, and " +
          "deadlines. Hay.chat relays it as written when a customer asks how to return " +
          "something. Leave empty and Hay.chat hands those questions to your team.",
      },
    });

    ctx.register.auth.apiKey({
      id: "woocommerce-apikey",
      label: "WooCommerce API Key",
      configField: "consumerKey",
    });

    globalCtx.logger.info("WooCommerce plugin config and auth methods registered");
  },

  async onValidateAuth(ctx) {
    ctx.logger.info("Validating WooCommerce credentials");

    const siteUrl = ctx.config.get<string>("siteUrl");
    const consumerKey = ctx.config.get<string>("consumerKey");
    const consumerSecret = ctx.config.get<string>("consumerSecret");

    if (!siteUrl || !consumerKey || !consumerSecret) {
      throw new Error("Site URL, consumer key, and consumer secret are required");
    }

    try {
      new URL(siteUrl);
    } catch {
      throw new Error("Invalid site URL format - must be a valid URL (e.g., https://mystore.com)");
    }

    try {
      const testUrl = `${siteUrl.replace(/\/+$/, "")}/wp-json/wc/v3/system_status?consumer_key=${encodeURIComponent(
        consumerKey,
      )}&consumer_secret=${encodeURIComponent(consumerSecret)}`;

      const response = await fetch(testUrl, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        const errorText = await response.text();
        ctx.logger.error("WooCommerce API authentication failed", {
          status: response.status,
          error: errorText,
        });

        if (response.status === 401) {
          throw new Error("Invalid credentials - please check your consumer key and secret");
        } else if (response.status === 404) {
          throw new Error(
            "WooCommerce REST API not found - please verify WooCommerce is installed and the site URL is correct",
          );
        } else {
          throw new Error(`API request failed with status ${response.status}: ${errorText}`);
        }
      }

      ctx.logger.info("WooCommerce credentials validated successfully");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.logger.error("Failed to validate WooCommerce credentials", { error: message });

      if (
        message.includes("credentials") ||
        message.includes("not found") ||
        message.includes("API request failed")
      ) {
        throw error;
      }
      throw new Error(`Failed to connect to WooCommerce: ${message}`);
    }
  },

  async onStart(ctx) {
    ctx.logger.info("Starting WooCommerce plugin for org", { orgId: ctx.org.id });

    const siteUrl = ctx.config.getOptional<string>("siteUrl");
    const consumerKey = ctx.config.getOptional<string>("consumerKey");
    const consumerSecret = ctx.config.getOptional<string>("consumerSecret");

    if (!siteUrl || !consumerKey || !consumerSecret) {
      ctx.logger.info(
        "WooCommerce credentials not configured - plugin is enabled but MCP tools are not available. " +
          "Please configure your WooCommerce credentials in the plugin settings.",
      );
      return;
    }

    try {
      await ctx.mcp.startLocalStdio({
        id: "woocommerce-mcp",
        command: "node",
        args: ["index.js"],
        cwd: "./mcp",
        env: {
          WORDPRESS_SITE_URL: siteUrl,
          WOOCOMMERCE_CONSUMER_KEY: consumerKey,
          WOOCOMMERCE_CONSUMER_SECRET: consumerSecret,
          ...staleTrackingEnv(ctx.config),
          ...returnInstructionsEnv(ctx.config),
          ...couponEnv(ctx.config),
        },
      });

      ctx.logger.info("WooCommerce local MCP server started successfully");
    } catch (error) {
      ctx.logger.error("Failed to start WooCommerce MCP server:", error);
      throw error;
    }

    // Products capability: mirror the catalog into core for `recommend_products`.
    // Runs in the background so it never blocks startup.
    if (ctx.productSource) {
      const productSource = ctx.productSource;
      const wooGet = createWooGet({ siteUrl, consumerKey, consumerSecret });
      const logger = {
        info: (msg: string, c?: Record<string, unknown>) => ctx.logger.info(msg, c),
      };
      const sync = () =>
        bulkSync(wooGet, productSource, logger).catch((err) =>
          ctx.logger.error("WooCommerce catalog sync failed", err),
        );
      void sync();
      if (resyncTimer) clearInterval(resyncTimer);
      resyncTimer = setInterval(sync, CATALOG_RESYNC_MS);
    } else {
      ctx.logger.info(
        "WooCommerce: productSource runtime not available — skipping catalog sync " +
          "(capability not negotiated or plugin-api credentials missing).",
      );
    }
  },

  async onConfigUpdate(ctx) {
    // The platform restarts the stdio MCP server with the new env after this hook.
    ctx.logger.info("WooCommerce plugin config updated");
  },

  async onDisable(ctx) {
    if (resyncTimer) clearInterval(resyncTimer);
    resyncTimer = undefined;
    ctx.logger.info("WooCommerce plugin disabled for org", { orgId: ctx.org.id });
  },
}));
