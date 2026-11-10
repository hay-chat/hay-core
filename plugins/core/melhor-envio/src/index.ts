/**
 * Melhor Envio Plugin
 *
 * Connects a Melhor Envio account (Brazilian shipping-label aggregator) so the
 * agent can answer "where is my order" questions. Spawns a local Node MCP server
 * (./mcp/index.js) that reads shipments from the Melhor Envio REST API with an
 * access token the merchant generates in their Melhor Envio panel.
 *
 * TODO: OAuth2 app flow (the documented path for platforms; tokens last 30 days
 * and need refreshing) once Hay has a Melhor Envio app registered. Quoting,
 * buying/generating/cancelling labels and webhooks are out of scope.
 */

import { defineHayPlugin } from "@hay/plugin-sdk";

const API_BASE_URL = "https://melhorenvio.com.br";
const VALIDATE_TIMEOUT_MS = 15000;

/** A pasted token, without the "Bearer " prefix people sometimes copy with it. */
function cleanToken(value: string | undefined): string {
  return (value ?? "").trim().replace(/^Bearer\s+/i, "");
}

/**
 * Melhor Envio requires a User-Agent naming the application and a technical
 * contact email on every request, e.g. "Aplicação (email para contato técnico)".
 */
function userAgent(contactEmail: string): string {
  return `Hay (${contactEmail.trim()})`;
}

function isEmail(value: string | undefined): value is string {
  return /^[^\s@()]+@[^\s@()]+\.[^\s@()]+$/.test((value ?? "").trim());
}

export default defineHayPlugin((globalCtx) => ({
  name: "Melhor Envio",

  onInitialize(ctx) {
    ctx.register.config({
      accessToken: {
        type: "string",
        label: "Access token",
        description:
          "Token generated in your Melhor Envio panel (Integrações → Permissões de acesso) " +
          "with permission to view shipping labels.",
        required: true,
        encrypted: true,
      },
      contactEmail: {
        type: "string",
        label: "Contact email",
        description:
          "Technical contact email. Melhor Envio requires one on every API request so they " +
          "can reach whoever runs the integration.",
        required: true,
        env: "MELHOR_ENVIO_CONTACT_EMAIL",
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
    const token = cleanToken(ctx.config.getOptional<string>("accessToken"));
    const contactEmail = ctx.config.getOptional<string>("contactEmail");
    if (!token) throw new Error("The Melhor Envio access token is required");
    if (!isEmail(contactEmail)) throw new Error("A valid contact email is required");

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
    const token = cleanToken(ctx.config.getOptional<string>("accessToken"));
    const contactEmail = ctx.config.getOptional<string>("contactEmail");
    if (!token || !isEmail(contactEmail)) {
      ctx.logger.info(
        "Melhor Envio access token or contact email not configured: plugin is enabled but " +
          "MCP tools are not available.",
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
