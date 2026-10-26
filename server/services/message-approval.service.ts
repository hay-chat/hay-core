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
import { MessageStatus, type Message } from "@server/database/entities/message.entity";
import type { Conversation } from "@server/database/entities/conversation.entity";
import { DeliveryState } from "@server/types/message-feedback.types";

const logger = createLogger("message-approval");

export class MessageApprovalService {
  constructor(
    private readonly messageRepository = new MessageRepository(),
    private readonly conversationRepository = new ConversationRepository(),
  ) {}

  /**
   * Release a queued reply to the customer, optionally with edited content.
   */
  async approve(args: {
    messageId: string;
    organizationId: string;
    userId: string;
    editedContent?: string;
  }): Promise<Message> {
    const { messageId, organizationId, userId, editedContent } = args;
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
      updates.content = editedContent;
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
      editedContent,
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
