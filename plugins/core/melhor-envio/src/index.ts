/**
 * Melhor Envio Plugin
 *
 * Connects a Melhor Envio account (Brazilian shipping-label aggregator) so the
 * agent can answer "where is my order" questions. Spawns a local Node MCP server
 * (./mcp/index.js) that reads shipments from the Melhor Envio REST API.
 *
 * Two connection modes (`authMode`, see ./connection.ts):
 *
 * - `oauth` (default when the server sets MELHOR_ENVIO_OAUTH_CLIENT_ID): Hay.chat's
 *   own Melhor Envio app, registered in the panel under Integrações → Área Dev.
 *   Core runs the flow, stores the tokens and refreshes them.
 * - `token`: a token the merchant generates in their Melhor Envio panel.
 *
 * Quoting, buying/generating/cancelling labels and webhooks are out of scope.
 *
 * @see https://docs.melhorenvio.com.br/reference/fluxo-de-autorização
 */

import { defineHayPlugin } from "@hay/plugin-sdk";
import { defaultAuthMode, getAuthMode, isEmail, readAccessToken, userAgent } from "./connection.js";

const API_BASE_URL = "https://melhorenvio.com.br";
const VALIDATE_TIMEOUT_MS = 15000;

// Only what the tools read: the account's shipping labels (GET /me/orders…).
const OAUTH_SCOPES = ["orders-read"];

