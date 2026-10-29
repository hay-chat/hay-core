/**
 * Spacebring Plugin
 *
 * Connects a Spacebring co-working space to the Hay agent so it can run a
 * member chat: book, move and cancel rooms and desks, invite guests, report
 * problems to the team, and answer house questions (Wi-Fi, rules, events,
 * perks, plans).
 *
 * Spawns a local Node MCP server (./mcp/index.js) whose tools are playbook
 * steps, not Spacebring endpoints (see mcp/index.js). It calls the Spacebring
 * REST API with HTTP Basic auth (API Key ID + Secret).
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
        label: "Default Location",
        description:
          "Name or ID of the location this assistant serves. Leave empty if your network has a single location; with several, members are asked which one.",
        required: false,
        encrypted: false,
      },
      timeZone: {
        type: "string",
        label: "Time Zone",
        description:
          "IANA time zone (e.g. Europe/Lisbon) used when Spacebring does not report one for the location.",
        required: false,
        encrypted: false,
        advanced: true,
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
    const timeZone = ctx.config.getOptional<string>("timeZone") ?? "";

    await ctx.mcp.startLocalStdio({
      id: "spacebring-mcp",
      command: "node",
      args: ["index.js"],
      cwd: "./mcp",
      env: {
        SPACEBRING_API_KEY_ID: apiKeyId,
        SPACEBRING_API_KEY_SECRET: apiKeySecret,
        SPACEBRING_LOCATION_REF: locationRef,
        SPACEBRING_TIME_ZONE: timeZone,
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
