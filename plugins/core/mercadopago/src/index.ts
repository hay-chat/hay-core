/**
 * Mercado Pago plugin — the first payment provider on the Hay.chat
 * payment_provider contract (@hay/plugin-sdk/payment-provider).
 *
 * The agent can look up the payment behind a WooCommerce or Shopify order,
 * resend an unpaid Pix code after the shopper's email or phone matches the
 * payer, refund within what was paid (held for approval as a `refund`), and
 * report refund status honestly (a Pix refund the bank has not confirmed is
 * `pending`).
 *
 * Auth is OAuth only (Roger, D10: no pasted keys). The OAuth app is Hay.chat's
 * own Mercado Pago application: its client id/secret come from the server env
 * (MERCADOPAGO_CLIENT_ID / MERCADOPAGO_CLIENT_SECRET) through the `env`
 * fallback of the two config fields below. Unset → the dashboard has nothing
 * to connect with and says so. Core runs the flow, stores the tokens and
 * refreshes them (access tokens last 180 days, refresh tokens rotate).
 *
 * @see https://www.mercadopago.com.br/developers/en/docs/security/oauth
 */

import { defineHayPlugin } from "@hay/plugin-sdk";

const API_HOST = "https://api.mercadopago.com";

function accessTokenOf(ctx: {
  auth: { get: () => { credentials: Record<string, unknown> } | null };
}): string | null {
  const token = ctx.auth.get()?.credentials?.accessToken;
  return typeof token === "string" && token.trim() ? token.trim() : null;
}

export default defineHayPlugin((globalCtx) => ({
  name: "Mercado Pago",

  onInitialize(ctx) {
    globalCtx.logger.info("Initializing Mercado Pago plugin");

    ctx.register.config({
      clientId: {
        type: "string",
        label: "OAuth client ID",
        description:
          "Set by the Hay.chat server (MERCADOPAGO_CLIENT_ID). Leave empty unless you run your " +
          "own Hay.chat server with your own Mercado Pago application.",
        required: false,
        encrypted: false,
        // Only core runs the OAuth flow; the worker never needs it.
        serverOnly: true,
        env: "MERCADOPAGO_CLIENT_ID",
      },
      clientSecret: {
        type: "string",
        label: "OAuth client secret",
        description: "Set by the Hay.chat server (MERCADOPAGO_CLIENT_SECRET).",
        required: false,
        encrypted: true,
        serverOnly: true,
        env: "MERCADOPAGO_CLIENT_SECRET",
      },
    });

    // Mercado Pago takes no scope parameter: permissions (read, write,
    // offline_access) are set on the application. Core always adds PKCE; enable
    // PKCE on the application so the code_verifier is checked.
    ctx.register.auth.oauth2({
      id: "mercadopago-oauth",
      label: "Connect with Mercado Pago",
      authorizationUrl: "https://auth.mercadopago.com/authorization",
      tokenUrl: `${API_HOST}/oauth/token`,
      scopes: [],
      authorizationParams: { platform_id: "mp" },
      clientId: ctx.config.field("clientId"),
      clientSecret: ctx.config.field("clientSecret"),
    });
  },

  async onValidateAuth(ctx) {
    const token = accessTokenOf(ctx);
    // Before the OAuth flow finishes there is no token yet; nothing to check.
    if (!token) return true;
    const res = await fetch(`${API_HOST}/users/me`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (res.status === 401) {
      throw new Error("Mercado Pago rejected the connection. Connect again.");
    }
    if (!res.ok) {
      throw new Error(`Could not reach Mercado Pago (HTTP ${res.status}). Try again in a moment.`);
    }
    return true;
  },

  async onStart(ctx) {
    const token = accessTokenOf(ctx);
    if (!token) {
      ctx.logger.info("Mercado Pago: not connected yet, MCP not started.");
      return;
    }
    await ctx.mcp.startLocalStdio({
      id: "mercadopago-mcp",
      command: "node",
      args: ["index.js"],
      cwd: "./mcp",
      env: { MERCADOPAGO_ACCESS_TOKEN: token },
    });
    ctx.logger.info("Mercado Pago MCP server started");
  },

  async onConfigUpdate(ctx) {
    // The platform restarts the stdio MCP server with fresh env after this hook.
    ctx.logger.info("Mercado Pago plugin config updated");
  },

  async onDisable(ctx) {
    ctx.logger.info("Mercado Pago plugin disabled", { orgId: ctx.org.id });
  },
}));
