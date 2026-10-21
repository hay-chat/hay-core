import { defineHayPlugin } from "@hay/plugin-sdk";
import type { HayConfigRuntimeAPI } from "@hay/plugin-sdk/types";
import { GraphClient } from "./graph-client.js";
import { PluginApiClient } from "./plugin-api.js";
import { resolveConnection, type ConnectionMode, type WhatsAppConnection } from "./connection.js";
import { connectEmbeddedSignup } from "./connect.js";
import { isTrustedWebhook, verificationChallenge } from "./signature.js";
import { getChannelStatus } from "./status.js";
import { handleWebhook } from "./webhook.js";
import { deliver } from "./deliver.js";
import type { ChannelContext } from "./context.js";

/**
 * WhatsApp Channel Plugin (Meta WhatsApp Cloud API)
 *
 * Exchanges WhatsApp messages — text, media and voice notes — between a
 * business number and Hay's orchestrator. Plan: .claude/plans/whatsapp-cloud/PLAN.md.
 *
 * Two ways to connect a number:
 *
 *  - Embedded Signup (default, Hay as Meta Tech Provider). The settings page
 *    opens Meta's signup popup (FB JS SDK, `config_id` from
 *    META_WHATSAPP_ES_CONFIG_ID) and posts the returned 30-second code to core's
 *    `plugins.oauth.completeWithCode`, which exchanges it with the app secret
 *    (core-only) and calls `onConnected` with the ids the popup reported. One
 *    shared webhook URL serves every org: core verifies Meta's signature and
 *    routes each `changes[]` item by `metadata.phone_number_id` (account-level
 *    events by `entry[].id`, the WABA).
 *
 *  - Manual (design partners before App Review, self-hosters). The org pastes a
 *    permanent system-user token from its own Meta app plus the phone number id,
 *    WABA id, app secret and a verify token, and points that app's webhook at
 *    the per-org URL. The worker verifies those webhooks itself.
 */

const CONFIG_KEYS = [
  "connectionMode",
  "manualAccessToken",
  "manualPhoneNumberId",
  "manualWabaId",
  "manualAppSecret",
  "manualVerifyToken",
] as const;

function readConfig(config: HayConfigRuntimeAPI): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const key of CONFIG_KEYS) {
    values[key] = config.getOptional(key);
  }
  return values;
}

