import crypto from "node:crypto";
import type { Request, Response } from "express";
import type { HayLogger } from "@hay/plugin-sdk/types";
import { PluginApiClient } from "./plugin-api.js";

export interface WebhookContext {
  getWebhookSecret: () => string | null;
  logger: HayLogger;
}

// Reject requests whose timestamp is older than this window (in seconds).
// Matches Chatwoot's own recommendation and defeats trivial replay attacks.
const REPLAY_WINDOW_SECONDS = 300;

/**
 * Verify Chatwoot's HMAC signature headers against the raw request body.
 *
 * Chatwoot sends three headers on every Agent Bot webhook (as of PR
 * chatwoot/chatwoot#13892, merged April 2026):
 *
 *   X-Chatwoot-Signature: sha256=<hex>
 *   X-Chatwoot-Timestamp: <unix seconds>
 *   X-Chatwoot-Delivery:  <uuid>
 *
 * The signature is HMAC-SHA256(webhookSecret, `${timestamp}.${rawBody}`)
 * — Stripe's convention, which blocks replay attacks that swap timestamps.
 *
 * We must verify against the *exact* original bytes Chatwoot signed. Hay's
 * plugin proxy parses and re-serializes JSON bodies, so we rely on the
 * `x-original-body-base64` header the proxy forwards for this purpose.
 */
function verifyChatwootSignature(
  secret: string,
  rawBody: string,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!timestampHeader || !signatureHeader) {
    return { ok: false, reason: "missing_signature_headers" };
  }

  const ts = parseInt(timestampHeader, 10);
  if (!Number.isFinite(ts) || ts <= 0) {
    return { ok: false, reason: "invalid_timestamp" };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");

  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signatureHeader, "utf8");
  if (expectedBuf.length !== actualBuf.length) {
    return { ok: false, reason: "signature_mismatch" };
  }
  if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    return { ok: false, reason: "signature_mismatch" };
  }

  return { ok: true };
}

/**
 * Inbound Chatwoot webhook handler.
 *
 * Authentication: Chatwoot signs every Agent Bot webhook with HMAC-SHA256
 * over `${timestamp}.${rawBody}` using the bot's Webhook Secret (shown in the
 * Chatwoot bot Edit page with a Reset button). We verify the signature here;
 * requests without valid headers are rejected.
 *
 * Filters (all necessary — without them the AI would respond to itself, leak
 * internal notes, or re-process template messages):
 *   - message_type 1 (outgoing) + sender.type "AgentBot"  → bot echo, drop
 *   - message_type 2 (template)                            → template, drop
 *   - private === true                                     → internal note, drop
 *   - event !== "message_created"                          → irrelevant, drop
 *
 * For customer messages (message_type 0) we call messages.receive as "customer".
 * For outgoing messages authored by a human User (not AgentBot), we call
 * messages.receive as "human_agent" so Hay flips the conversation to
 * human-took-over and the orchestrator stops running on it.
 */
