import { t, authenticatedProcedure, publicProcedure } from "@server/trpc";
import { z } from "zod";
import { ConversationService } from "../../../services/conversation.service";
import { MessageType, MessageStatus } from "../../../database/entities/message.entity";
import { TRPCError } from "@trpc/server";
import { generateConversationTitle } from "../../../orchestrator/conversation-utils";
import { conversationListInputSchema } from "@server/types/entity-list-inputs";
import { createListProcedure } from "@server/trpc/procedures/list";
import { ConversationRepository } from "@server/repositories/conversation.repository";
import { MessageRepository } from "@server/repositories/message.repository";
import { DeliveryState } from "@server/types/message-feedback.types";

const conversationService = new ConversationService();
const conversationRepository = new ConversationRepository();
const messageRepository = new MessageRepository();

const createConversationSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  agentId: z.string().uuid().optional(),
  language: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  status: z
    .enum(["open", "processing", "pending-human", "human-took-over", "resolved", "closed"])
    .optional(),
  customerId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
});

const updateConversationSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  status: z
    .enum(["open", "processing", "pending-human", "human-took-over", "resolved", "closed"])
    .optional(),
  metadata: z.record(z.any()).optional(),
  customer_id: z.string().uuid().optional(),
});

const messageSchema = z.object({
  type: z.nativeEnum(MessageType),
  content: z.string(),
  usage_metadata: z.record(z.any()).optional(),
});

const addMessageSchema = z.object({
  conversationId: z.string().uuid(),
  message: messageSchema,
});

const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string(),
  role: z.enum(["user", "assistant"]).optional().default("user"),
});

