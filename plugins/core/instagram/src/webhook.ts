import type { Request, Response } from "express";
import type { HayLogger } from "@hay/plugin-sdk/types";
import type { GraphClient } from "./graph-client.js";
import { PluginApiClient } from "./plugin-api.js";

export interface WebhookContext {
  /** Resolves the Graph client (built in onStart once credentials exist). */
  getGraphClient: () => GraphClient | null;
  /** Resolves the page/IG access token used to fetch sender profiles. */
  getAccessToken: () => string | null;
  logger: HayLogger;
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
    attachments?: unknown[];
  };
  postback?: unknown;
  reaction?: unknown;
}

interface MetaEntry {
  id?: string;
  time?: number;
  messaging?: MetaMessagingEvent[];
}

/**
 * Inbound Instagram webhook handler.
 *
 * Trust model: this worker runs localhost-only behind Hay Core. Core verifies
 * the shared Meta HMAC ONCE and only forwards verified, per-org payloads with
 * `x-hay-webhook-verified: true`. We reject anything missing that header (it
 * would mean a direct, unverified hit) and otherwise process the body.
 *
 * MVP scope — TEXT messages only. We explicitly log-and-ignore:
 *   - echoes (`message.is_echo`)       → our own outbound, would loop the AI
 *   - empty / whitespace-only text     → nothing to act on
 *   - attachment-only messages         → rich content is a follow-up ticket
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
      const events: MetaMessagingEvent[] = Array.isArray(entry.messaging) ? entry.messaging : [];

      for (const event of events) {
        const message = event.message;
        const senderPsid = event.sender?.id;

        // Echo of our own outbound — never feed it back to the orchestrator.
        if (message?.is_echo) {
          logger.info("Instagram event ignored — echo", { igAccountId });
          ignored++;
          continue;
        }

        // Postbacks / reactions are out of scope for the text-only MVP.
        if (!message) {
          logger.info("Instagram event ignored — non-message (postback/reaction)", {
            igAccountId,
            hasPostback: !!event.postback,
            hasReaction: !!event.reaction,
          });
          ignored++;
          continue;
        }

        // Attachment-only or empty text — nothing actionable in MVP.
        const text = typeof message.text === "string" ? message.text : "";
        if (!text || text.trim().length === 0) {
          logger.info("Instagram message ignored — no text content", {
            igAccountId,
            hasAttachments: Array.isArray(message.attachments) && message.attachments.length > 0,
          });
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

        const result = await apiClient.mutation<{
          messageId: string;
          conversationId: string;
          processed: boolean;
        }>("messages.receive", {
          from: `instagram:${senderPsid}`,
          content: text,
          channel: "instagram",
          senderType: "customer",
          metadata: {
            username,
            profileName,
            mid: message.mid,
            igAccountId,
            timestamp: event.timestamp,
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
