import { defineHayPlugin } from "@hay/plugin-sdk";
import { ChatwootApi } from "./chatwoot-api.js";
import { webhookHandler } from "./webhook.js";
import { deliverHandler } from "./deliver.js";
import { escalateHandler } from "./escalate.js";

/**
 * Chatwoot Channel Plugin
 *
 * Connects a Chatwoot Agent Bot to Hay's orchestrator. Incoming Chatwoot
 * messages flow through Hay's perception/retrieval/execution layers; AI
 * responses are sent back via Chatwoot's API. When the orchestrator emits
 * HANDOFF, the Chatwoot conversation is released from the bot's pending
 * state into the normal human-agent queue.
 *
 * Onboarding:
 *   1. User creates an Agent Bot in their Chatwoot instance with a custom
 *      `outgoing_url` pointing at Hay's plugin webhook endpoint.
 *   2. User pastes Chatwoot base URL, account ID, and the bot's access_token
 *      into the plugin config along with a random webhook secret.
 *   3. User assigns the bot to one or more inboxes in Chatwoot.
 */
export default defineHayPlugin((globalCtx) => {
  const { logger } = globalCtx;

  // State established in onStart, accessed by route handlers via closure.
  let chatwootApi: ChatwootApi | null = null;
  let webhookSecret: string | null = null;
  let defaultEscalationTeamId: string | null = null;

  return {
    name: "Chatwoot",

    onInitialize(ctx) {
      const { register } = ctx;

      logger.info("Initializing Chatwoot plugin");

      register.config({
        baseUrl: {
          type: "string",
          label: "Chatwoot Base URL",
          description:
            "Your Chatwoot instance URL — e.g., https://app.chatwoot.com for cloud, or your self-hosted URL",
          required: true,
          encrypted: false,
        },
        accountId: {
          type: "string",
          label: "Account ID",
          description: "Your Chatwoot account ID (the number in your Chatwoot dashboard URL)",
          required: true,
          encrypted: false,
        },
        botAccessToken: {
          type: "string",
          label: "Agent Bot Access Token",
          description: "The access_token returned when you created the Agent Bot in Chatwoot",
          required: true,
          encrypted: true,
        },
        webhookSecret: {
          type: "string",
          label: "Webhook Secret",
          description:
            "The Webhook Secret shown on the Agent Bot's Edit page in Chatwoot. Hay uses it to verify the HMAC signature on every incoming webhook from Chatwoot.",
          required: true,
          encrypted: true,
        },
        defaultEscalationTeamId: {
          type: "string",
          label: "Escalation Team ID (optional)",
          description:
            "When the AI hands off to a human, optionally assign the Chatwoot conversation to this team",
          required: false,
          encrypted: false,
        },
      });

      // The bot access token is the primary credential for validation.
      register.auth.apiKey({
        id: "botAccessToken",
        label: "Chatwoot Agent Bot Access Token",
        configField: "botAccessToken",
      });

      // Setup guide surfaced in plugin settings.
      register.ui.page({
        id: "setup-guide",
        title: "Setup Guide",
        component: "./components/settings/AfterSettings.vue",
        slot: "after-settings",
        icon: "book",
      });

      // Inbound: Chatwoot POSTs here when a message_created event fires.
      register.route("POST", "/messages", async (req, res) => {
        await webhookHandler(req, res, {
          getWebhookSecret: () => webhookSecret,
          logger,
        });
      });

      // Outbound: ChannelDeliveryService POSTs here to send a bot reply.
      register.route("POST", "/deliver", async (req, res) => {
        await deliverHandler(req, res, {
          getChatwootApi: () => chatwootApi,
          logger,
        });
      });

      // Escalation: ChannelDeliveryService POSTs here when Hay status flips
      // to pending-human so we can release the Chatwoot conversation to humans.
      register.route("POST", "/escalate", async (req, res) => {
        await escalateHandler(req, res, {
          getChatwootApi: () => chatwootApi,
          getDefaultEscalationTeamId: () => defaultEscalationTeamId,
          logger,
        });
      });

      logger.info("Chatwoot plugin config, auth, routes, and UI registered");
    },

    async onValidateAuth(ctx) {
      ctx.logger.info("Validating Chatwoot credentials");

      const baseUrl = ctx.config.get<string>("baseUrl");
      const accountId = ctx.config.get<string>("accountId");
      const token = ctx.config.get<string>("botAccessToken");

      if (!baseUrl || !accountId || !token) {
        throw new Error("Base URL, Account ID, and Bot Access Token are all required");
      }

      // Cheap sanity check on the base URL shape.
      if (!/^https?:\/\//.test(baseUrl)) {
        throw new Error("Base URL must start with http:// or https://");
      }

      const api = new ChatwootApi({
        baseUrl,
        accountId,
        botAccessToken: token,
        logger: ctx.logger,
      });

      try {
        await api.validateCredentials();
        ctx.logger.info("Chatwoot credentials validated", { accountId });
        return true;
      } catch (error: any) {
        ctx.logger.error("Chatwoot credential validation failed", { error: error.message });
        throw new Error(error.message || "Failed to validate Chatwoot credentials");
      }
    },

    async onStart(ctx) {
      ctx.logger.info("Starting Chatwoot plugin", { orgId: ctx.org.id });

      const baseUrl = ctx.config.getOptional<string>("baseUrl");
      const accountId = ctx.config.getOptional<string>("accountId");
      const token = ctx.config.getOptional<string>("botAccessToken");
      const secret = ctx.config.getOptional<string>("webhookSecret");
      const teamId = ctx.config.getOptional<string>("defaultEscalationTeamId");

      if (!baseUrl || !accountId || !token || !secret) {
        ctx.logger.info(
          "Chatwoot credentials not fully configured — plugin is enabled but the Chatwoot channel " +
            "is not available until you set baseUrl, accountId, botAccessToken, and webhookSecret.",
        );
        return;
      }

      chatwootApi = new ChatwootApi({
        baseUrl,
        accountId,
        botAccessToken: token,
        logger: ctx.logger,
      });
      webhookSecret = secret;
      defaultEscalationTeamId = teamId || null;

      ctx.logger.info("Chatwoot plugin started", {
        orgId: ctx.org.id,
        baseUrl,
        accountId,
        hasEscalationTeam: !!defaultEscalationTeamId,
      });
    },

    async onConfigUpdate(ctx) {
      ctx.logger.info("Chatwoot plugin config updated — will take effect on next restart");
    },

    async onDisable(ctx) {
      ctx.logger.info("Chatwoot plugin disabled", { orgId: ctx.org.id });
      chatwootApi = null;
      webhookSecret = null;
      defaultEscalationTeamId = null;
    },
  };
});
