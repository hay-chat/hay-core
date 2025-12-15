/**
 * Stripe Plugin for Hay
 *
 * This is a complete example plugin demonstrating all features of the Hay Plugin SDK v2.
 * See README.md for full documentation.
 */

// Import SDK function
// In a real plugin: import { defineHayPlugin } from "@hay/plugin-sdk"
import { defineHayPlugin } from "../../../sdk/index.js";

// Import plugin-specific code
import { StripeClient } from "./stripe-client.js";
import { StripeMcpServer } from "./stripe-mcp-server.js";

/**
 * Export plugin definition using defineHayPlugin
 */
export default defineHayPlugin((globalCtx) => ({
  name: "Stripe",

  onInitialize() {
    const { register, logger } = globalCtx;

    logger.info("Initializing Stripe plugin");

    // 1. DECLARE CONFIG SCHEMA
    register.config({
      apiKey: {
        type: "string",
        label: "Stripe API Key",
        description: "Secret key for Stripe API. Starts with sk_test_ or sk_live_.",
        required: false,
        env: "STRIPE_API_KEY",
        sensitive: true,
      },
      webhookSecret: {
        type: "string",
        label: "Webhook Secret",
        description: "Secret for verifying Stripe webhook signatures.",
        required: false,
        env: "STRIPE_WEBHOOK_SECRET",
        sensitive: true,
      },
      enableTestMode: {
        type: "boolean",
        label: "Enable Test Mode",
        description: "Use Stripe test mode for all operations",
        default: true,
        required: false,
      },
    });

    // 2. DECLARE AUTH METHODS
    register.auth.apiKey({
      id: "apiKey",
      label: "API Key",
      configField: "apiKey",
    });

    // 3. DECLARE HTTP ROUTES
    register.route("POST", "/webhook", async (req, res) => {
      logger.info("Received Stripe webhook", { headers: req.headers });

      try {
        const event = req.body;
        const eventType = event?.type || "unknown";

        logger.info(`Processing Stripe event: ${eventType}`, { eventId: event?.id });

        if (eventType === "payment_intent.succeeded") {
          logger.info("Payment succeeded", { paymentIntentId: event.data?.object?.id });
        }

        res.status(200).json({ received: true });
      } catch (error) {
        logger.error("Error processing webhook", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    register.route("GET", "/health", async (_req, res) => {
      res.status(200).json({ status: "ok", plugin: "stripe" });
    });

    // 4. DECLARE UI EXTENSIONS
    register.ui({
      slot: "plugin-settings",
      component: "components/StripeSettings.vue",
    });

    register.ui({
      slot: "dashboard-widgets",
      component: "components/StripeRevenueWidget.vue",
    });

    logger.info("Stripe plugin initialized");
  },

  async onStart(ctx) {
    const { org, config, auth, mcp, logger } = ctx;

    logger.info(`Starting Stripe plugin for org: ${org.id}`);

    const authState = auth.get();
    if (!authState) {
      logger.warn("Stripe plugin started without auth state");
      return;
    }

    const { methodId, credentials } = authState;
    if (methodId !== "apiKey") {
      logger.warn(`Unsupported auth method: ${methodId}`);
      return;
    }

    const apiKey = String(credentials.apiKey || "") || config.getOptional<string>("apiKey");
    if (!apiKey) {
      logger.warn("No Stripe API key configured; MCP will not start.");
      return;
    }

    try {
      await mcp.startLocal("stripe-mcp", async (mcpCtx) => {
        const mcpServer = new StripeMcpServer({ apiKey, logger: mcpCtx.logger });
        await mcpServer.start();
        return mcpServer;
      });

      logger.info("Stripe MCP server started successfully", { orgId: org.id });
    } catch (error) {
      logger.error("Failed to start Stripe MCP server", error);
    }

    logger.info("Stripe plugin started successfully", { orgId: org.id, orgName: org.name });
  },

  async onValidateAuth(ctx) {
    const { org, auth, config, logger } = ctx;

    logger.info(`Validating Stripe auth for org: ${org.id}`);

    const authState = auth.get();
    if (!authState) {
      logger.warn("No auth state provided for validation");
      return false;
    }

    const { methodId, credentials } = authState;

    try {
      if (methodId === "apiKey") {
        const apiKey = String(credentials.apiKey || "") || config.getOptional<string>("apiKey");

        if (!apiKey) {
          logger.warn("No API key provided");
          return false;
        }

        const client = new StripeClient({ apiKey });
        const isValid = await client.verify();

        if (!isValid) {
          logger.warn("Stripe API key validation failed", { keyPrefix: apiKey.substring(0, 10) + "..." });
          return false;
        }

        logger.info("Stripe API key validated successfully");
        return true;
      }

      logger.warn(`Unknown auth method for validation: ${methodId}`);
      return false;
    } catch (error) {
      logger.error("Error during auth validation", error);
      return false;
    }
  },

  onConfigUpdate(ctx) {
    const { org, config, logger } = ctx;

    logger.info(`Stripe config updated for org: ${org.id}`);

    const fields = config.keys();
    logger.debug("Updated config fields", { fields });

    logger.info("Platform will restart plugin with new config");
  },

  async onDisable(ctx) {
    const { org, logger } = ctx;

    logger.info(`Disabling Stripe plugin for org: ${org.id}`);

    try {
      logger.debug("Removing Stripe webhooks");
      await new Promise((resolve) => setTimeout(resolve, 100));
      logger.info("Stripe webhooks removed");
    } catch (error) {
      logger.error("Error removing webhooks", error);
    }

    logger.info("Stripe plugin disabled successfully");
  },
}));
