import type { Request, Response } from "express";
import type { HayLogger } from "@hay/plugin-sdk/types";
import type { GraphClient } from "./graph-client.js";
import { PluginApiClient } from "./plugin-api.js";
import { ingestMessage, type InstagramAttachment } from "./media.js";
import { isOwnApp, type SentMessageTracker } from "./echo.js";

export interface WebhookContext {
  /** Resolves the Graph client (built in onStart once credentials exist). */
  getGraphClient: () => GraphClient | null;
  /** Resolves the page/IG access token used to fetch sender profiles. */
  getAccessToken: () => string | null;
  logger: HayLogger;
  /** Mids this worker sent, to drop the echoes of Hay.chat's own replies (D11-11). */
  tracker?: SentMessageTracker;
  /** This Meta app's id(s); an echo carrying one as `app_id` is Hay.chat's own send. */
  ownAppIds?: Array<string | null | undefined>;
}

/**
 * Minimal shape of the Meta webhook envelope we consume.
 *
 * Instagram messaging deliveries arrive as:
 *   { object: "instagram", entry: [ { id, time, messaging: [ {...} ] } ] }
 *
 * Core's generic webhook router has already verified the shared HMAC over the
 * raw bytes, answered the GET hub.challenge handshake, resolved the org from
 * `entry[].id`, and forwarded ONLY this org's reconstructed entries with the
 * internal header `x-hay-webhook-verified: true`. This handler trusts that
 * header and never re-verifies the signature or handles the GET challenge.
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
    attachments?: InstagramAttachment[];
  };
  postback?: unknown;
  reaction?: unknown;
}

interface MetaChange {
  field?: string;
  value?: MetaMessagingEvent;
}

interface MetaEntry {
  id?: string;
  time?: number;
  /** Messenger-style delivery (real-time IG DMs). */
  messaging?: MetaMessagingEvent[];
  /** Field-subscription-style delivery (some IG-Login deliveries + Meta's test tool). */
  changes?: MetaChange[];
}

/**
 * Normalize an entry's events into a single list, tolerating BOTH shapes Meta
 * uses for the `messages` field:
 *   - `entry.messaging[]`              (Messenger-style real-time DMs)
 *   - `entry.changes[].value` where    (field-subscription style; this is what
 *     `field === "messages"`            Meta's webhook "Test" button sends)
 * Either way we end up with `{ sender, recipient, message }` events.
 */
function collectMessagingEvents(entry: MetaEntry): MetaMessagingEvent[] {
  const events: MetaMessagingEvent[] = [];
  if (Array.isArray(entry.messaging)) {
    events.push(...entry.messaging);
  }
  if (Array.isArray(entry.changes)) {
    for (const change of entry.changes) {
      if (change.field === "messages" && change.value && typeof change.value === "object") {
        events.push(change.value);
      }
    }
  }
  return events;
}

/**
 * Inbound Instagram webhook handler.
 *
 * Trust model: this worker runs localhost-only behind Hay Core. Core verifies
 * the shared Meta HMAC ONCE and only forwards verified, per-org payloads with
 * `x-hay-webhook-verified: true`. We reject anything missing that header (it
 * would mean a direct, unverified hit) and otherwise process the body.
 *
 * Text and attachments (D8-6): images, videos, voice notes and files are
 * stored in Hay at once (voice notes transcribed); story mentions, reels and
 * shared posts become a text line. An attachment-only message always reaches
 * the agent. Echoes (`message.is_echo`) are the business account's own sends:
 * Hay.chat's replies are dropped, the owner's replies typed in the Instagram app
 * become `human_agent` messages so the AI stops answering over them (D11-11).
 * We explicitly log-and-ignore:
 *   - no text and no attachments       → nothing to act on
 *   - postbacks / reactions            → not modeled yet
 *
 * Inbound dedupe is handled core-side via `metadata.mid`, so we always return
 * 200 on a handled request; transient internal errors return 500 (Meta retries
 * only on 5xx, which is the correct behavior for a genuine processing failure).
 */
