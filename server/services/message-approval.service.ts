/**
 * Message Approval Service
 *
 * Approval mode ("Require Approval" / test mode) stores AI replies with
 * `deliveryState: "queued"`; they are visible to the dashboard only. This
 * service is the single place a queued reply is released or blocked.
 *
 * Releasing a reply re-broadcasts it as a `message_received` event with
 * `deliveryState: "sent"`, which is what actually delivers it: the websocket
 * service pushes it to the webchat widget and channelDeliveryService posts it
 * to the channel plugin (WhatsApp, Instagram, Chatwoot, ...) for non-web
 * conversations. A separate `message_approved` / `message_blocked` event tells
 * dashboard clients to refresh the review state.
 */

import { TRPCError } from "@trpc/server";
import { createLogger } from "@server/lib/logger";
import { MessageRepository } from "@server/repositories/message.repository";
import { ConversationRepository } from "@server/repositories/conversation.repository";
import { conversationEventsService } from "./conversation-events.service";
import { MessageStatus, MessageType, type Message } from "@server/database/entities/message.entity";
import type { Conversation } from "@server/database/entities/conversation.entity";
import { DeliveryState } from "@server/types/message-feedback.types";
import { normalizeLanguage, type LanguageCode } from "@server/types/language.types";
import { customerLanguage } from "@server/orchestrator/conversation-utils";
import { translationService } from "./translation.service";

const logger = createLogger("message-approval");

/** Earlier messages sent along so a short edit ("yes, that one") translates right. */
const TRANSLATION_CONTEXT_MESSAGES = 6;
const TRANSLATION_CONTEXT_MAX_CHARS = 500;

export class MessageApprovalService {
  constructor(
    private readonly messageRepository = new MessageRepository(),
    private readonly conversationRepository = new ConversationRepository(),
  ) {}

  /**
   * Release a queued reply to the customer, optionally with edited content.
   *
   * Multilingual inbox: `editedInLanguage` is the language the reviewer wrote
   * `editedContent` in. When it differs from the customer's language the edit
   * is translated first and the customer gets the translation; the text as
   * typed is kept in `translations[editedInLanguage]`. A failed translation
   * leaves the reply queued (UNPROCESSABLE_CONTENT "TRANSLATION_FAILED").
   */
  async approve(args: {
    messageId: string;
    organizationId: string;
    userId: string;
    editedContent?: string;
    editedInLanguage?: LanguageCode;
  }): Promise<Message> {
    const { messageId, organizationId, userId, editedContent, editedInLanguage } = args;
    const { message, conversation } = await this.loadQueuedMessage(messageId, organizationId);

    const wasEdited = editedContent !== undefined && editedContent !== message.content;
    const updates: Partial<Message> = {
      status: wasEdited ? MessageStatus.EDITED : MessageStatus.APPROVED,
      deliveryState: DeliveryState.SENT,
      approvedBy: userId,
      approvedAt: new Date(),
    };
    if (wasEdited) {
      updates.originalContent = message.content;
      Object.assign(
        updates,
        await this.editedContentUpdates(message, conversation, editedContent, editedInLanguage),
      );
    }

    const updated = await this.release(message.id, updates);

    logger.info(
      { messageId: message.id, conversationId: conversation.id, channel: conversation.channel },
      "Queued message approved, releasing to customer",
    );

    // Delivery: the `sent` re-broadcast is what reaches the customer on every
    // channel. Channel plugins only hear it through Redis, so without Redis a
    // non-web reply is marked sent but never leaves the platform.
    if (conversation.channel !== "web") {
      const { redisService } = await import("./redis.service");
      if (!redisService.isConnected()) {
        logger.warn(
          { messageId: message.id, conversationId: conversation.id, channel: conversation.channel },
          "Redis unavailable: approved reply will not be delivered to the channel plugin",
        );
      }
    }
    await conversationEventsService.broadcastMessageReceived(conversation, updated);

    await this.publishOrganizationEvent(conversation.organization_id, "message_approved", {
      conversationId: conversation.id,
      messageId: message.id,
      messageType: message.type,
      editedContent: updated.status === MessageStatus.EDITED ? updated.content : undefined,
    });

    return updated;
  }

