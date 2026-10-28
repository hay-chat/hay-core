import type { Request, Response } from "express";
import type { HayLogger } from "@hay/plugin-sdk/types";
import type { GraphClient } from "./graph-client.js";
import { PluginApiClient } from "./plugin-api.js";
import { ingestMessage, type MessengerAttachment } from "./media.js";
import { isOwnApp, type SentMessageTracker } from "./echo.js";
import { messengerAddress, type PageRegistry } from "./pages.js";

export interface WebhookContext {
  getGraphClient: () => GraphClient | null;
  pages: PageRegistry;
  logger: HayLogger;
  /** Mids this worker sent, to drop the echoes of Hay.chat's own replies. */
  tracker?: SentMessageTracker;
  /** This Meta app's id(s); an echo carrying one as `app_id` is Hay.chat's own send. */
  ownAppIds?: Array<string | null | undefined>;
  /** Plugin API client (tests pass a fake). */
  api?: Pick<PluginApiClient, "mutation">;
}

/**
 * Messenger deliveries arrive as
 *   { object: "page", entry: [ { id: <pageId>, time, messaging: [ {...} ] } ] }
 *
 * Core's generic webhook router has already verified the shared HMAC, answered
 * the GET challenge, resolved the org from `entry[].id` (the Page id) and
 * forwarded only this org's entries with `x-hay-webhook-verified: true`.
 */
interface MetaMessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    app_id?: string | number;
    attachments?: MessengerAttachment[];
  };
  postback?: unknown;
  reaction?: unknown;
  read?: unknown;
  delivery?: unknown;
}

interface MetaEntry {
  id?: string;
  time?: number;
  messaging?: MetaMessagingEvent[];
}

/**
 * Inbound Messenger webhook. Customer messages (text, photos, videos, voice
 * notes, files) go to `messages.receive` as the customer
 * "messenger:<pageId>:<psid>". Echoes are the Page's own sends: Hay.chat's are
 * dropped, the owner's replies from the Page inbox become `human_agent`
 * messages so the AI stops answering over them. Postbacks, reactions, reads
 * and deliveries are ignored. Dedupe is core-side via `metadata.mid`.
 */
export async function webhookHandler(
  req: Request,
  res: Response,
  ctx: WebhookContext,
): Promise<void> {
  const { logger } = ctx;

  try {
    if (req.headers["x-hay-webhook-verified"] !== "true") {
      logger.warn("Messenger webhook rejected — missing internal verification header");
      res.status(403).json({ error: "unverified" });
      return;
    }

    const graphClient = ctx.getGraphClient();
    if (!graphClient) {
      logger.error("Messenger webhook received but the plugin is not connected");
      res.status(503).json({ error: "Plugin not fully configured" });
      return;
    }

    const entries: MetaEntry[] = Array.isArray(req.body?.entry) ? req.body.entry : [];
    const apiClient = ctx.api ?? new PluginApiClient(logger);
    let processed = 0;
    let ignored = 0;

    for (const entry of entries) {
      const pageId = entry.id;
      const page = pageId ? await ctx.pages.get(pageId) : null;
      if (!pageId || !page) {
        logger.warn("Messenger entry ignored — Page not connected", { pageId });
        ignored += entry.messaging?.length ?? 1;
        continue;
      }

      for (const event of entry.messaging ?? []) {
        const message = event.message;

        if (message?.is_echo) {
          if (await receiveEcho(event, pageId, apiClient, ctx)) processed++;
          else ignored++;
          continue;
        }

        const senderPsid = event.sender?.id;
        const text = typeof message?.text === "string" ? message.text : "";
        const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
        if (!message || !senderPsid || (!text.trim() && !attachments.length)) {
          ignored++;
          continue;
        }

        // A failed profile lookup never drops the message.
        let profileName: string | undefined;
        try {
          profileName = (await graphClient.getProfile(senderPsid, page.accessToken)).name;
        } catch (error: unknown) {
          logger.warn("Failed to resolve Messenger sender profile — continuing without it", {
            pageId,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        const ingested = attachments.length
          ? await ingestMessage({ text, attachments, mid: message.mid, api: apiClient, logger })
          : null;

        const result = await apiClient.mutation<{ messageId: string; conversationId: string }>(
          "messages.receive",
          {
            from: messengerAddress(pageId, senderPsid),
            content: ingested ? ingested.content : text,
            channel: "messenger",
            senderType: "customer",
            ...(ingested?.attachments.length ? { attachments: ingested.attachments } : {}),
            metadata: {
              ...(profileName ? { profileName } : {}),
              mid: message.mid,
              pageId,
              ...(page.name ? { pageName: page.name } : {}),
              timestamp: event.timestamp,
              ...(ingested?.voiceNote ? { voiceNote: true } : {}),
              ...(ingested?.mediaPlaceholder ? { mediaPlaceholder: true } : {}),
              ...(ingested?.failures.length ? { mediaFailures: ingested.failures } : {}),
            },
          },
        );

        logger.info("Messenger message forwarded to Hay.chat", {
          messageId: result.messageId,
          conversationId: result.conversationId,
          pageId,
          mid: message.mid,
        });
        processed++;
      }
    }

    res.status(200).json({ received: true, processed, ignored });
  } catch (error: unknown) {
    logger.error("Messenger webhook handler error", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: "Internal server error" });
  }
}

/** An echo of a Page send. Returns true when stored as the owner's reply. */
async function receiveEcho(
  event: MetaMessagingEvent,
  pageId: string,
  apiClient: Pick<PluginApiClient, "mutation">,
  ctx: WebhookContext,
): Promise<boolean> {
  const { logger } = ctx;
  const message = event.message ?? {};
  // On an echo the customer is the recipient.
  const customerPsid = event.recipient?.id;

  if (isOwnApp(message.app_id, ctx.ownAppIds ?? [])) {
    logger.info("Messenger echo ignored — sent by Hay.chat (app id)", { pageId });
    return false;
  }
  if (await ctx.tracker?.isOwn(message.mid, customerPsid)) {
    logger.info("Messenger echo ignored — sent by Hay.chat (mid)", { pageId });
    return false;
  }
  if (!customerPsid || customerPsid === pageId) return false;

  const text = typeof message.text === "string" ? message.text : "";
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (!text.trim() && !attachments.length) return false;

  const ingested = attachments.length
    ? await ingestMessage({ text, attachments, mid: message.mid, api: apiClient, logger })
    : null;

  const result = await apiClient.mutation<{ messageId: string | null; deduped?: boolean }>(
    "messages.receive",
    {
      from: messengerAddress(pageId, customerPsid),
      // Media lines are worded for the customer; this one came from the store.
      content: ingested ? ingested.content.replace(/\[Customer (sent|shared)/g, "[Store $1") : text,
      channel: "messenger",
      senderType: "human_agent",
      ...(ingested?.attachments.length ? { attachments: ingested.attachments } : {}),
      metadata: {
        mid: message.mid,
        pageId,
        timestamp: event.timestamp,
        echo: true,
        source: "page_inbox",
        ...(ingested?.mediaPlaceholder ? { mediaPlaceholder: true } : {}),
      },
    },
  );

  logger.info("Messenger Page inbox reply stored as a human message", {
    pageId,
    mid: message.mid,
    deduped: result.deduped ?? false,
  });
  return !result.deduped;
}
