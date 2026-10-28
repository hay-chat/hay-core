/**
 * Stripe Plugin
 *
 * Connect your Stripe account to manage payments, customers, subscriptions, and more
 * through Stripe's Model Context Protocol server.
 *
 * Supports API Key authentication.
 */

import {
  defineHayPlugin,
  DISPUTE_EVIDENCE_FILE_PREFIX,
  DISPUTE_EVIDENCE_ROUTE,
  type CanonicalDispute,
  type DisputeEvidenceRequest,
  type ToolRiskSpec,
} from "@hay/plugin-sdk";
import {
  attachEvidence,
  createStripeClient,
  disputeIdFromEvent,
  ensureWebhookEndpoint,
  fetchDispute,
  StripeApiError,
  syncRecentDisputes,
  toCanonical,
  webhookUrl,
  type StripeClient,
} from "./disputes.js";

/**
 * Risk class of the hosted Stripe MCP tools we know of (see README "Available
 * Tools"). Overrides Stripe's own annotations for these names; any other tool
 * keeps Stripe's readOnlyHint, and an unknown write is held for approval.
 *
 * Deliberately left undeclared, so they stay held: update_subscription,
 * create_invoice, create_invoice_item and finalize_invoice change what a
 * customer is billed and fit no money category.
 */
export const STRIPE_TOOL_RISK: ToolRiskSpec = {
  read: [
    "get_stripe_account_info",
    "retrieve_balance",
    "list_customers",
    "list_products",
    "list_prices",
    "list_payment_intents",
    "list_invoices",
    "list_subscriptions",
    "list_coupons",
    "list_disputes",
    "search_stripe_resources",
    "fetch_stripe_resources",
    "search_stripe_documentation",
  ],
  write: {
    create_refund: "refund",
    cancel_subscription: "cancel",
    create_coupon: "discount",
    create_customer: "customer_update",
    create_product: "other_write",
    create_price: "other_write",
    create_payment_link: "other_write",
    update_dispute: "other_write",
  },
};