export default defineHayPlugin((globalCtx) => ({
  name: "Melhor Envio",

  onInitialize(ctx) {
    ctx.register.config({
      authMode: {
        type: "string",
        label: "Connection mode",
        description:
          "Connect with Melhor Envio: approve Hay.chat in your account in one click. " +
          "Access token: paste a token you generated in your Melhor Envio panel.",
        options: [
          { label: "Connect with Melhor Envio (recommended)", value: "oauth" },
          { label: "Access token", value: "token" },
        ],
        default: defaultAuthMode(),
      },
      clientId: {
        type: "string",
        label: "OAuth client ID",
        description: "Set by the Hay.chat server (MELHOR_ENVIO_OAUTH_CLIENT_ID). Leave empty.",
        required: false,
        serverOnly: true,
        env: "MELHOR_ENVIO_OAUTH_CLIENT_ID",
        showWhen: { field: "authMode", equals: "oauth" },
      },
      clientSecret: {
        type: "string",
        label: "OAuth client secret",
        description: "Set by the Hay.chat server (MELHOR_ENVIO_OAUTH_CLIENT_SECRET). Leave empty.",
        required: false,
        encrypted: true,
        serverOnly: true,
        env: "MELHOR_ENVIO_OAUTH_CLIENT_SECRET",
        showWhen: { field: "authMode", equals: "oauth" },
      },
      accessToken: {
        type: "string",
        label: "Access token",
        description:
          "Token generated in your Melhor Envio panel (Integrações → Permissões de acesso) " +
          "with permission to view shipping labels.",
        // Required in token mode only; onValidateAuth enforces it there.
        required: false,
        encrypted: true,
        showWhen: { field: "authMode", equals: "token" },
      },
      contactEmail: {
        type: "string",
        label: "Contact email",
        description:
          "Technical contact email. Melhor Envio requires one on every API request so they " +
          "can reach whoever runs the integration.",
        // Required in token mode only; onValidateAuth enforces it there.
        required: false,
        env: "MELHOR_ENVIO_CONTACT_EMAIL",
        showWhen: { field: "authMode", equals: "token" },
      },
      staleTrackingDays: {
        type: "number",
        label: "Stale tracking (days)",
        description:
          "Treat a posted shipment as stuck when it has not been delivered after more than " +
          "this many days.",
        default: 5,
      },
    });

    // Hay.chat's Melhor Envio app: core resolves id/secret from the
    // MELHOR_ENVIO_OAUTH_CLIENT_* server env and sends the registered callback.
    ctx.register.auth.oauth2({
      id: "melhor-envio-oauth",
      label: "Connect with Melhor Envio",
      authorizationUrl: `${API_BASE_URL}/oauth/authorize`,
      tokenUrl: `${API_BASE_URL}/oauth/token`,
      scopes: OAUTH_SCOPES,
      clientId: ctx.config.field("clientId"),
      clientSecret: ctx.config.field("clientSecret"),
    });

    ctx.register.auth.apiKey({
      id: "melhor-envio-token",
      label: "Melhor Envio access token",
      configField: "accessToken",
    });

    globalCtx.logger.info("Melhor Envio plugin config and auth registered");
  },

  /**
   * Connection test: list the account's shipments, the same permission the tools
   * need (a token without it would pass an account check and then fail every call).
   */
  async onValidateAuth(ctx) {
    const mode = getAuthMode(ctx.config);
    const token = readAccessToken(ctx.config);
    const contactEmail = ctx.config.getOptional<string>("contactEmail");
    if (mode === "oauth") {
      // Before the OAuth flow finishes there is no token yet; nothing to check.
      if (!token) return true;
    } else {
      if (!token) throw new Error("The Melhor Envio access token is required");
      if (!isEmail(contactEmail)) throw new Error("A valid contact email is required");
    }

    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/api/v2/me/orders`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "User-Agent": userAgent(contactEmail),
        },
        signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not reach Melhor Envio: ${message}`);
    }

    if (response.ok) return true;
    ctx.logger.warn("Melhor Envio token validation failed", { status: response.status });
    if (response.status === 401 && mode === "oauth") {
      throw new Error("Melhor Envio rejected the connection. Connect again.");
    }
    if (response.status === 401) {
      throw new Error(
        "Melhor Envio rejected the token. Check that you copied the whole token, that it has " +
          "not expired, and that it was generated in the production panel (not the sandbox).",
      );
    }
    if (response.status === 403) {
      throw new Error(
        "The token is not allowed to view shipping labels. Generate a new token with the " +
          "permission to view labels (orders-read).",
      );
    }
    throw new Error(`Melhor Envio answered with status ${response.status}. Try again later.`);
  },

  async onStart(ctx) {
    const mode = getAuthMode(ctx.config);
    const token = readAccessToken(ctx.config);
    const contactEmail = ctx.config.getOptional<string>("contactEmail");
    if (!token || (mode === "token" && !isEmail(contactEmail))) {
      ctx.logger.info(
        mode === "oauth"
          ? "Melhor Envio: not connected yet. Click Connect in the plugin settings. MCP not started."
          : "Melhor Envio: access token or contact email not configured, MCP not started.",
      );
      return;
    }

    const env: Record<string, string> = {
      MELHOR_ENVIO_ACCESS_TOKEN: token,
      MELHOR_ENVIO_USER_AGENT: userAgent(contactEmail),
    };
    // Per-store stale-tracking threshold (the MCP falls back to 5 days).
    const staleDays = ctx.config.getOptional<number | string>("staleTrackingDays");
    if (staleDays !== undefined && staleDays !== null && staleDays !== "") {
      env.STALE_TRACKING_DOMESTIC_DAYS = String(staleDays);
    }

    await ctx.mcp.startLocalStdio({
      id: "melhor-envio-mcp",
      command: "node",
      args: ["index.js"],
      cwd: "./mcp",
      env,
    });
    ctx.logger.info("Melhor Envio MCP server started", { orgId: ctx.org.id });
  },

  // The platform restarts the MCP server on config changes; no state is held here.
  async onConfigUpdate(ctx) {
    ctx.logger.info("Melhor Envio plugin config updated");
  },

  // The platform stops the MCP server; nothing else was opened.
  async onDisable(ctx) {
    ctx.logger.info("Melhor Envio plugin disabled", { orgId: ctx.org.id });
  },
}));
