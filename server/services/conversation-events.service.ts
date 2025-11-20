import { debugLog } from "@server/lib/debug-logger";
import type { Conversation } from "@server/database/entities/conversation.entity";

/**
 * Service for broadcasting conversation-related events to WebSocket clients
 */
class ConversationEventsService {
  /**
   * Broadcast conversation created event
   */
  async broadcastConversationCreated(conversation: Conversation): Promise<void> {
    try {
      const { redisService } = await import("./redis.service");

      if (!redisService.isConnected()) {
        debugLog(
          "conversation-events",
          "Redis not connected, skipping conversation_created broadcast",
        );
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
      debugLog("conversation-events", `Broadcasted conversation_created for ${conversation.id}`);
    } catch (error) {
      console.error("[ConversationEventsService] Failed to broadcast conversation_created:", error);
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
        debugLog(
          "conversation-events",
          "Redis not connected, skipping conversation_updated broadcast",
        );
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
      debugLog("conversation-events", `Broadcasted conversation_updated for ${conversation.id}`);

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
        debugLog(
          "conversation-events",
          `Broadcasted conversation_status_changed for ${conversation.id} to status: ${conversation.status}`,
        );
      }
    } catch (error) {
      console.error("[ConversationEventsService] Failed to broadcast conversation_updated:", error);
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
        debugLog(
          "conversation-events",
          "Redis not connected, skipping conversation_deleted broadcast",
        );
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
      debugLog("conversation-events", `Broadcasted conversation_deleted for ${conversationId}`);
    } catch (error) {
      console.error("[ConversationEventsService] Failed to broadcast conversation_deleted:", error);
    }
  }
}

export const conversationEventsService = new ConversationEventsService();