export const conversationsRouter = t.router({
  list: createListProcedure(conversationListInputSchema, conversationRepository),

  dailyStats: authenticatedProcedure
    .input(
      z.object({
        days: z.number().optional().default(30),
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const stats = await conversationService.getDailyConversationStats(
        ctx.organizationId!,
        input.days,
        input.startDate ? new Date(input.startDate) : undefined,
        input.endDate ? new Date(input.endDate) : undefined,
      );
      return stats;
    }),

  listByAgent: authenticatedProcedure
    .input(z.object({ agentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const conversations = await conversationService.getConversationsByAgent(
        ctx.organizationId!,
        input.agentId,
      );
      return conversations;
    }),

  get: publicProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    // For public access, try to get conversation without org ID restriction for now
    // In production, you might want to check a public flag or use session tokens
    const organizationId =
      ctx.organizationId || process.env.DEFAULT_ORG_ID || "c3578568-c83b-493f-991c-ca2d34a3bd17";
    const conversation = await conversationService.getConversation(input.id, organizationId);

    if (!conversation) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    }

    return conversation;
  }),

  create: publicProcedure.input(createConversationSchema).mutation(async ({ ctx, input }) => {
    // For public access, use organization ID from input or a default
    const organizationId =
      ctx.organizationId ||
      input.metadata?.organizationId ||
      process.env.DEFAULT_ORG_ID ||
      "c3578568-c83b-493f-991c-ca2d34a3bd17";
    const conversation = await conversationService.createConversation(organizationId, input);

    return conversation;
  }),

  update: authenticatedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: updateConversationSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationService.updateConversation(
        input.id,
        ctx.organizationId!,
        input.data,
      );

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      // Generate title when conversation is closed or resolved
      if (input.data.status === "closed" || input.data.status === "resolved") {
        await generateConversationTitle(input.id, ctx.organizationId!, false);
      }

      return conversation;
    }),

  delete: authenticatedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await conversationService.deleteConversation(ctx.organizationId!, input.id);

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      return { success: true };
    }),

  getMessages: authenticatedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        limit: z.number().optional().default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conversation = await conversationService.getConversation(
        input.conversationId,
        ctx.organizationId!,
      );

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      const messages = input.limit
        ? await conversationService.getLastMessages(
            input.conversationId,
            ctx.organizationId!,
            input.limit,
          )
        : await conversationService.getMessages(input.conversationId);

      return messages;
    }),

  addMessage: authenticatedProcedure.input(addMessageSchema).mutation(async ({ ctx, input }) => {
    const conversation = await conversationService.getConversation(
      input.conversationId,
      ctx.organizationId!,
    );

    if (!conversation) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    }

    // The addMessage method now handles cooldown logic for Customer messages
    const message = await conversation.addMessage({
      content: input.message.content,
      type: input.message.type,
      metadata: input.message.usage_metadata,
    });

    // Resolution detection is now handled by the perception layer
    // which checks for MessageIntent.CLOSE_SATISFIED or CLOSE_UNSATISFIED

    return message;
  }),

  sendMessage: authenticatedProcedure.input(sendMessageSchema).mutation(async ({ input, ctx }) => {
    const conversation = await conversationRepository.findById(input.conversationId);

    if (!conversation) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    }

    // Verify organization access
    if (conversation.organization_id !== ctx.organizationId) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    }

    // Determine message type based on role and takeover status
    let messageType: MessageType;
    if (input.role === "assistant") {
      // If conversation is taken over by current user, it's a human agent message
      const isTakenOverByCurrentUser =
        conversation.status === "human-took-over" && conversation.assigned_user_id === ctx.user?.id;

      messageType = isTakenOverByCurrentUser ? MessageType.HUMAN_AGENT : MessageType.BOT_AGENT;
    } else {
      messageType = MessageType.CUSTOMER;
    }

    // The addMessage method now handles cooldown logic for Customer messages
    const message = await conversation.addMessage({
      content: input.content,
      type: messageType,
      metadata: {
        sender: input.role || "user",
        sentByUserId: ctx.user?.id,
      },
    });

    return message;
  }),

  takeover: authenticatedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        force: z.boolean().optional().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationRepository.findById(input.conversationId);

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      // Verify organization access
      if (conversation.organization_id !== ctx.organizationId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this conversation",
        });
      }

      // Check if conversation is already closed or resolved
      if (["closed", "resolved"].includes(conversation.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot take over a closed or resolved conversation",
        });
      }

      // Check if already taken over by another user
      if (
        conversation.status === "human-took-over" &&
        conversation.assigned_user_id &&
        conversation.assigned_user_id !== ctx.user?.id &&
        !input.force
      ) {
        // Return current owner info for confirmation dialog
        const { userRepository } = await import("../../../repositories/user.repository");
        const currentOwner = await userRepository.findById(conversation.assigned_user_id);

        throw new TRPCError({
          code: "CONFLICT",
          message: "Conversation is already taken over by another user",
          cause: {
            currentOwner: {
              id: currentOwner?.id,
              name: currentOwner?.getFullName(),
              email: currentOwner?.email,
            },
          },
        });
      }

      const previousOwnerId = conversation.assigned_user_id;

      // Assign to current user
      await conversation.assignToUser(ctx.user!.id);

      // Add system message
      const { userRepository } = await import("../../../repositories/user.repository");
      const user = await userRepository.findById(ctx.user!.id);
      await conversation.addMessage({
        content: `${user?.getFullName() || "User"} took over this conversation`,
        type: MessageType.SYSTEM,
        metadata: {
          isTakeoverMessage: true,
          userId: ctx.user!.id,
          userName: user?.getFullName(),
        },
      });

      // Emit WebSocket event
      const { websocketService } = await import("../../../services/websocket.service");
      websocketService.sendToOrganization(ctx.organizationId!, {
        type: "conversation_taken_over",
        payload: {
          conversationId: conversation.id,
          userId: ctx.user!.id,
          userName: user?.getFullName(),
          previousOwnerId,
        },
      });

      return conversation;
    }),

  release: authenticatedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        returnToMode: z.enum(["ai", "queue"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationRepository.findById(input.conversationId);

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      // Verify organization access
      if (conversation.organization_id !== ctx.organizationId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this conversation",
        });
      }

      // Verify user is the one who took over
      if (conversation.assigned_user_id !== ctx.user!.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only release conversations assigned to you",
        });
      }

      // Release conversation
      await conversation.releaseFromUser(input.returnToMode);

      // Add system message
      const { userRepository } = await import("../../../repositories/user.repository");
      const user = await userRepository.findById(ctx.user!.id);
      const releaseMessage =
        input.returnToMode === "ai"
          ? `${user?.getFullName() || "User"} returned this conversation to AI`
          : `${user?.getFullName() || "User"} returned this conversation to the queue`;

      await conversation.addMessage({
        content: releaseMessage,
        type: MessageType.SYSTEM,
        metadata: {
          isReleaseMessage: true,
          userId: ctx.user!.id,
          userName: user?.getFullName(),
          returnToMode: input.returnToMode,
        },
      });

      // Emit WebSocket event
      const { websocketService } = await import("../../../services/websocket.service");
      websocketService.sendToOrganization(ctx.organizationId!, {
        type: "conversation_released",
        payload: {
          conversationId: conversation.id,
          newStatus: conversation.status,
          releasedBy: ctx.user!.id,
          userName: user?.getFullName(),
          returnToMode: input.returnToMode,
        },
      });

      return conversation;
    }),

  getAssignedUser: authenticatedProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const conversation = await conversationRepository.findById(input.conversationId);

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      // Verify organization access
      if (conversation.organization_id !== ctx.organizationId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this conversation",
        });
      }

      if (!conversation.assigned_user_id) {
        return null;
      }

      const { userRepository } = await import("../../../repositories/user.repository");
      const user = await userRepository.findById(conversation.assigned_user_id);

      if (!user) {
        return null;
      }

      return {
        id: user.id,
        name: user.getFullName(),
        email: user.email,
        assignedAt: conversation.assigned_at,
      };
    }),

  close: authenticatedProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationRepository.findById(input.conversationId);

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      // Verify organization access
      if (conversation.organization_id !== ctx.organizationId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this conversation",
        });
      }

      // Verify user is the one who took over (if conversation is taken over)
      if (
        conversation.status === "human-took-over" &&
        conversation.assigned_user_id !== ctx.user!.id
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only close conversations assigned to you",
        });
      }

      // Close conversation
      await conversation.closeConversation();

      // Add system message
      const { userRepository } = await import("../../../repositories/user.repository");
      const user = await userRepository.findById(ctx.user!.id);
      await conversation.addMessage({
        content: `${user?.getFullName() || "User"} closed this conversation`,
        type: MessageType.SYSTEM,
        metadata: {
          isCloseMessage: true,
          userId: ctx.user!.id,
          userName: user?.getFullName(),
        },
      });

      // Generate conversation title
      await generateConversationTitle(input.conversationId, ctx.organizationId!, false);

      // Emit WebSocket event
      const { websocketService } = await import("../../../services/websocket.service");
      websocketService.sendToOrganization(ctx.organizationId!, {
        type: "conversation_closed",
        payload: {
          conversationId: conversation.id,
          closedBy: ctx.user!.id,
          userName: user?.getFullName(),
        },
      });

      return conversation;
    }),

  approveMessage: authenticatedProcedure
    .input(
      z.object({
        messageId: z.string().uuid(),
        editedContent: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const message = await messageRepository.findById(input.messageId);

      if (!message) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Message not found",
        });
      }

      // Verify organization access through conversation
      const conversation = await conversationRepository.findById(message.conversation_id);
      if (!conversation || conversation.organization_id !== ctx.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Message not found",
        });
      }

      // Verify message is in queued state
      if (message.deliveryState !== DeliveryState.QUEUED) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Message is not in queued state",
        });
      }

      // If content was edited, store original content
      const wasEdited = input.editedContent && input.editedContent !== message.content;
      const updates: Partial<typeof message> = {
        status: wasEdited ? MessageStatus.EDITED : MessageStatus.APPROVED,
        deliveryState: DeliveryState.SENT,
        approvedBy: ctx.user!.id,
        approvedAt: new Date(),
      };

      if (wasEdited) {
        updates.originalContent = message.content;
        updates.content = input.editedContent;
      }

      const updatedMessage = await messageRepository.update(message.id, updates);

      // Broadcast message approval to WebSocket clients
      try {
        const { redisService } = await import("../../../services/redis.service");

        if (redisService.isConnected()) {
          await redisService.publish("websocket:events", {
            type: "message_approved",
            organizationId: conversation.organization_id,
            payload: {
              conversationId: message.conversation_id,
              messageId: message.id,
              messageType: message.type,
              editedContent: input.editedContent,
            },
          });
        } else {
          // Fallback to direct WebSocket if Redis not available
          const { websocketService } = await import("../../../services/websocket.service");
          websocketService.sendToOrganization(conversation.organization_id, {
            type: "message_approved",
            payload: {
              conversationId: message.conversation_id,
              messageId: message.id,
              messageType: message.type,
              editedContent: input.editedContent,
            },
          });
        }
      } catch (error) {
        console.error("[approveMessage] Failed to publish approval event:", error);
      }

      // TODO: Trigger actual message delivery to customer via WebSocket/plugin
      // This would be handled by the orchestrator or messaging service

      return updatedMessage;
    }),

  blockMessage: authenticatedProcedure
    .input(
      z.object({
        messageId: z.string().uuid(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const message = await messageRepository.findById(input.messageId);

      if (!message) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Message not found",
        });
      }

      // Verify organization access through conversation
      const conversation = await conversationRepository.findById(message.conversation_id);
      if (!conversation || conversation.organization_id !== ctx.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Message not found",
        });
      }

      // Verify message is in queued state
      if (message.deliveryState !== DeliveryState.QUEUED) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Message is not in queued state",
        });
      }

      // Update message to blocked state
      const updatedMessage = await messageRepository.update(message.id, {
        status: MessageStatus.REJECTED,
        deliveryState: DeliveryState.BLOCKED,
        approvedBy: ctx.user!.id,
        approvedAt: new Date(),
        metadata: {
          ...(message.metadata || {}),
          blockReason: input.reason,
        },
      });

      // Broadcast message block to WebSocket clients
      try {
        const { redisService } = await import("../../../services/redis.service");

        if (redisService.isConnected()) {
          await redisService.publish("websocket:events", {
            type: "message_blocked",
            organizationId: conversation.organization_id,
            payload: {
              conversationId: message.conversation_id,
              messageId: message.id,
              messageType: message.type,
              reason: input.reason,
            },
          });
        } else {
          // Fallback to direct WebSocket if Redis not available
          const { websocketService } = await import("../../../services/websocket.service");
          websocketService.sendToOrganization(conversation.organization_id, {
            type: "message_blocked",
            payload: {
              conversationId: message.conversation_id,
              messageId: message.id,
              messageType: message.type,
              reason: input.reason,
            },
          });
        }
      } catch (error) {
        console.error("[blockMessage] Failed to publish block event:", error);
      }

      return updatedMessage;
    }),

  /**
   * Set or remove legal hold on a conversation
   * Conversations with legal hold are exempt from automatic data retention anonymization
   */
  setLegalHold: authenticatedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        legalHold: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { dataRetentionService } = await import("../../../services/data-retention.service");

      const conversation = await dataRetentionService.setLegalHold(
        input.conversationId,
        ctx.organizationId!,
        input.legalHold,
      );

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      return {
        success: true,
        legalHold: conversation.legal_hold,
        legalHoldSetAt: conversation.legal_hold_set_at,
      };
    }),
});
