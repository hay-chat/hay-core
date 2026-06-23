/**
 * Wix Stores Plugin (phase one — API key)
 *
 * Connects a Wix Stores site to Hay using a site-scoped API key, so the agent
 * can look up orders, read their transaction history and fulfilment, issue full
 * or partial refunds (falling back to recording an external refund when the
 * payment provider can't be refunded via the API), and browse the catalog.
 *
 * Authentication is a pasted Wix API key (generated in the Wix API Key Manager)
 * plus the site ID it is scoped to. Wix API keys are long-lived, so there is no
 * token-refresh step — the connection persists until the merchant revokes the
 * key. The OAuth-app-on-the-Wix-App-Market path (HAY-240 phase two) is
 * intentionally deferred.
 *
 * Spawns a local Node MCP server (./mcp/index.js) that calls the Wix REST API
 * directly. Nothing site-specific is hardcoded — any merchant uses it with
 * their own key + site ID.
 */

import { defineHayPlugin } from "@hay/plugin-sdk";

const WIX_API_BASE = "https://www.wixapis.com";

export default defineHayPlugin((globalCtx) => ({
  name: "Wix Stores",

  onInitialize(ctx) {
    globalCtx.logger.info("Initializing Wix Stores plugin");

    ctx.register.config({
      apiKey: {
        type: "string",
        label: "API Key",
        description:
          "Wix API key. In your Wix account open Settings → API Keys, create a key, and " +
          "grant it (and no more than) these permission scopes so it stays in line with " +
          "the Shopify/WooCommerce connectors: Stores - Orders (read & manage), " +
          "Stores - Order Transactions / Order Billing (for refunds), " +
          "Stores - Order Fulfillments (manage), and Stores - Catalog (read). Treated as a secret.",
        required: true,
        encrypted: true,
      },
      siteId: {
        type: "string",
        label: "Site ID",
        description:
          "The Wix site ID this key is scoped to. Find it in your site's dashboard URL " +
          "(.../dashboard/<SITE_ID>/...) or via Wix's Query Sites API. Required because " +
          "Wix routes site-level API calls by this header.",
        required: true,
      },
    });

    ctx.register.auth.apiKey({
      id: "wix-apikey",
      label: "Wix API Key",
      configField: "apiKey",
    });

    globalCtx.logger.info("Wix Stores plugin config and auth methods registered");
  },

  async onValidateAuth(ctx) {
    ctx.logger.info("Validating Wix Stores credentials");

    const authState = ctx.auth.get();
    if (!authState) {
      throw new Error("No authentication configured");
    }

    const apiKey = ctx.config.get<string>("apiKey");
    const siteId = ctx.config.get<string>("siteId");
    if (!apiKey) {
      throw new Error("API Key is required");
    }
    if (!siteId) {
      throw new Error("Site ID is required");
    }

    try {
      // Round-trip the eCommerce Orders search: it returns 200 even for a store
      // with no orders, and exercises exactly the scope the plugin needs, so a
      // success proves the key is valid AND has order permissions.
      const response = await fetch(`${WIX_API_BASE}/ecom/v1/orders/search`, {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "wix-site-id": siteId,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ cursorPaging: { limit: 1 } }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        ctx.logger.error("Wix API authentication failed", { status: response.status });

        if (response.status === 401) {
          throw new Error("Invalid API key — please check the key you pasted from Wix.");
        }
        if (response.status === 403) {
          throw new Error(
            "The API key is valid but missing the Stores - Orders permission. " +
              "Re-create the key in Wix with the orders, refunds, fulfilment and catalog scopes.",
          );
        }
        if (response.status === 404 || response.status === 400) {
          throw new Error(
            `Could not reach the Wix store for site ID "${siteId}". ` +
              "Double-check the Site ID matches the account that owns the API key.",
          );
        }
        throw new Error(
          `Wix API request failed with status ${response.status}: ${errorText.slice(0, 200)}`,
        );
      }

      ctx.logger.info("Wix Stores credentials validated successfully");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.logger.error("Failed to validate Wix Stores credentials", { error: message });

      // Re-throw our own user-facing messages verbatim; wrap unexpected (network) ones.
      if (
        message.includes("API key") ||
        message.includes("permission") ||
        message.includes("Wix API request failed") ||
        message.includes("Wix store for site")
      ) {
        throw error;
      }
      throw new Error(`Failed to connect to Wix: ${message}`);
    }
  },

  async onStart(ctx) {
    ctx.logger.info("Starting Wix Stores plugin for org", { orgId: ctx.org.id });

    const authState = ctx.auth.get();
    if (!authState) {
      ctx.logger.info(
        "Wix credentials not configured — plugin is enabled but MCP tools are not available. " +
          "Please add your Wix API key and Site ID in the plugin settings.",
      );
      return;
    }

    const apiKey = ctx.config.getOptional<string>("apiKey");
    const siteId = ctx.config.getOptional<string>("siteId");
    if (!apiKey || !siteId) {
      ctx.logger.warn("Wix API key or Site ID missing in config — MCP server will not be started.");
      return;
    }

    try {
      ctx.logger.debug("Spawning local Wix Stores Node MCP server");

      await ctx.mcp.startLocalStdio({
        id: "wix-mcp",
        command: "node",
        args: ["index.js"],
        cwd: "./mcp",
        env: {
          WIX_API_KEY: apiKey,
          WIX_SITE_ID: siteId,
        },
      });

      ctx.logger.info("Wix Stores MCP server started successfully");
    } catch (error) {
      ctx.logger.error("Failed to start Wix Stores MCP server", error);
      throw error;
    }
  },

  async onConfigUpdate(ctx) {
    // The platform restarts the stdio MCP server with the new env after this
    // hook, so there is no client state to re-initialize here.
    ctx.logger.info("Wix Stores plugin config updated");
  },

  async onDisable(ctx) {
    // The platform stops the MCP server on disable; nothing else is held open.
    ctx.logger.info("Wix Stores plugin disabled for org", { orgId: ctx.org.id });
  },
}));