  /**
   * Drop a queued reply so it never reaches the customer.
   */
  async block(args: {
    messageId: string;
    organizationId: string;
    userId: string;
    reason?: string;
  }): Promise<Message> {
    const { messageId, organizationId, userId, reason } = args;
    const { message, conversation } = await this.loadQueuedMessage(messageId, organizationId);

    const updated = await this.release(message.id, {
      status: MessageStatus.REJECTED,
      deliveryState: DeliveryState.BLOCKED,
      approvedBy: userId,
      approvedAt: new Date(),
      metadata: { ...(message.metadata || {}), blockReason: reason },
    });

    await this.publishOrganizationEvent(conversation.organization_id, "message_blocked", {
      conversationId: conversation.id,
      messageId: message.id,
      messageType: message.type,
      reason,
    });

    return updated;
  }

  /**
   * `content` (what the customer gets), `translations` and `detectedLanguage`
   * for an edit. Translations of the old draft no longer match, so they go.
   */
  private async editedContentUpdates(
    message: Message,
    conversation: Conversation,
    editedContent: string,
    editedInLanguage: LanguageCode | undefined,
  ): Promise<Pick<Message, "content" | "translations" | "detectedLanguage">> {
    if (!editedInLanguage) {
      return {
        content: editedContent,
        translations: null,
        detectedLanguage: message.detectedLanguage,
      };
    }
    const target =
      normalizeLanguage(message.detectedLanguage) ??
      normalizeLanguage(customerLanguage(conversation.messages ?? [], conversation));
    const translations = { [editedInLanguage]: editedContent };
    if (!target || target === editedInLanguage) {
      return { content: editedContent, translations, detectedLanguage: editedInLanguage };
    }
    try {
      const result = await translationService.translateTexts({
        organizationId: conversation.organization_id,
        items: [{ id: message.id, text: editedContent }],
        targetLanguage: target,
        context: this.translationContext(conversation, message),
      });
      const translated = result.get(message.id);
      if (!translated) throw new Error("Translation returned no text");
      return { content: translated.text, translations, detectedLanguage: target };
    } catch (error) {
      logger.error(
        { err: error, messageId: message.id, conversationId: conversation.id, target },
        "Approval edit translation failed; reply stays queued",
      );
      throw new TRPCError({ code: "UNPROCESSABLE_CONTENT", message: "TRANSLATION_FAILED" });
    }
  }

  /** The customer-facing messages before `message`, as "Customer: ..." lines. */
  private translationContext(conversation: Conversation, message: Message): string {
    const messages = conversation.messages ?? [];
    const index = messages.findIndex((m) => m.id === message.id);
    return (index === -1 ? messages : messages.slice(0, index))
      .filter((m) =>
        [MessageType.CUSTOMER, MessageType.BOT_AGENT, MessageType.HUMAN_AGENT].includes(m.type),
      )
      .slice(-TRANSLATION_CONTEXT_MESSAGES)
      .map((m) => {
        const speaker = m.type === MessageType.CUSTOMER ? "Customer" : "Support";
        return `${speaker}: ${m.content.slice(0, TRANSLATION_CONTEXT_MAX_CHARS)}`;
      })
      .join("\n");
  }

  private async loadQueuedMessage(
    messageId: string,
    organizationId: string,
  ): Promise<{ message: Message; conversation: Conversation }> {
    const message = await this.messageRepository.findByIdAndOrganization(messageId, organizationId);
    const conversation = message
      ? await this.conversationRepository.findById(message.conversation_id)
      : null;
    if (!message || !conversation) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
    }
    if (message.deliveryState !== DeliveryState.QUEUED) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Message is not in queued state" });
    }
    return { message, conversation };
  }

  /**
   * Leave the queue atomically: the update only applies while the row is still
   * queued, so a double click or a second reviewer gets a BAD_REQUEST instead
   * of a second delivery.
   */
  private async release(messageId: string, updates: Partial<Message>): Promise<Message> {
    const updated = await this.messageRepository.transitionDeliveryState(
      messageId,
      DeliveryState.QUEUED,
      updates,
    );
    if (!updated) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Message is not in queued state" });
    }
    return updated;
  }

  /**
   * Dashboard-only notification (review state changed). Goes through Redis so
   * every server instance forwards it; falls back to the local WebSocket server.
   */
  private async publishOrganizationEvent(
    organizationId: string,
    type: "message_approved" | "message_blocked",
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      const { redisService } = await import("./redis.service");
      if (redisService.isConnected()) {
        await redisService.publish("websocket:events", { type, organizationId, payload });
        return;
      }
      const { websocketService } = await import("./websocket.service");
      websocketService.sendToOrganization(organizationId, { type, payload });
    } catch (error) {
      logger.error({ err: error, type }, "Failed to publish approval event");
    }
  }
}

export const messageApprovalService = new MessageApprovalService();
