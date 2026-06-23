/**
 * Twenty CRM Plugin
 *
 * Connect any Twenty CRM workspace — Twenty Cloud (https://api.twenty.com) or a
 * self-hosted instance — using your own workspace base URL and API key. Exposes
 * people, companies, notes and tasks as agent tools, plus generic record and
 * metadata tools so custom objects and fields in your workspace are reachable.
 *
 * Spawns a local Node MCP server (./mcp/index.js) that calls Twenty's REST API
 * directly. No workspace-specific fields are hardcoded — anyone can use it with
 * their own account.
 */

import { defineHayPlugin } from "@hay/plugin-sdk";

/** Strip a trailing slash and an accidental `/rest` suffix from the base URL. */
function normalizeBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  if (url.toLowerCase().endsWith("/rest")) {
    url = url.slice(0, -"/rest".length);
  }
  return url;
}

export default defineHayPlugin((globalCtx) => ({
  name: "Twenty CRM",

  onInitialize(ctx) {
    globalCtx.logger.info("Initializing Twenty CRM plugin");

    ctx.register.config({
      baseUrl: {
        type: "string",
        label: "Twenty API URL",
        description:
          "Your Twenty workspace API URL. Twenty Cloud: https://api.twenty.com. " +
          "Self-hosted: your instance URL, e.g. https://crm.yourcompany.com. " +
          "Do not include the /rest path.",
        required: true,
      },
      apiKey: {
        type: "string",
        label: "API Key",
        description:
          "Twenty API key. Generate one in Twenty under Settings → APIs & Webhooks → " +
          "Generate API Key. Treated as a secret.",
        required: true,
        encrypted: true,
      },
    });

    ctx.register.auth.apiKey({
      id: "twenty-apikey",
      label: "Twenty API Key",
      configField: "apiKey",
    });

    globalCtx.logger.info("Twenty CRM plugin config and auth methods registered");
  },

  async onValidateAuth(ctx) {
    ctx.logger.info("Validating Twenty CRM credentials");

    const authState = ctx.auth.get();
    if (!authState) {
      throw new Error("No authentication configured");
    }

    const baseUrlRaw = ctx.config.get<string>("baseUrl");
    const apiKey = ctx.config.get<string>("apiKey");
    if (!baseUrlRaw) {
      throw new Error("Twenty API URL is required");
    }
    if (!apiKey) {
      throw new Error("API Key is required");
    }

    const baseUrl = normalizeBaseUrl(baseUrlRaw);

    try {
      // Round-trip against the metadata endpoint: it exists on every workspace
      // and does not depend on any particular object still being present.
      const response = await fetch(`${baseUrl}/rest/metadata/objects?limit=1`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        ctx.logger.error("Twenty API authentication failed", {
          status: response.status,
        });

        if (response.status === 401 || response.status === 403) {
          throw new Error("Invalid API key — please check your credentials");
        }
        if (response.status === 404) {
          throw new Error(
            `Could not reach the Twenty REST API at ${baseUrl}/rest. ` +
              "Double-check the API URL (it should be the workspace root, without /rest).",
          );
        }
        throw new Error(
          `API request failed with status ${response.status}: ${errorText.slice(0, 200)}`,
        );
      }

      ctx.logger.info("Twenty CRM credentials validated successfully");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.logger.error("Failed to validate Twenty CRM credentials", { error: message });

      // Re-throw our own user-facing messages verbatim; wrap unexpected (network) ones.
      if (
        message.includes("credentials") ||
        message.includes("API request failed") ||
        message.includes("Twenty REST API")
      ) {
        throw error;
      }
      throw new Error(`Failed to connect to Twenty at ${baseUrl}: ${message}`);
    }
  },

  async onStart(ctx) {
    ctx.logger.info("Starting Twenty CRM plugin for org", { orgId: ctx.org.id });

    const authState = ctx.auth.get();
    if (!authState) {
      ctx.logger.info(
        "Twenty credentials not configured — plugin is enabled but MCP tools are not available. " +
          "Please configure your Twenty API URL and API key in the plugin settings.",
      );
      return;
    }

    const baseUrlRaw = ctx.config.getOptional<string>("baseUrl");
    const apiKey = ctx.config.getOptional<string>("apiKey");
    if (!baseUrlRaw || !apiKey) {
      ctx.logger.warn(
        "Twenty API URL or API key missing in config — MCP server will not be started.",
      );
      return;
    }

    try {
      ctx.logger.debug("Spawning local Twenty CRM Node MCP server");

      await ctx.mcp.startLocalStdio({
        id: "twenty-mcp",
        command: "node",
        args: ["index.js"],
        cwd: "./mcp",
        env: {
          TWENTY_URL: normalizeBaseUrl(baseUrlRaw),
          TWENTY_API_KEY: apiKey,
        },
      });

      ctx.logger.info("Twenty CRM MCP server started successfully");
    } catch (error) {
      ctx.logger.error("Failed to start Twenty CRM MCP server", error);
      throw error;
    }
  },

  async onConfigUpdate(ctx) {
    // The platform restarts the stdio MCP server with the new env after this
    // hook, so there is no client state to re-initialize here.
    ctx.logger.info("Twenty CRM plugin config updated");
  },

  async onDisable(ctx) {
    // The platform stops the MCP server on disable; nothing else is held open.
    ctx.logger.info("Twenty CRM plugin disabled for org", { orgId: ctx.org.id });
  },
}));