export async function webhookHandler(
  req: Request,
  res: Response,
  ctx: WebhookContext,
): Promise<void> {
  const { logger } = ctx;

  try {
    const expectedSecret = ctx.getWebhookSecret();
    if (!expectedSecret) {
      logger.error("Chatwoot webhook received but webhook secret not configured");
      res.status(503).json({ error: "Plugin not fully configured" });
      return;
    }

    // The plugin proxy forwards the exact original request body as a
    // base64-encoded header so we can verify HMAC against the bytes Chatwoot
    // actually signed (re-serializing the parsed body loses whitespace and
    // key order).
    const rawBodyB64 = req.headers["x-original-body-base64"];
    const rawBody =
      typeof rawBodyB64 === "string" ? Buffer.from(rawBodyB64, "base64").toString("utf8") : "";

    if (!rawBody) {
      logger.warn("Chatwoot webhook rejected — missing x-original-body-base64 header");
      res.status(400).json({ error: "Missing raw body for signature verification" });
      return;
    }

    const timestampHeader = req.headers["x-chatwoot-timestamp"];
    const signatureHeader = req.headers["x-chatwoot-signature"];

    const verify = verifyChatwootSignature(
      expectedSecret,
      rawBody,
      typeof timestampHeader === "string" ? timestampHeader : undefined,
      typeof signatureHeader === "string" ? signatureHeader : undefined,
    );

    if (!verify.ok) {
      const reason = (verify as { ok: false; reason: string }).reason;
      logger.warn("Chatwoot webhook rejected — HMAC verification failed", { reason });
      res.status(403).json({ error: "Invalid signature", reason });
      return;
    }

    const body = req.body ?? {};
    const event = body.event;

    // We only care about new messages. Chatwoot fires many other events
    // (conversation_created, conversation_updated, contact_created, …) that we
    // don't need for the orchestrator loop.
    if (event !== "message_created") {
      res.status(200).json({ received: true, ignored: `event=${event}` });
      return;
    }

    const messageType = body.message_type; // 0=incoming, 1=outgoing, 2=template
    const isPrivate = body.private === true;
    const content: string = body.content ?? "";
    const senderType: string | undefined = body.sender?.type; // "Contact" | "User" | "AgentBot"
    const conversation = body.conversation ?? {};
    const chatwootConversationId =
      conversation.id ?? body.conversation_id ?? body.additional_attributes?.conversation_id;
    const contact = conversation.meta?.sender ?? body.sender ?? {};
    const contactId = contact.id;
    const inbox = body.inbox ?? {};

    if (!chatwootConversationId || !contactId) {
      logger.warn("Webhook missing conversation or contact id — dropping", {
        chatwootConversationId,
        contactId,
        event,
      });
      res.status(200).json({ received: true, ignored: "missing_ids" });
      return;
    }

    // Drop internal notes — these are agent-to-agent communication inside Chatwoot.
    if (isPrivate) {
      res.status(200).json({ received: true, ignored: "private_note" });
      return;
    }

    // Drop template messages (WhatsApp HSMs etc.) — we don't want the AI to
    // respond to a canned template as if it were a customer prompt.
    if (messageType === 2) {
      res.status(200).json({ received: true, ignored: "template" });
      return;
    }

    // Drop our own outgoing bot messages (the echo Chatwoot sends after we POST
    // to /messages). We identify them as outgoing + sender.type === AgentBot.
    if (messageType === 1 && senderType === "AgentBot") {
      res.status(200).json({ received: true, ignored: "bot_echo" });
      return;
    }

    // Skip empty content after the filters above (can happen for attachment-
    // only messages — we don't handle attachments in v1).
    if (!content || content.trim().length === 0) {
      res.status(200).json({ received: true, ignored: "empty_content" });
      return;
    }

    // Determine whether this is a customer message or a human-agent reply.
    //   message_type === 0 && sender === Contact   → customer
    //   message_type === 1 && sender === User      → human agent reply
    let hayRole: "customer" | "human_agent";
    if (messageType === 0) {
      hayRole = "customer";
    } else if (messageType === 1 && senderType === "User") {
      hayRole = "human_agent";
    } else {
      // Anything else (outgoing + non-User, unknown combinations) — drop.
      res.status(200).json({ received: true, ignored: "unhandled_type" });
      return;
    }

    // Use Chatwoot's contact id as the Hay external_id so the customer survives
    // across multiple Chatwoot conversations for the same contact.
    const from = `chatwoot:${contactId}`;

    logger.info("Chatwoot message received", {
      chatwootConversationId,
      contactId,
      role: hayRole,
      contentLength: content.length,
    });

    const apiClient = new PluginApiClient(logger);
    const result = await apiClient.mutation<{
      messageId: string;
      conversationId: string;
      processed: boolean;
    }>("messages.receive", {
      from,
      content,
      channel: "chatwoot",
      senderType: hayRole,
      externalConversationId: String(chatwootConversationId),
      metadata: {
        chatwootContactId: contactId,
        chatwootConversationId,
        chatwootAccountId: body.account?.id,
        chatwootInboxId: inbox.id,
        chatwootInboxName: inbox.name,
        chatwootMessageId: body.id,
        contactName: contact.name,
        contactEmail: contact.email,
      },
    });

    logger.info("Message forwarded to Hay orchestrator", {
      messageId: result.messageId,
      conversationId: result.conversationId,
      role: hayRole,
    });

    res.status(200).json({ received: true, processed: true });
  } catch (error: any) {
    logger.error("Chatwoot webhook handler error", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: "Internal server error" });
  }
}
