/**
 * Salesforce Plugin
 *
 * Connect any Salesforce org and let the agent read and update CRM records —
 * Contacts and Cases out of the box, plus Accounts, Leads, Opportunities and any
 * custom object via generic sObject + SOQL tools.
 *
 * Spawns a local Node MCP server (./mcp/index.js) that calls Salesforce's REST
 * API directly. Authentication uses the OAuth 2.0 Client Credentials Flow: the
 * user creates a Connected App with the flow enabled and supplies its consumer
 * key + consumer secret plus the org's instance URL. The MCP server exchanges
 * those for an access token at startup and re-fetches it on expiry.
 */

import { defineHayPlugin } from "@hay/plugin-sdk";

/** Strip a trailing slash so we can safely append `/services/...` paths. */
function normalizeInstanceUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/**
 * Exchange the connected-app credentials for an access token. Shared by
 * `onValidateAuth` (to prove the credentials work) and documented as the same
 * flow the MCP server performs at runtime.
 */
async function fetchAccessToken(
  instanceUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; instanceUrl: string }> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(`${instanceUrl}/services/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });

  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    // Non-JSON body (e.g. an HTML login page from a wrong instance URL).
    throw new Error(
      `Salesforce returned an unexpected response from ${instanceUrl}. ` +
        "Check that the Instance URL is your My Domain URL (e.g. https://your-domain.my.salesforce.com).",
    );
  }

  if (!response.ok) {
    const error = String(parsed.error ?? "");
    const description = String(parsed.error_description ?? text.slice(0, 200));
    if (error === "invalid_client" || error === "invalid_client_id" || response.status === 401) {
      throw new Error(
        "Invalid Consumer Key or Consumer Secret — check the Connected App credentials.",
      );
    }
    if (error === "inactive_user" || error === "invalid_grant") {
      throw new Error(
        "Salesforce rejected the Client Credentials Flow. Ensure the Connected App has " +
          '"Enable Client Credentials Flow" checked and a Run-As user assigned. ' +
          `Details: ${description}`,
      );
    }
    throw new Error(`Salesforce token request failed (${response.status}): ${description}`);
  }

  const accessToken = String(parsed.access_token ?? "");
  if (!accessToken) {
    throw new Error("Salesforce did not return an access token for these credentials.");
  }
  // Salesforce returns the canonical instance_url for subsequent API calls.
  return {
    accessToken,
    instanceUrl: String(parsed.instance_url ?? instanceUrl),
  };
}

export default defineHayPlugin((globalCtx) => ({
  name: "Salesforce",

  onInitialize(ctx) {
    globalCtx.logger.info("Initializing Salesforce plugin");

    ctx.register.config({
      instanceUrl: {
        type: "string",
        label: "Instance URL",
        description:
          "Your Salesforce My Domain URL, e.g. https://your-domain.my.salesforce.com. " +
          "Found under Setup → My Domain. Do not include a trailing path.",
        required: true,
      },
      clientId: {
        type: "string",
        label: "Consumer Key",
        description:
          "The Connected App's Consumer Key (OAuth client_id). Create a Connected App under " +
          'Setup → App Manager with "Enable OAuth Settings" and "Enable Client Credentials Flow".',
        required: true,
      },
      clientSecret: {
        type: "string",
        label: "Consumer Secret",
        description:
          "The Connected App's Consumer Secret (OAuth client_secret). Treated as a secret.",
        required: true,
        encrypted: true,
      },
    });

    // The consumer secret is the credential that gates access; registering it as
    // the auth method makes `ctx.auth.get()` reflect whether the org is connected.
    ctx.register.auth.apiKey({
      id: "salesforce-client-credentials",
      label: "Salesforce Connected App",
      configField: "clientSecret",
    });

    globalCtx.logger.info("Salesforce plugin config and auth methods registered");
  },

  async onValidateAuth(ctx) {
    ctx.logger.info("Validating Salesforce credentials");

    const authState = ctx.auth.get();
    if (!authState) {
      throw new Error("No authentication configured");
    }

    const instanceUrlRaw = ctx.config.get<string>("instanceUrl");
    const clientId = ctx.config.get<string>("clientId");
    const clientSecret = ctx.config.get<string>("clientSecret");
    if (!instanceUrlRaw) throw new Error("Instance URL is required");
    if (!clientId) throw new Error("Consumer Key is required");
    if (!clientSecret) throw new Error("Consumer Secret is required");

    const instanceUrl = normalizeInstanceUrl(instanceUrlRaw);

    try {
      await fetchAccessToken(instanceUrl, clientId, clientSecret);
      ctx.logger.info("Salesforce credentials validated successfully");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.logger.error("Failed to validate Salesforce credentials", { error: message });
      throw error instanceof Error ? error : new Error(message);
    }
  },

  async onStart(ctx) {
    ctx.logger.info("Starting Salesforce plugin for org", { orgId: ctx.org.id });

    const authState = ctx.auth.get();
    if (!authState) {
      ctx.logger.info(
        "Salesforce credentials not configured — plugin is enabled but MCP tools are not " +
          "available. Configure the Instance URL, Consumer Key and Consumer Secret in settings.",
      );
      return;
    }

    const instanceUrlRaw = ctx.config.getOptional<string>("instanceUrl");
    const clientId = ctx.config.getOptional<string>("clientId");
    const clientSecret = ctx.config.getOptional<string>("clientSecret");
    if (!instanceUrlRaw || !clientId || !clientSecret) {
      ctx.logger.warn(
        "Salesforce credentials missing in config — MCP server will not be started.",
      );
      return;
    }

    try {
      ctx.logger.debug("Spawning local Salesforce Node MCP server");

      await ctx.mcp.startLocalStdio({
        id: "salesforce-mcp",
        command: "node",
        args: ["index.js"],
        cwd: "./mcp",
        env: {
          SALESFORCE_INSTANCE_URL: normalizeInstanceUrl(instanceUrlRaw),
          SALESFORCE_CLIENT_ID: clientId,
          SALESFORCE_CLIENT_SECRET: clientSecret,
        },
      });

      ctx.logger.info("Salesforce MCP server started successfully");
    } catch (error) {
      ctx.logger.error("Failed to start Salesforce MCP server", error);
      throw error;
    }
  },

  async onConfigUpdate(ctx) {
    // The platform restarts the stdio MCP server with the new env after this
    // hook, so there is no client state to re-initialize here.
    ctx.logger.info("Salesforce plugin config updated");
  },

  async onDisable(ctx) {
    // The platform stops the MCP server on disable; nothing else is held open.
    ctx.logger.info("Salesforce plugin disabled for org", { orgId: ctx.org.id });
  },
}));
