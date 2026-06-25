/**
 * Spacebring Plugin
 *
 * Connects a Spacebring co-working space to the Hay agent so it can power a member
 * chat: answer FAQs (Wi‑Fi, house rules), find and book meeting rooms / desks, cancel
 * reservations, surface events and perks, register guest visits, and file support tickets.
 *
 * Spawns a local Node MCP server (./mcp/index.js) that calls the Spacebring REST API
 * directly using HTTP Basic auth (API Key ID + Secret). The default location and the
 * credentials are passed to the MCP child over env vars in onStart.
 */

import { defineHayPlugin } from "@hay/plugin-sdk";

const SPACEBRING_BASE_URL = "https://api.spacebring.com";

export default defineHayPlugin((globalCtx) => ({
  name: "Spacebring",

  // ── 1. DECLARE config + auth (runs once, before any request). ──
  onInitialize(ctx) {
    globalCtx.logger.info("Initializing Spacebring plugin");

    ctx.register.config({
      apiKeyId: {
        type: "string",
        label: "API Key ID",
        description:
          "Spacebring API key ID — the username half of HTTP Basic auth. Generate API credentials in Spacebring under Settings → Integrations → API.",
        required: true,
        encrypted: false,
      },
      apiKeySecret: {
        type: "string",
        label: "API Key Secret",
        description:
          "Spacebring API key secret — the password half of HTTP Basic auth. Stored encrypted; never shared.",
        required: true,
        encrypted: true,
      },
      locationRef: {
        type: "string",
        label: "Default Location ID",
        description:
          "UUID of the co-working location (organization) this assistant serves. Used as the default for every tool (each tool can still override it). Find it with the list_locations tool or in your Spacebring dashboard URL.",
        required: false,
        encrypted: false,
      },
    });

    // No register.auth.basic() exists in the SDK — model Basic auth as two config
    // fields and point the apiKey descriptor at the secret (presence gates startup).
    ctx.register.auth.apiKey({
      id: "spacebring-apikey",
      label: "Spacebring API Key",
      configField: "apiKeySecret",
    });

    globalCtx.logger.info("Spacebring plugin config and auth registered");
  },

  // ── 2. VALIDATE with a real round-trip (called when creds change). ──
  async onValidateAuth(ctx) {
    const authState = ctx.auth.get();
    if (!authState) throw new Error("No authentication configured");

    const apiKeyId = ctx.config.getOptional<string>("apiKeyId");
    const apiKeySecret = ctx.config.getOptional<string>("apiKeySecret");
    if (!apiKeyId || !apiKeySecret) {
      throw new Error("API Key ID and API Key Secret are both required");
    }

    const auth = Buffer.from(`${apiKeyId}:${apiKeySecret}`).toString("base64");
    const response = await fetch(`${SPACEBRING_BASE_URL}/locations/v1`, {
      method: "GET",
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("Invalid Spacebring credentials — please check your API Key ID and Secret");
      }
      throw new Error(`Spacebring request failed with status ${response.status}`);
    }

    ctx.logger.info("Spacebring credentials validated");
    return true;
  },

  // ── 3. START runtime per org. GATE on credentials, then wire MCP. ──
  async onStart(ctx) {
    ctx.logger.info("Starting Spacebring plugin", { orgId: ctx.org.id });

    const authState = ctx.auth.get();
    if (!authState) {
      ctx.logger.info(
        "Spacebring credentials not configured — plugin is enabled but MCP tools are unavailable.",
      );
      return;
    }

    const apiKeyId = ctx.config.getOptional<string>("apiKeyId");
    const apiKeySecret = ctx.config.getOptional<string>("apiKeySecret");
    if (!apiKeyId || !apiKeySecret) {
      ctx.logger.warn("Spacebring API credentials incomplete — MCP server not started.");
      return;
    }

    const locationRef = ctx.config.getOptional<string>("locationRef") ?? "";

    await ctx.mcp.startLocalStdio({
      id: "spacebring-mcp",
      command: "node",
      args: ["index.js"],
      cwd: "./mcp",
      env: {
        SPACEBRING_API_KEY_ID: apiKeyId,
        SPACEBRING_API_KEY_SECRET: apiKeySecret,
        SPACEBRING_LOCATION_REF: locationRef,
      },
    });

    ctx.logger.info("Spacebring MCP server started", { orgId: ctx.org.id });
  },

  // ── 4. React to config edits. startLocalStdio is restarted by the platform. ──
  async onConfigUpdate(ctx) {
    ctx.logger.info("Spacebring plugin config updated");
  },

  // ── 5. Tear down (platform stops the MCP server for us). ──
  async onDisable(ctx) {
    ctx.logger.info("Spacebring plugin disabled", { orgId: ctx.org.id });
  },
}));
