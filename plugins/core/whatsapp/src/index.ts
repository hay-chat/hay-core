import { defineHayPlugin } from "@hay/plugin-sdk";
import Twilio from "twilio";
import { webhookHandler } from "./webhook.js";
import { deliverHandler } from "./deliver.js";

/**
 * WhatsApp Channel Plugin (Twilio)
 *
 * Enables WhatsApp as a communication channel using Twilio's Messaging API.
 * Handles inbound messages via webhook and outbound delivery via the
 * Channel Delivery Service.
 */
export default defineHayPlugin((globalCtx) => {
  const { logger } = globalCtx;

  // Shared state set during onStart, accessed by route handlers via closure
  let twilioClient: Twilio.Twilio | null = null;
  let authToken: string | null = null;
  let whatsappNumber: string | null = null;

  return {
    name: "WhatsApp",

    onInitialize(ctx) {
      const { register } = ctx;

      logger.info("Initializing WhatsApp plugin");

      // Config schema — env fallback for self-hosted deployments
      register.config({
        accountSid: {
          type: "string",
          label: "Twilio Account SID",
          description: "Your Twilio Account SID (starts with AC)",
          required: true,
          encrypted: false,
          env: "TWILIO_ACCOUNT_SID",
        },
        authToken: {
          type: "string",
          label: "Twilio Auth Token",
          description: "Your Twilio Auth Token",
          required: true,
          encrypted: true,
          env: "TWILIO_AUTH_TOKEN",
        },
        whatsappNumber: {
          type: "string",
          label: "WhatsApp Number",
          description:
            'Your Twilio WhatsApp-enabled phone number in E.164 format (e.g., "+14155238886")',
          required: true,
          encrypted: false,
          env: "TWILIO_WHATSAPP_NUMBER",
        },
      });

      // Auth method — uses authToken as the credential
      register.auth.apiKey({
        id: "authToken",
        label: "Twilio Auth Token",
        configField: "authToken",
      });

      // Setup guide UI
      register.ui.page({
        id: "setup-guide",
        title: "Setup Guide",
        component: "./components/settings/AfterSettings.vue",
        slot: "after-settings",
        icon: "book",
      });

      // Inbound: Twilio posts here when a WhatsApp message arrives
      register.route("POST", "/webhook", async (req, res) => {
        await webhookHandler(req, res, {
          getAuthToken: () => authToken,
          logger,
        });
      });

      // Outbound: Channel Delivery Service posts here to send messages
      register.route("POST", "/deliver", async (req, res) => {
        await deliverHandler(req, res, {
          getTwilioClient: () => twilioClient,
          getWhatsappNumber: () => whatsappNumber,
          logger,
        });
      });

      logger.info("WhatsApp plugin config, auth, routes, and UI registered");
    },

    async onValidateAuth(ctx) {
      ctx.logger.info("Validating Twilio credentials");

      const accountSid = ctx.config.get<string>("accountSid");
      const token = ctx.config.get<string>("authToken");

      if (!accountSid || !token) {
        throw new Error("Account SID and Auth Token are required");
      }

      if (!accountSid.startsWith("AC")) {
        throw new Error(
          'Invalid Account SID — must start with "AC". Find it at console.twilio.com.',
        );
      }

      // Test actual API connection
      try {
        const client = Twilio(accountSid, token);
        const account = await client.api.accounts(accountSid).fetch();

        ctx.logger.info("Twilio credentials validated", {
          accountName: account.friendlyName,
          status: account.status,
        });

        return true;
      } catch (error: any) {
        ctx.logger.error("Twilio credential validation failed", {
          error: error.message,
        });

        if (error.status === 401) {
          throw new Error("Invalid credentials — check your Account SID and Auth Token");
        }

        throw new Error(`Failed to connect to Twilio: ${error.message}`);
      }
    },

    async onStart(ctx) {
      ctx.logger.info("Starting WhatsApp plugin", { orgId: ctx.org.id });

      const accountSid = ctx.config.getOptional<string>("accountSid");
      const token = ctx.config.getOptional<string>("authToken");
      const number = ctx.config.getOptional<string>("whatsappNumber");

      if (!accountSid || !token) {
        ctx.logger.info(
          "Twilio credentials not configured — plugin is enabled but WhatsApp delivery " +
            "is not available. Configure credentials in plugin settings.",
        );
        return;
      }

      // Store for route handler closures
      twilioClient = Twilio(accountSid, token);
      authToken = token;
      whatsappNumber = number || null;

      ctx.logger.info("WhatsApp plugin started", {
        orgId: ctx.org.id,
        hasNumber: !!whatsappNumber,
      });
    },

    async onConfigUpdate(ctx) {
      ctx.logger.info("WhatsApp plugin config updated — will take effect on next restart");
    },

    async onDisable(ctx) {
      ctx.logger.info("WhatsApp plugin disabled", { orgId: ctx.org.id });
      twilioClient = null;
      authToken = null;
      whatsappNumber = null;
    },
  };
});
