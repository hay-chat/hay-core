/**
 * Stripe Plugin - SDK V2
 *
 * Connect your Stripe account to manage payments, customers, subscriptions, and more
 * through Stripe's Model Context Protocol server.
 *
 * Supports API Key authentication.
 */

import { defineHayPlugin } from "@hay/plugin-sdk";

export default defineHayPlugin((globalCtx) => ({
  name: "Stripe",

  /**
   * Global initialization - register config and auth methods
   */
  onInitialize(ctx) {
    globalCtx.logger.info("Initializing Stripe plugin");

    // Register config fields
    ctx.register.config({
      apiKey: {
        type: "string",
        label: "API Key",
        description: "Stripe API key (starts with sk_test_ or sk_live_)",
        required: true,
        encrypted: true,
      },
    });

    // Register API Key authentication method
    ctx.register.auth.apiKey({
      id: "stripe-apikey",
      label: "Stripe API Key",
      configField: "apiKey",
    });

    globalCtx.logger.info("Stripe plugin config and auth methods registered");
  },

  /**
   * Validate authentication credentials
   */
  async onValidateAuth(ctx) {
    ctx.logger.info("Validating Stripe auth credentials");

    const authState = ctx.auth.get();
    if (!authState) {
      throw new Error("No authentication configured");
    }

    // Validate API key
    const apiKey = ctx.config.get<string>("apiKey");

    if (!apiKey) {
      throw new Error("API Key is required");
    }

    // Validate API key format
    if (!apiKey.startsWith("sk_test_") && !apiKey.startsWith("sk_live_")) {
      throw new Error("Invalid API key format - must start with sk_test_ or sk_live_");
    }

    // Test actual API connection
    try {
      const response = await fetch("https://api.stripe.com/v1/balance", {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        ctx.logger.error("Stripe API authentication failed", {
          status: response.status,
          error: errorText,
        });

        if (response.status === 401) {
          throw new Error("Invalid API key - please check your credentials");
        } else {
          throw new Error(`API request failed with status ${response.status}`);
        }
      }

      ctx.logger.info("Stripe API key validated successfully");
      return true;
    } catch (error: any) {
      ctx.logger.error("Failed to validate Stripe API key", { error: error.message });

      // Re-throw validation errors as-is
      if (error.message.includes("credentials") || error.message.includes("API request failed")) {
        throw error;
      }

      // Network or other errors
      throw new Error(`Failed to connect to Stripe: ${error.message}`);
    }
  },

  /**
   * Org runtime initialization - connect to Stripe MCP server
   */
  async onStart(ctx) {
    ctx.logger.info("Starting Stripe plugin for org", { orgId: ctx.org.id });

    try {
      // Get auth state
      const authState = ctx.auth.get();
      if (!authState) {
        ctx.logger.info(
          "Stripe credentials not configured - plugin is enabled but MCP tools are not available. " +
          "Please configure your Stripe credentials in the plugin settings."
        );
        return;
      }

      // Get API key
      const apiKey = ctx.config.get<string>("apiKey");
      if (!apiKey) {
        ctx.logger.warn("No API key found in config - MCP server connection may fail");
        return;
      }

      // Build auth headers with API key
      const authHeaders: Record<string, string> = {
        "Authorization": `Bearer ${apiKey}`,
      };

      ctx.logger.debug("Using API Key authentication for MCP connection");

      // Connect to external MCP server
      await ctx.mcp.startExternal({
        id: "stripe-mcp",
        url: "https://mcp.stripe.com",
        authHeaders,
      });

      ctx.logger.info("Stripe MCP server connected successfully");
    } catch (error) {
      ctx.logger.error("Failed to connect to Stripe MCP server:", error);
      throw error;
    }
  },

  /**
   * Config update handler
   */
  async onConfigUpdate(ctx) {
    ctx.logger.info("Stripe plugin config updated");
    // Config changes will take effect on restart
  },

  /**
   * Disable handler - cleanup
   */
  async onDisable(ctx) {
    ctx.logger.info("Stripe plugin disabled for org", { orgId: ctx.org.id });
    // MCP servers are stopped automatically by the SDK
  },

  /**
   * Enable handler - called by core when plugin is enabled
   */
  async onEnable(ctx) {
    ctx.logger.info("Stripe plugin enabled");
    // Plugin will be restarted via onStart automatically for each org
  },
}));
