import { createLogger } from "@server/lib/logger";
import type { Conversation } from "@server/database/entities/conversation.entity";
import type { Message } from "@server/database/entities/message.entity";

const logger = createLogger("websocket");

/** The subset of a conversation a message broadcast needs. */
type MessageBroadcastConversation = Pick<Conversation, "id" | "organization_id" | "metadata">;

/**
 * Service for broadcasting conversation-related events to WebSocket clients
 */
class ConversationEventsService {
  /**
   * Broadcast a message to everyone who should see it, as a `message_received`
   * event on the Redis "websocket:events" channel. Downstream:
   *   - websocketService forwards it to dashboard clients (all messages) and to
   *     webchat clients (public types with `deliveryState: "sent"`).
   *   - channelDeliveryService POSTs `sent` bot/agent messages on non-web
   *     channels to the channel plugin's /deliver.
   *
   * Call it when a message is created and again when a queued (approval-mode)
   * message becomes `sent`, so the approved reply actually reaches the customer.
   * Without Redis only webchat clients are notified, directly over WebSocket.
   */
  async broadcastMessageReceived(
    conversation: MessageBroadcastConversation,
    message: Message,
  ): Promise<void> {
    try {
      const { redisService } = await import("./redis.service");

      if (redisService.isConnected()) {
        await redisService.publish("websocket:events", {
          type: "message_received",
          organizationId: conversation.organization_id,
          conversationId: conversation.id,
          payload: {
            id: message.id,
            content: message.content,
            type: message.type,
            sender: message.sender,
            timestamp: message.created_at,
            metadata: message.metadata,
            attachments: message.attachments ?? [],
            status: message.status,
            deliveryState: message.deliveryState,
            isPlayground: conversation.metadata?.isPlayground === true,
          },
        });
        logger.debug(`Message ${message.id} published to Redis for broadcast`);
        return;
      }

      // Same gate websocketService applies on the Redis path: the customer only
      // ever sees public, released messages (or everything in the playground).
      const isPublic = ["Customer", "BotAgent", "HumanAgent"].includes(message.type);
      const isPlayground = conversation.metadata?.isPlayground === true;
      if (!isPlayground && !(isPublic && message.deliveryState === "sent")) {
        logger.debug({ messageId: message.id }, "Redis unavailable; message kept off webchat");
        return;
      }

      const { websocketService } = await import("./websocket.service");
      const sent = websocketService.sendToConversation(conversation.id, {
        type: "message",
        data: {
          id: message.id,
          content: message.content,
          type: message.type,
          sender: message.sender,
          timestamp: message.created_at,
          metadata: message.metadata,
        },
      });
      logger.debug(
        { messageId: message.id, conversationId: conversation.id, clientCount: sent },
        "Sent message to clients (Redis not available)",
      );
    } catch (error) {
      // The message is already persisted; clients will see it on refresh.
      logger.warn(
        { err: error, messageId: message.id, conversationId: conversation.id },
        "Message saved but broadcast failed - clients will see it on refresh",
      );
    }
  }

  /**
   * Broadcast conversation created event
   */
  async broadcastConversationCreated(conversation: Conversation): Promise<void> {
    try {
      const { redisService } = await import("./redis.service");

      if (!redisService.isConnected()) {
        logger.debug("Redis not connected, skipping conversation_created broadcast");
        return;
      }

      const eventPayload = {
        type: "conversation_created",
        organizationId: conversation.organization_id,
        payload: {
          id: conversation.id,
          title: conversation.title,
          status: conversation.status,
          channel: conversation.channel,
          created_at: conversation.created_at,
          updated_at: conversation.updated_at,
          ended_at: conversation.ended_at,
          agent_id: conversation.agent_id,
          customer_id: conversation.customer_id,
          assigned_user_id: conversation.assigned_user_id,
          assignedUser: conversation.assignedUser
            ? {
                id: conversation.assignedUser.id,
                firstName: conversation.assignedUser.firstName,
                lastName: conversation.assignedUser.lastName,
                email: conversation.assignedUser.email,
                avatarUrl: conversation.assignedUser.avatarUrl,
              }
            : null,
          metadata: conversation.metadata,
        },
      };

      await redisService.publish("websocket:events", eventPayload);
    } catch (error) {
      logger.debug({ err: error }, "Failed to broadcast conversation_created:");
    }
  }

  /**
   * Broadcast conversation updated event
   */
  async broadcastConversationUpdated(
    conversation: Conversation,
    changedFields?: string[],
  ): Promise<void> {
    try {
      const { redisService } = await import("./redis.service");

      if (!redisService.isConnected()) {
        logger.debug("Redis not connected, skipping conversation_updated broadcast");
        return;
      }

      // Skip broadcasting if only internal orchestrator fields changed
      const internalFields = [
        "processing_locked_until",
        "processing_locked_by",
        "needs_processing",
        "last_processed_at",
      ];
      const hasNonInternalChanges = changedFields?.some((field) => !internalFields.includes(field));

      if (changedFields && !hasNonInternalChanges) {
        return;
      }

      const eventPayload = {
        type: "conversation_updated",
        organizationId: conversation.organization_id,
        conversationId: conversation.id,
        payload: {
          id: conversation.id,
          title: conversation.title,
          status: conversation.status,
          channel: conversation.channel,
          created_at: conversation.created_at,
          updated_at: conversation.updated_at,
          ended_at: conversation.ended_at,
          closed_at: conversation.closed_at,
          agent_id: conversation.agent_id,
          customer_id: conversation.customer_id,
          assigned_user_id: conversation.assigned_user_id,
          assignedUser: conversation.assignedUser
            ? {
                id: conversation.assignedUser.id,
                firstName: conversation.assignedUser.firstName,
                lastName: conversation.assignedUser.lastName,
                email: conversation.assignedUser.email,
                avatarUrl: conversation.assignedUser.avatarUrl,
              }
            : null,
          metadata: conversation.metadata,
          changedFields, // Optional: which fields were changed
        },
      };

      await redisService.publish("websocket:events", eventPayload);
      logger.debug(`Broadcasted conversation_updated for ${conversation.id}`);

      // If status changed, also broadcast to conversation-specific clients (e.g., webchat widget)
      if (changedFields?.includes("status")) {
        const statusChangePayload = {
          type: "conversation_status_changed",
          organizationId: conversation.organization_id,
          conversationId: conversation.id,
          payload: {
            conversationId: conversation.id,
            status: conversation.status,
            title: conversation.title,
          },
        };
        await redisService.publish("websocket:events", statusChangePayload);
      }
    } catch (error) {
      logger.debug({ err: error }, "Failed to broadcast conversation_updated:");
    }
  }

  /**
   * Broadcast conversation deleted event
   */
  async broadcastConversationDeleted(
    conversationId: string,
    organizationId: string,
  ): Promise<void> {
    try {
      const { redisService } = await import("./redis.service");

      if (!redisService.isConnected()) {
        logger.debug("Redis not connected, skipping conversation_deleted broadcast");
        return;
      }

      const eventPayload = {
        type: "conversation_deleted",
        organizationId,
        conversationId,
        payload: {
          id: conversationId,
        },
      };

      await redisService.publish("websocket:events", eventPayload);
      logger.debug(`Broadcasted conversation_deleted for ${conversationId}`);
    } catch (error) {
      logger.debug({ err: error }, "Failed to broadcast conversation_deleted:");
    }
  }
}

export const conversationEventsService = new ConversationEventsService();