export async function webhookHandler(
  req: Request,
  res: Response,
  ctx: WebhookContext,
): Promise<void> {
  const { logger } = ctx;

  try {
    // Defense in depth: only accept payloads Core has already verified.
    if (req.headers["x-hay-webhook-verified"] !== "true") {
      logger.warn("Instagram webhook rejected — missing internal verification header");
      res.status(403).json({ error: "unverified" });
      return;
    }

    const graphClient = ctx.getGraphClient();
    const accessToken = ctx.getAccessToken();
    if (!graphClient || !accessToken) {
      logger.error("Instagram webhook received but plugin credentials not configured");
      res.status(503).json({ error: "Plugin not fully configured" });
      return;
    }

    const body = req.body ?? {};
    const entries: MetaEntry[] = Array.isArray(body.entry) ? body.entry : [];

    if (entries.length === 0) {
      logger.info("Instagram webhook with no entries — ignoring");
      res.status(200).json({ received: true, ignored: "no_entries" });
      return;
    }

    const apiClient = new PluginApiClient(logger);
    let processed = 0;
    let ignored = 0;

    for (const entry of entries) {
      const igAccountId = entry.id;
      const events = collectMessagingEvents(entry);

      for (const event of events) {
        const message = event.message;
        const senderPsid = event.sender?.id;

        if (message?.is_echo) {
          if (await receiveEcho(event, igAccountId, apiClient, ctx)) {
            processed++;
          } else {
            ignored++;
          }
          continue;
        }

        // Postbacks / reactions are not modeled yet.
        if (!message) {
          logger.info("Instagram event ignored — non-message (postback/reaction)", {
            igAccountId,
            hasPostback: !!event.postback,
            hasReaction: !!event.reaction,
          });
          ignored++;
          continue;
        }

        const text = typeof message.text === "string" ? message.text : "";
        const attachments = Array.isArray(message.attachments) ? message.attachments : [];
        if (text.trim().length === 0 && attachments.length === 0) {
          logger.info("Instagram message ignored — no text or attachments", { igAccountId });
          ignored++;
          continue;
        }

        if (!senderPsid) {
          logger.warn("Instagram message ignored — missing sender id", { igAccountId });
          ignored++;
          continue;
        }

        // Resolve sender profile for the customer record. Profile lookups can
        // fail (privacy settings, transient Graph errors) — degrade gracefully
        // and still ingest the message rather than dropping it.
        let username: string | undefined;
        let profileName: string | undefined;
        try {
          const profile = await graphClient.getProfile(senderPsid, accessToken);
          username = profile.username;
          profileName = profile.name;
        } catch (error: any) {
          logger.warn("Failed to resolve Instagram sender profile — continuing without it", {
            senderPsid,
            error: error?.message,
          });
        }

        const ingested =
          attachments.length > 0
            ? await ingestMessage({ text, attachments, mid: message.mid, api: apiClient, logger })
            : null;

        const result = await apiClient.mutation<{
          messageId: string;
          conversationId: string;
          processed: boolean;
        }>("messages.receive", {
          from: `instagram:${senderPsid}`,
          content: ingested ? ingested.content : text,
          channel: "instagram",
          senderType: "customer",
          ...(ingested?.attachments.length ? { attachments: ingested.attachments } : {}),
          metadata: {
            username,
            profileName,
            mid: message.mid,
            igAccountId,
            timestamp: event.timestamp,
            ...(ingested?.voiceNote ? { voiceNote: true } : {}),
            ...(ingested?.mediaPlaceholder ? { mediaPlaceholder: true } : {}),
            ...(ingested?.failures.length ? { mediaFailures: ingested.failures } : {}),
          },
        });

        logger.info("Instagram message forwarded to Hay orchestrator", {
          messageId: result.messageId,
          conversationId: result.conversationId,
          igAccountId,
          mid: message.mid,
        });
        processed++;
      }
    }

    res.status(200).json({ received: true, processed, ignored });
  } catch (error: any) {
    logger.error("Instagram webhook handler error", {
      error: error?.message,
      stack: error?.stack,
    });
    res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * An echo of a message the business account sent. Hay.chat's own sends (by
 * app id, or a mid this worker sent) are dropped; anything else is the owner
 * replying from the Instagram app and is stored as a human message, which
 * core treats like a take-over. Returns true when stored.
 */
async function receiveEcho(
  event: MetaMessagingEvent,
  igAccountId: string | undefined,
  apiClient: PluginApiClient,
  ctx: WebhookContext,
): Promise<boolean> {
  const { logger } = ctx;
  const message = event.message ?? {};
  // On an echo the shopper is the recipient.
  const customerPsid = event.recipient?.id;

  if (isOwnApp(message.app_id, ctx.ownAppIds ?? [])) {
    logger.info("Instagram echo ignored — sent by Hay.chat (app id)", { igAccountId });
    return false;
  }
  if (await ctx.tracker?.isOwn(message.mid, customerPsid)) {
    logger.info("Instagram echo ignored — sent by Hay.chat (mid)", { igAccountId });
    return false;
  }
  if (!customerPsid || customerPsid === igAccountId) {
    logger.warn("Instagram echo ignored — missing recipient id", { igAccountId });
    return false;
  }

  const text = typeof message.text === "string" ? message.text : "";
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (text.trim().length === 0 && attachments.length === 0) {
    logger.info("Instagram echo ignored — no text or attachments", { igAccountId });
    return false;
  }

  const ingested =
    attachments.length > 0
      ? await ingestMessage({ text, attachments, mid: message.mid, api: apiClient, logger })
      : null;

  const result = await apiClient.mutation<{ messageId: string | null; deduped?: boolean }>(
    "messages.receive",
    {
      from: `instagram:${customerPsid}`,
      // Media lines are worded for the shopper; this one came from the store.
      content: ingested ? ingested.content.replace(/\[Customer sent/g, "[Store sent") : text,
      channel: "instagram",
      senderType: "human_agent",
      ...(ingested?.attachments.length ? { attachments: ingested.attachments } : {}),
      metadata: {
        mid: message.mid,
        igAccountId,
        timestamp: event.timestamp,
        echo: true,
        source: "instagram_app",
        ...(ingested?.mediaPlaceholder ? { mediaPlaceholder: true } : {}),
      },
    },
  );

  logger.info("Instagram app reply stored as a human message", {
    igAccountId,
    mid: message.mid,
    messageId: result.messageId,
    deduped: result.deduped ?? false,
  });
  return !result.deduped;
}