export default defineHayPlugin((globalCtx) => {
  /** Set by onStart for this org's worker: the Stripe client and the dispute reporter. */
  let disputes: {
    client: StripeClient;
    report: (dispute: CanonicalDispute) => Promise<{ created: boolean }>;
  } | null = null;

  return {
    name: "Stripe",

    /**
     * Global initialization - register config and auth methods
     */
    onInitialize(ctx) {
      globalCtx.logger.info("Initializing Stripe plugin");

      // Register config fields
      ctx.register.config({
        apiKey: {
          type: "string",
          label: "API Key",
          description: "Stripe API key (starts with sk_test_ or sk_live_)",
          required: true,
          encrypted: true,
        },
      });

      // Register API Key authentication method
      ctx.register.auth.apiKey({
        id: "stripe-apikey",
        label: "Stripe API Key",
        configField: "apiKey",
      });

      // Disputes (D2-7). A webhook body is a hint only: the dispute is re-read
      // from Stripe with the merchant's key before anything is reported.
      ctx.register.route("POST", "/webhook", async (req, res) => {
        const id = disputeIdFromEvent(req.body);
        if (!id || !disputes) {
          res.status(200).json({ received: true, handled: false });
          return;
        }
        try {
          const dispute = await fetchDispute(disputes.client, id);
          await disputes.report(toCanonical(dispute));
          res.status(200).json({ received: true, handled: true });
        } catch (error) {
          if (error instanceof StripeApiError && error.status === 404) {
            res.status(200).json({ received: true, handled: false });
            return;
          }
          globalCtx.logger.error("Stripe dispute webhook failed", { error: String(error) });
          // 5xx makes Stripe retry; reporting is idempotent.
          res.status(500).json({ error: "dispute intake failed" });
        }
      });

      // Core-only (the public proxy blocks /disputes/*): attach the pack as a draft.
      ctx.register.route("POST", DISPUTE_EVIDENCE_ROUTE, async (req, res) => {
        if (!disputes) {
          res
            .status(200)
            .json({ ok: false, code: "NOT_CONNECTED", message: "Stripe is not connected" });
          return;
        }
        const result = await attachEvidence(
          disputes.client,
          req.body as DisputeEvidenceRequest,
          DISPUTE_EVIDENCE_FILE_PREFIX,
        );
        res.status(200).json(result);
      });

      // Catch disputes a missed or unregistered webhook did not deliver.
      ctx.register.cron({
        name: "sync_disputes",
        schedule: "0 */6 * * *",
        handler: async (cronCtx) => {
          if (!disputes) return;
          const count = await syncRecentDisputes(disputes.client, disputes.report);
          cronCtx.logger.info("Stripe disputes synced", { count });
        },
      });

      globalCtx.logger.info("Stripe plugin config, auth, dispute routes and cron registered");
    },

    /**
     * Validate authentication credentials
     */
    async onValidateAuth(ctx) {
      ctx.logger.info("Validating Stripe auth credentials");

      const authState = ctx.auth.get();
      if (!authState) {
        throw new Error("No authentication configured");
      }

      // Validate API key
      const apiKey = ctx.config.get<string>("apiKey");

      if (!apiKey) {
        throw new Error("API Key is required");
      }

      // Validate API key format
      if (!apiKey.startsWith("sk_test_") && !apiKey.startsWith("sk_live_")) {
        throw new Error("Invalid API key format - must start with sk_test_ or sk_live_");
      }

      // Test actual API connection
      try {
        const response = await fetch("https://api.stripe.com/v1/balance", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          ctx.logger.error("Stripe API authentication failed", {
            status: response.status,
            error: errorText,
          });

          if (response.status === 401) {
            throw new Error("Invalid API key - please check your credentials");
          } else {
            throw new Error(`API request failed with status ${response.status}`);
          }
        }

        ctx.logger.info("Stripe API key validated successfully");
        return true;
      } catch (error: any) {
        ctx.logger.error("Failed to validate Stripe API key", { error: error.message });

        // Re-throw validation errors as-is
        if (error.message.includes("credentials") || error.message.includes("API request failed")) {
          throw error;
        }

        // Network or other errors
        throw new Error(`Failed to connect to Stripe: ${error.message}`);
      }
    },

    /**
     * Org runtime initialization - connect to Stripe MCP server
     */
    async onStart(ctx) {
      ctx.logger.info("Starting Stripe plugin for org", { orgId: ctx.org.id });

      try {
        // Get auth state
        const authState = ctx.auth.get();
        if (!authState) {
          ctx.logger.info(
            "Stripe credentials not configured - plugin is enabled but MCP tools are not available. " +
              "Please configure your Stripe credentials in the plugin settings.",
          );
          return;
        }

        // Get API key
        const apiKey = ctx.config.get<string>("apiKey");
        if (!apiKey) {
          ctx.logger.warn("No API key found in config - MCP server connection may fail");
          return;
        }

        // Build auth headers with API key
        const authHeaders: Record<string, string> = {
          Authorization: `Bearer ${apiKey}`,
        };

        ctx.logger.debug("Using API Key authentication for MCP connection");

        // Connect to external MCP server
        await ctx.mcp.startExternal({
          id: "stripe-mcp",
          url: "https://mcp.stripe.com",
          authHeaders,
          toolRisk: STRIPE_TOOL_RISK,
        });

        ctx.logger.info("Stripe MCP server connected successfully");

        if (ctx.disputes) {
          const client = createStripeClient(apiKey);
          const reporter = ctx.disputes;
          disputes = { client, report: (dispute) => reporter.report(dispute) };
          void startDisputeIntake(client, disputes.report, ctx.org.id, ctx.logger);
        }
      } catch (error) {
        ctx.logger.error("Failed to connect to Stripe MCP server:", error);
        throw error;
      }
    },

    /**
     * Config update handler
     */
    async onConfigUpdate(ctx) {
      ctx.logger.info("Stripe plugin config updated");
      // Config changes will take effect on restart
    },

    /**
     * Disable handler - cleanup
     */
    async onDisable(ctx) {
      ctx.logger.info("Stripe plugin disabled for org", { orgId: ctx.org.id });
      // MCP servers are stopped automatically by the SDK
    },

    /**
     * Enable handler - called by core when plugin is enabled
     */
    async onEnable(ctx) {
      ctx.logger.info("Stripe plugin enabled");
      // Plugin will be restarted via onStart automatically for each org
    },
  };
});

/** Register the dispute webhook (when the API is public) and sync recent disputes. Best effort. */
async function startDisputeIntake(
  client: StripeClient,
  report: (dispute: CanonicalDispute) => Promise<unknown>,
  orgId: string,
  logger: { info: (m: string, c?: any) => void; warn: (m: string, c?: any) => void },
): Promise<void> {
  const url = webhookUrl(process.env.HAY_API_URL, process.env.HAY_PLUGIN_ID ?? "", orgId);
  if (url) {
    try {
      const result = await ensureWebhookEndpoint(client, url, orgId);
      logger.info("Stripe dispute webhook ready", { result });
    } catch (error) {
      logger.warn("Could not register the Stripe dispute webhook; relying on sync", {
        error: String(error),
      });
    }
  } else {
    logger.info("Stripe dispute webhook skipped: the API URL is not public https");
  }
  try {
    const count = await syncRecentDisputes(client, report);
    logger.info("Stripe disputes synced", { count });
  } catch (error) {
    logger.warn("Stripe dispute sync failed", { error: String(error) });
  }
}
