import { defineHayPlugin } from "@hay/plugin-sdk";
import type { HayConfigRuntimeAPI, HayLogger, HayOrg } from "@hay/plugin-sdk/types";
import { PluginApiClient } from "./plugin-api.js";
import { ResendClient } from "./resend.js";
import { emptyState, type ChannelContext, type ChannelSettings } from "./context.js";
import { handleInbound } from "./inbound.js";
import { deliver } from "./deliver.js";
import { getChannelStatus } from "./status.js";
import { ingestAlias, splitAddress } from "./thread.js";
import { parseAddress } from "./mime.js";

/**
 * Email Channel Plugin
 *
 * Lets a store use its existing support mailbox as a Hay channel without
 * moving MX records or sharing credentials:
 *
 *   1. The merchant saves their public support address (support@store.com)
 *      and forwards that mailbox to the org's ingest alias on Hay's inbound
 *      domain (in-<hash>@EMAIL_INBOUND_DOMAIN, shown on the settings page).
 *   2. Resend receives the forwarded mail and posts one shared
 *      `email.received` webhook; core verifies the svix signature and routes
 *      it here by recipient address (the alias or the support address).
 *   3. The worker fetches the message, strips quoted history, resolves the
 *      thread and calls `messages.receive`; replies go out through the
 *      platform relay with threading headers and a Reply-To that carries the
 *      conversation id.
 *
 * Env (host allowlist): RESEND_API_KEY, RESEND_WEBHOOK_SECRET (used by core),
 * EMAIL_INBOUND_DOMAIN, SMTP_FROM_EMAIL (its domain is the From domain).
 */

const REQUIRED_ENV = [
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "EMAIL_INBOUND_DOMAIN",
  "SMTP_FROM_EMAIL",
];

function missingEnv(): string[] {
  return REQUIRED_ENV.filter((name) => !process.env[name]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Resolve settings from env + config; null while the channel cannot operate. */
export function resolveSettings(config: HayConfigRuntimeAPI, org: HayOrg): ChannelSettings | null {
  const inboundDomain = process.env.EMAIL_INBOUND_DOMAIN?.trim().toLowerCase();
  const fromDomain = splitAddress(process.env.SMTP_FROM_EMAIL?.trim().toLowerCase() ?? "").domain;
  if (!inboundDomain || !fromDomain) {
    return null;
  }
  const supportAddress =
    parseAddress(config.getOptional<string>("supportAddress") ?? "")?.address ?? null;
  const storeName =
    config.getOptional<string>("storeName")?.trim() || org.name?.trim() || "Support";
  return {
    alias: ingestAlias(org.id, inboundDomain),
    inboundDomain,
    supportAddress,
    storeName,
    fromAddress: `support@${fromDomain}`,
    bccArchive: config.getOptional<boolean>("bccArchive") === true,
  };
}

export default defineHayPlugin((globalCtx) => {
  const { logger } = globalCtx;

  let settings: ChannelSettings | null = null;
  let resend: ResendClient | null = null;
  const state = emptyState();

  const channelContext = (): ChannelContext => ({
    getSettings: () => settings,
    getResend: () => resend,
    api: new PluginApiClient(logger),
    logger,
    state,
  });

  /**
   * Claim the shared-webhook routing key. Only the alias: it is derived from
   * the org id and is the envelope recipient of every mail Resend receives for
   * this org (`data.to`). The merchant's support address is free-text config
   * with no proof of control, so it must never route mail — another org could
   * type the same address and receive their customers' email.
   */
  const registerRoutingKeys = async (current: ChannelSettings, log: HayLogger): Promise<void> => {
    try {
      await new PluginApiClient(log).mutation("webhooks.setRoutingKeys", {
        routingKeys: [current.alias],
      });
    } catch (error: unknown) {
      log.warn("Could not register email routing keys", { error: errorMessage(error) });
    }
  };

  const apply = async (ctx: {
    config: HayConfigRuntimeAPI;
    org: HayOrg;
    logger: HayLogger;
  }): Promise<void> => {
    const apiKey = process.env.RESEND_API_KEY;
    resend = apiKey ? new ResendClient({ apiKey }) : null;
    settings = resolveSettings(ctx.config, ctx.org);
    const missing = missingEnv();
    if (!settings || missing.length) {
      ctx.logger.info("Email channel not ready — missing host configuration", {
        orgId: ctx.org.id,
        missing,
      });
      return;
    }
    if (!settings.supportAddress) {
      ctx.logger.info("Email channel waiting for the support address", { orgId: ctx.org.id });
    }
    await registerRoutingKeys(settings, ctx.logger);
    ctx.logger.info("Email channel ready", {
      orgId: ctx.org.id,
      alias: settings.alias,
      hasSupportAddress: !!settings.supportAddress,
    });
  };

  return {
    name: "Email inbox",

    onInitialize(ctx) {
      const { register } = ctx;

      register.config({
        supportAddress: {
          type: "string",
          label: "Your support address",
          description:
            "The address your customers already write to, e.g. support@yourstore.com. You will forward this mailbox to the Hay address shown below.",
          required: true,
          encrypted: false,
        },
        storeName: {
          type: "string",
          label: "Sender name",
          description:
            'Shown as the sender of Hay\'s replies, e.g. "Acme Support". Defaults to your workspace name.',
          required: false,
          encrypted: false,
        },
        bccArchive: {
          type: "boolean",
          label: "Keep a copy in my inbox",
          description:
            "BCC your support address on every reply Hay sends, so your mailbox holds the whole conversation.",
          required: false,
          default: false,
        },
      });

      register.webhookRouting({
        signature: {
          header: "svix-signature",
          format: "svix",
          secretEnv: "RESEND_WEBHOOK_SECRET",
        },
        routeKeyPath: {
          itemsPath: "data.to",
          keyPath: ".",
          keyTransform: "email-address",
        },
      });

      register.ui.page({
        id: "email-setup",
        title: "Connect your inbox",
        component: "./components/settings/AfterSettings.vue",
        slot: "after-settings",
        icon: "mail",
      });

      // Core verified the shared svix signature and routed this org's slice.
      register.route("POST", "/webhook", async (req, res) => {
        if (req.headers["x-hay-webhook-verified"] !== "true") {
          logger.warn("Email webhook rejected — not verified by core");
          res.status(403).json({ error: "unverified" });
          return;
        }
        try {
          const summary = await handleInbound(req.body, channelContext());
          res.status(200).json({ received: true, ...summary });
        } catch (error: unknown) {
          state.lastError = errorMessage(error);
          logger.error("Email webhook handler error", { error: state.lastError });
          res.status(500).json({ error: "Internal server error" });
        }
      });

      register.route("POST", "/deliver", async (req, res) => {
        const result = await deliver(req.body, channelContext());
        res.status(result.status).json(result.body);
      });

      register.route("GET", "/ui/status", async (_req, res) => {
        res.status(200).json(getChannelStatus(channelContext(), missingEnv()));
      });

      logger.info("Email channel config, webhook routing, routes and UI registered");
    },

    async onStart(ctx) {
      await apply(ctx);
    },

    async onConfigUpdate(ctx) {
      await apply(ctx);
    },

    async onDisable(ctx) {
      ctx.logger.info("Email channel disabled", { orgId: ctx.org.id });
      settings = null;
      resend = null;
    },
  };
});
