/**
 * Klaviyo Plugin
 *
 * Connect your Klaviyo account to manage profiles, lists, segments, campaigns,
 * flows, events, and templates.
 *
 * Spawns a local Node MCP server (./mcp/index.js) that calls Klaviyo's REST API
 * directly using a Private API Key. No Python toolchain required.
 */

import { defineHayPlugin } from "@hay/plugin-sdk";

const KLAVIYO_API_REVISION = "2024-10-15";

export default defineHayPlugin((globalCtx) => ({
  name: "Klaviyo",

  onInitialize(ctx) {
    globalCtx.logger.info("Initializing Klaviyo plugin");

    ctx.register.config({
      apiKey: {
        type: "string",
        label: "Private API Key",
        description:
          "Klaviyo private API key (starts with pk_). Create one under Account → Settings → API Keys.",
        required: true,
        encrypted: true,
      },
    });

    ctx.register.auth.apiKey({
      id: "klaviyo-apikey",
      label: "Klaviyo Private API Key",
      configField: "apiKey",
    });

    globalCtx.logger.info("Klaviyo plugin config and auth methods registered");
  },

  async onValidateAuth(ctx) {
    ctx.logger.info("Validating Klaviyo auth credentials");

    const authState = ctx.auth.get();
    if (!authState) {
      throw new Error("No authentication configured");
    }

    const apiKey = ctx.config.get<string>("apiKey");
    if (!apiKey) {
      throw new Error("Private API Key is required");
    }

    if (!apiKey.startsWith("pk_")) {
      ctx.logger.warn("Klaviyo API key does not start with pk_ — proceeding but this is unusual");
    }

    try {
      const response = await fetch("https://a.klaviyo.com/api/accounts/", {
        method: "GET",
        headers: {
          Authorization: `Klaviyo-API-Key ${apiKey}`,
          revision: KLAVIYO_API_REVISION,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        ctx.logger.error("Klaviyo API authentication failed", {
          status: response.status,
          error: errorText,
        });

        if (response.status === 401 || response.status === 403) {
          throw new Error("Invalid API key - please check your credentials");
        }
        throw new Error(`API request failed with status ${response.status}`);
      }

      ctx.logger.info("Klaviyo API key validated successfully");
      return true;
    } catch (error: any) {
      ctx.logger.error("Failed to validate Klaviyo API key", { error: error.message });

      if (error.message.includes("credentials") || error.message.includes("API request failed")) {
        throw error;
      }
      throw new Error(`Failed to connect to Klaviyo: ${error.message}`);
    }
  },

  async onStart(ctx) {
    ctx.logger.info("Starting Klaviyo plugin for org", { orgId: ctx.org.id });

    try {
      const authState = ctx.auth.get();
      if (!authState) {
        ctx.logger.info(
          "Klaviyo credentials not configured - plugin is enabled but MCP tools are not available. " +
            "Please configure your Klaviyo private API key in the plugin settings.",
        );
        return;
      }

      const apiKey = ctx.config.get<string>("apiKey");
      if (!apiKey) {
        ctx.logger.warn("No API key found in config - MCP server connection may fail");
        return;
      }

      ctx.logger.debug("Spawning local Klaviyo Node MCP server");

      await ctx.mcp.startLocalStdio({
        id: "klaviyo-mcp",
        command: "node",
        args: ["index.js"],
        cwd: "./mcp",
        env: {
          PRIVATE_API_KEY: apiKey,
        },
      });

      ctx.logger.info("Klaviyo MCP server started successfully");
    } catch (error) {
      ctx.logger.error("Failed to connect to Klaviyo MCP server:", error);
      throw error;
    }
  },

  async onConfigUpdate(ctx) {
    ctx.logger.info("Klaviyo plugin config updated");
  },

  async onDisable(ctx) {
    ctx.logger.info("Klaviyo plugin disabled for org", { orgId: ctx.org.id });
  },

  async onEnable(ctx) {
    ctx.logger.info("Klaviyo plugin enabled");
  },
}));
