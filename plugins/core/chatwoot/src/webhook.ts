import type { Request, Response } from "express";
import type { HayLogger } from "@hay/plugin-sdk/types";
import { PluginApiClient } from "./plugin-api.js";

export interface WebhookContext {
  getWebhookSecret: () => string | null;
  logger: HayLogger;
}

/**
 * Inbound Chatwoot webhook handler.
 *
 * Chatwoot does not sign webhooks, so we authenticate via a shared secret
 * passed in the `?secret=` query param. The customer puts this secret in the
 * `outgoing_url` when creating the Agent Bot, and we reject requests without it.
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

    // Secret can come from query param or from an x-chatwoot-signature header
    // (we accept either for operator convenience).
    const providedSecret =
      (req.query?.secret as string | undefined) ??
      (req.headers["x-chatwoot-signature"] as string | undefined);

    if (!providedSecret || providedSecret !== expectedSecret) {
      logger.warn("Chatwoot webhook rejected — missing or invalid secret");
      res.status(403).json({ error: "Invalid webhook secret" });
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
