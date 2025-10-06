import { t, authenticatedProcedure, publicProcedure } from "@server/trpc";
import { z } from "zod";
import { ConversationService } from "../../../services/conversation.service";
import { MessageType } from "../../../database/entities/message.entity";
import { Hay } from "../../../services/hay.service";
import type { HayInputMessage } from "../../../services/hay.service";
import { TRPCError } from "@trpc/server";
import { generateConversationTitle } from "../../../orchestrator/conversation-utils";
import { conversationListInputSchema } from "@server/types/entity-list-inputs";
import { createListProcedure } from "@server/trpc/procedures/list";
import { ConversationRepository } from "@server/repositories/conversation.repository";

const conversationService = new ConversationService();
const conversationRepository = new ConversationRepository();

const createConversationSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  agentId: z.string().uuid().optional(),

  metadata: z.record(z.any()).optional(),
  status: z.enum(["open", "processing", "pending-human", "human-took-over", "resolved", "closed"]).optional(),
  customerId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
});

const updateConversationSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  status: z.enum(["open", "processing", "pending-human", "human-took-over", "resolved", "closed"]).optional(),
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

const invokeSchema = z.object({
  conversationId: z.string().uuid(),
  messages: z.array(messageSchema),
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

  invoke: authenticatedProcedure.input(invokeSchema).mutation(async ({ ctx, input }) => {
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

    Hay.init();

    const response = await Hay.invokeConversation(
      input.conversationId,
      ctx.organizationId!,
      input.messages as HayInputMessage[],
    );

    return response;
  }),

  invokeWithHistory: authenticatedProcedure.input(invokeSchema).mutation(async ({ ctx, input }) => {
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

    Hay.init();

    const response = await Hay.invokeWithHistory(
      input.conversationId,
      ctx.organizationId!,
      input.messages as HayInputMessage[],
    );

    return response;
  }),

  sendMessage: authenticatedProcedure.input(sendMessageSchema).mutation(async ({ input, ctx }) => {
    const conversation = await conversationRepository.findById(input.conversationId);

    if (!conversation) {
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
        conversation.status === "human-took-over" &&
        conversation.assigned_user_id === ctx.user?.id;

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

      // Check if conversation can be taken over
      if (!["pending-human", "human-took-over"].includes(conversation.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Conversation cannot be taken over in current status",
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
});
