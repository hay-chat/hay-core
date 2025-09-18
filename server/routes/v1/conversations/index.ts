import { t, authenticatedProcedure } from "@server/trpc";
import { z } from "zod";
import { ConversationService } from "../../../services/conversation.service";
import { MessageType } from "../../../database/entities/message.entity";
import { Hay } from "../../../services/hay.service";
import type { HayInputMessage } from "../../../services/hay.service";
import { TRPCError } from "@trpc/server";
import { PlaybookService } from "../../../services/playbook.service";
import { generateConversationTitle } from "../../../orchestrator/conversation-utils";
import { conversationListInputSchema } from "@server/types/entity-list-inputs";
import { createListProcedure } from "@server/trpc/procedures/list";
import { ConversationRepository } from "@server/repositories/conversation.repository";
import { config } from "../../../config/env";

const conversationService = new ConversationService();
const playbookService = new PlaybookService();
const conversationRepository = new ConversationRepository();

const createConversationSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  agentId: z.string().uuid().optional(),
  playbook_id: z.string().uuid().optional(),
  metadata: z.record(z.any()).optional(),
  status: z.enum(["open", "processing", "pending-human", "resolved", "closed"]).optional(),
  customer_id: z.string().uuid().optional(),
});

const updateConversationSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  status: z.enum(["open", "processing", "pending-human", "resolved", "closed"]).optional(),
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

  get: authenticatedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const conversation = await conversationService.getConversation(input.id, ctx.organizationId!);

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      return conversation;
    }),

  create: authenticatedProcedure
    .input(createConversationSchema)
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationService.createConversation(ctx.organizationId!, input);

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

    if (input.message.type === MessageType.CUSTOMER) {
      conversation.setProcessed(false);
    }

    const message = await conversation.addMessage({
      content: input.message.content,
      type: input.message.type,
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

  sendMessage: authenticatedProcedure.input(sendMessageSchema).mutation(async ({ ctx, input }) => {
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

    // Add the message
    const messageType = input.role === "assistant" ? MessageType.BOT_AGENT : MessageType.CUSTOMER;

    const message = await conversationService.addMessage(
      input.conversationId,
      ctx.organizationId!,
      {
        content: input.content,
        type: messageType,
        sender: input.role || "user",
      },
    );

    // Mark conversation as needing processing if it's a user message
    if (input.role === "user" || !input.role) {
      // Set cooldown based on configuration
      // This allows the user to keep typing, and we'll process when they stop
      const cooldownUntil = new Date();
      const cooldownSeconds = Math.floor(config.conversation.cooldownInterval / 1000);
      cooldownUntil.setSeconds(cooldownUntil.getSeconds() + cooldownSeconds);

      // console.log(`[Conversations] Setting cooldown for ${cooldownSeconds} seconds (until ${cooldownUntil.toISOString()})`);

      await conversationService.updateConversation(input.conversationId, ctx.organizationId!, {
        status: "open",
        needs_processing: true,
        cooldown_until: cooldownUntil,
      });
    }

    return message;
  }),
});