function modeOf(config: HayConfigRuntimeAPI): ConnectionMode {
  return config.getOptional<string>("connectionMode") === "manual" ? "manual" : "embedded-signup";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default defineHayPlugin((globalCtx) => {
  const { logger } = globalCtx;

  // Live state shared by route handlers and lifecycle hooks.
  let connection: WhatsAppConnection | null = null;
  let mode: ConnectionMode = "embedded-signup";
  let appId: string | null = null;
  let configId: string | null = null;
  const graph = new GraphClient({ logger });

  const channelContext = (): ChannelContext => ({
    getConnection: () => connection,
    graph,
    api: new PluginApiClient(logger),
    logger,
  });

  /** Make sure Meta delivers this WABA's webhooks to our app. Idempotent, non-fatal. */
  const subscribe = (current: WhatsAppConnection): void => {
    void graph.subscribeApp(current.wabaId, current.accessToken).catch((error: unknown) => {
      logger.warn("WhatsApp webhook subscription failed", { error: errorMessage(error) });
    });
  };

  return {
    name: "WhatsApp",

    onInitialize(ctx) {
      const { register, config } = ctx;

      register.config({
        connectionMode: {
          type: "string",
          label: "Connection method",
          description:
            "Embedded Signup connects your number in a Meta popup. Manual uses a permanent token from your own Meta app (self-hosting, or before Hay's app review).",
          required: false,
          encrypted: false,
          default: "embedded-signup",
          options: [
            { label: "Embedded Signup (recommended)", value: "embedded-signup" },
            { label: "Manual token (own Meta app)", value: "manual" },
          ],
        },
        clientId: {
          type: "string",
          label: "Meta App ID",
          description: "Meta app used for Embedded Signup (configured by the platform)",
          required: false,
          encrypted: false,
          env: "META_APP_ID",
          showWhen: { field: "connectionMode", notEquals: "manual" },
        },
        clientSecret: {
          type: "string",
          label: "Meta App Secret",
          description: "Meta app secret (configured by the platform)",
          required: false,
          encrypted: true,
          // Only core needs it (code exchange); never sent to the worker.
          serverOnly: true,
          env: "META_APP_SECRET",
          showWhen: { field: "connectionMode", notEquals: "manual" },
        },
        esConfigId: {
          type: "string",
          label: "Embedded Signup configuration id",
          description: "Facebook Login for Business configuration (configured by the platform)",
          required: false,
          encrypted: false,
          env: "META_WHATSAPP_ES_CONFIG_ID",
          showWhen: { field: "connectionMode", notEquals: "manual" },
        },
        manualAccessToken: {
          type: "string",
          label: "Permanent access token",
          description:
            "System-user token with whatsapp_business_messaging and whatsapp_business_management",
          required: false,
          encrypted: true,
          showWhen: { field: "connectionMode", equals: "manual" },
        },
        manualPhoneNumberId: {
          type: "string",
          label: "Phone number ID",
          placeholder: "976350592236691",
          required: false,
          encrypted: false,
          showWhen: { field: "connectionMode", equals: "manual" },
        },
        manualWabaId: {
          type: "string",
          label: "WhatsApp Business Account ID",
          required: false,
          encrypted: false,
          showWhen: { field: "connectionMode", equals: "manual" },
        },
        manualAppSecret: {
          type: "string",
          label: "App secret",
          description: "Your Meta app's secret — used to verify webhook signatures",
          required: false,
          encrypted: true,
          showWhen: { field: "connectionMode", equals: "manual" },
        },
        manualVerifyToken: {
          type: "string",
          label: "Webhook verify token",
          description: "Any string; enter the same value in your Meta app's webhook settings",
          required: false,
          encrypted: true,
          showWhen: { field: "connectionMode", equals: "manual" },
        },
      });

      // Embedded Signup: the code comes from the FB JS SDK popup on the settings
      // page and is exchanged by core (`plugins.oauth.completeWithCode`), so the
      // platform's redirect flow is disabled. Business tokens never expire, so
      // there is no refresh (PLAN.md D7).
      register.auth.oauth2({
        id: "whatsapp-embedded-signup",
        label: "Connect WhatsApp",
        authorizationUrl: "https://www.facebook.com/v26.0/dialog/oauth",
        tokenUrl: "https://graph.facebook.com/v26.0/oauth/access_token",
        clientId: config.field("clientId"),
        clientSecret: config.field("clientSecret"),
        connectFlow: "client",
      });

      register.webhookRouting({
        signature: {
          header: "x-hub-signature-256",
          format: "sha256-hmac",
          secretEnv: "META_APP_SECRET",
        },
        verificationChallenge: {
          modeParam: "hub.mode",
          verifyTokenParam: "hub.verify_token",
          challengeParam: "hub.challenge",
          verifyTokenEnv: "META_VERIFY_TOKEN",
        },
        // Messages and statuses route per phone number; account-level events
        // (account_update, templates) only carry the WABA id in entry[].id.
        routeKeyPath: {
          itemsPath: "entry",
          keyPath: "id",
          nested: { itemsPath: "changes", keyPath: "value.metadata.phone_number_id" },
        },
        // Meta's Deauthorize + Data Deletion callbacks (App Review). WhatsApp
        // revocation itself arrives as account_update (PARTNER_APP_UNINSTALLED).
        deauthorization: {
          format: "signed-request",
          param: "signed_request",
          secretEnv: "META_APP_SECRET",
          keyPath: "user_id",
        },
      });

      register.ui.page({
        id: "whatsapp-connect",
        title: "Connect WhatsApp",
        component: "./components/settings/AfterSettings.vue",
        slot: "after-settings",
        icon: "message-circle",
      });

      // Manual mode: Meta's GET handshake on the per-org URL. (The shared URL's
      // handshake is answered by core with META_VERIFY_TOKEN.)
      register.route("GET", "/webhook", async (req, res) => {
        const challenge = verificationChallenge(req.query ?? {}, connection);
        if (challenge === null) {
          res.status(403).send("Forbidden");
          return;
        }
        res.status(200).type("text/plain").send(challenge);
      });

      register.route("POST", "/webhook", async (req, res) => {
        if (!isTrustedWebhook(req, connection)) {
          logger.warn("WhatsApp webhook rejected — not verified by core and no valid signature");
          res.status(403).json({ error: "unverified" });
          return;
        }
        if (!connection) {
          logger.error("WhatsApp webhook received but the channel is not connected");
          res.status(503).json({ error: "Plugin not fully configured" });
          return;
        }
        try {
          const summary = await handleWebhook(req.body, channelContext());
          res.status(200).json({ received: true, ...summary });
        } catch (error: unknown) {
          // 5xx makes Meta retry; inbound dedupe (wamid) makes retries safe.
          logger.error("WhatsApp webhook handler error", { error: errorMessage(error) });
          res.status(500).json({ error: "Internal server error" });
        }
      });

      register.route("POST", "/deliver", async (req, res) => {
        const result = await deliver(req.body, channelContext());
        res.status(result.status).json(result.body);
      });

      register.route("GET", "/ui/status", async (_req, res) => {
        const status = await getChannelStatus(channelContext(), { mode, appId, configId });
        res.status(200).json(status);
      });

      logger.info("WhatsApp plugin config, auth, webhook routing, routes and UI registered");
    },

    async onValidateAuth(ctx) {
      // The business token is only present after Embedded Signup; manual mode
      // is validated by the health card's live Graph call.
      ctx.logger.info("WhatsApp auth state saved", {
        hasToken: Boolean(ctx.auth.get()?.credentials.accessToken),
      });
      return true;
    },

    async onStart(ctx) {
      mode = modeOf(ctx.config);
      appId = ctx.config.getOptional<string>("clientId") ?? null;
      configId = ctx.config.getOptional<string>("esConfigId") ?? null;
      connection = resolveConnection(readConfig(ctx.config), ctx.auth.get()?.credentials);

      if (!connection) {
        ctx.logger.info(
          "WhatsApp not connected yet — channel unavailable until signup or manual setup",
          {
            orgId: ctx.org.id,
            mode,
          },
        );
        return;
      }

      subscribe(connection);
      ctx.logger.info("WhatsApp plugin started", {
        orgId: ctx.org.id,
        mode: connection.mode,
        phoneNumberId: connection.phoneNumberId,
      });
    },

    async onConfigUpdate(ctx) {
      // Manual-mode credentials are config; Embedded Signup credentials live in
      // the auth state, which this context does not expose — keep them as-is.
      mode = modeOf(ctx.config);
      if (mode === "manual") {
        connection = resolveConnection(readConfig(ctx.config), undefined);
        if (connection) {
          subscribe(connection);
        }
      } else if (connection?.mode === "manual") {
        connection = null;
      }
      ctx.logger.info("WhatsApp plugin config updated", { orgId: ctx.org.id, mode });
    },

    async onDisable(ctx) {
      ctx.logger.info("WhatsApp plugin disabled", { orgId: ctx.org.id });
      connection = null;
    },

    /**
     * Core calls this right after storing the Embedded Signup business token.
     * `extras` are the ids the signup popup reported (untrusted). Never throws:
     * an empty result leaves the org connected but not routable, which the
     * settings page reports.
     */
    async onConnected(ctx, extras) {
      const authState = ctx.auth.get();
      const token = authState?.credentials.accessToken;
      if (!token || typeof token !== "string") {
        ctx.logger.warn("WhatsApp onConnected — no access token available");
        return { routingKeys: [] };
      }

      const result = await connectEmbeddedSignup({
        accessToken: token,
        extras,
        previous: authState?.credentials,
        graph,
        logger: ctx.logger,
      });

      // onStart does not re-run on reconnect; refresh the live state here.
      if (result.connection) {
        connection = result.connection;
        mode = "embedded-signup";
      }

      ctx.logger.info("WhatsApp onConnected — resolved routing keys", {
        orgId: ctx.org.id,
        count: result.routingKeys.length,
      });

      return {
        routingKeys: result.routingKeys,
        account: result.account,
        credentials: result.credentials,
      };
    },
  };
});
