/**
 * Cal.com Plugin
 *
 * Connect your Cal.com account so the agent can list event types, find open
 * slots, and book, reschedule, or cancel meetings.
 *
 * Spawns a local Node MCP server (./mcp/index.js) that calls Cal.com's REST
 * API (v2) directly using a Cal.com API key (Bearer auth). No external MCP
 * server or extra toolchain required.
 */

import { defineHayPlugin } from "@hay/plugin-sdk";

const CALCOM_BASE_URL = "https://api.cal.com/v2";

export default defineHayPlugin((globalCtx) => ({
  name: "Cal.com",

  // ── 1. DECLARE config + auth (runs once per worker, before any request). ──
  onInitialize(ctx) {
    globalCtx.logger.info("Initializing Cal.com plugin");

    ctx.register.config({
      apiKey: {
        type: "string",
        label: "API Key",
        description:
          "Your Cal.com API key (starts with cal_). Create one under Settings → Developer → API keys (https://app.cal.com/settings/developer/api-keys).",
        required: true,
        encrypted: true,
      },
    });

    ctx.register.auth.apiKey({
      id: "calcom-apikey",
      label: "Cal.com API Key",
      configField: "apiKey",
    });

    globalCtx.logger.info("Cal.com plugin config and auth methods registered");
  },

  // ── 2. VALIDATE with a real round-trip (called when creds change). ──
  async onValidateAuth(ctx) {
    ctx.logger.info("Validating Cal.com auth credentials");

    const authState = ctx.auth.get();
    if (!authState) {
      throw new Error("No authentication configured");
    }

    const apiKey = ctx.config.get<string>("apiKey");
    if (!apiKey) {
      throw new Error("API Key is required");
    }

    const response = await fetch(`${CALCOM_BASE_URL}/me`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      ctx.logger.error("Cal.com API authentication failed", {
        status: response.status,
        // Body shape only — never the credential itself.
        error: errorText.slice(0, 500),
      });

      if (response.status === 401 || response.status === 403) {
        throw new Error("Invalid API key — please check your credentials");
      }
      throw new Error(`Cal.com request failed with status ${response.status}`);
    }

    ctx.logger.info("Cal.com API key validated successfully");
    return true;
  },

  // ── 3. START runtime per org. GATE on credentials, then wire MCP. ──
  async onStart(ctx) {
    ctx.logger.info("Starting Cal.com plugin for org", { orgId: ctx.org.id });

    const authState = ctx.auth.get();
    if (!authState) {
      ctx.logger.info(
        "Cal.com credentials not configured — plugin is enabled but MCP tools are " +
          "unavailable. Add your Cal.com API key in the plugin settings.",
      );
      return;
    }

    const apiKey = ctx.config.get<string>("apiKey");
    if (!apiKey) {
      ctx.logger.warn("Cal.com: no API key in config — MCP server not started.");
      return;
    }

    await ctx.mcp.startLocalStdio({
      id: "calcom-mcp",
      command: "node",
      args: ["index.js"],
      cwd: "./mcp",
      env: {
        CALCOM_API_KEY: apiKey,
      },
    });

    ctx.logger.info("Cal.com MCP server started", { orgId: ctx.org.id });
  },

  // ── 4. React to config edits. ──
  // The platform restarts startLocalStdio servers on config change, so the new
  // API key is picked up automatically — logging is sufficient here.
  async onConfigUpdate(ctx) {
    ctx.logger.info("Cal.com plugin config updated");
  },

  // ── 5. Tear down. The platform stops the MCP server it spawned for us. ──
  async onDisable(ctx) {
    ctx.logger.info("Cal.com plugin disabled", { orgId: ctx.org.id });
  },
}));
