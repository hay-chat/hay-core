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
