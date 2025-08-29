import { t, authenticatedProcedure } from "@server/trpc";
import { z } from "zod";
import { ConversationService } from "../../../services/conversation.service";
import { MessageType } from "../../../database/entities/message.entity";
import { Hay, HayInputMessage } from "../../../services/hay.service";
import { TRPCError } from "@trpc/server";

const conversationService = new ConversationService();

const createConversationSchema = z.object({
  title: z.string().min(1).max(255),
  agentId: z.string().uuid()
});

const updateConversationSchema = z.object({
  title: z.string().min(1).max(255).optional()
});

const messageSchema = z.object({
  type: z.nativeEnum(MessageType),
  content: z.string(),
  usage_metadata: z.record(z.any()).optional()
});

const addMessageSchema = z.object({
  conversationId: z.string().uuid(),
  message: messageSchema
});

const invokeSchema = z.object({
  conversationId: z.string().uuid(),
  messages: z.array(messageSchema)
});

export const conversationsRouter = t.router({
  list: authenticatedProcedure
    .query(async ({ ctx }) => {
      const conversations = await conversationService.getConversations(ctx.organizationId!);
      return conversations;
    }),

  listByAgent: authenticatedProcedure
    .input(z.object({ agentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const conversations = await conversationService.getConversationsByAgent(
        ctx.organizationId!,
        input.agentId
      );
      return conversations;
    }),

  get: authenticatedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const conversation = await conversationService.getConversation(
        ctx.organizationId!,
        input.id
      );

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found"
        });
      }

      return conversation;
    }),

  create: authenticatedProcedure
    .input(createConversationSchema)
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationService.createConversation(
        ctx.organizationId!,
        input
      );
      return conversation;
    }),

  update: authenticatedProcedure
    .input(z.object({
      id: z.string().uuid(),
      data: updateConversationSchema
    }))
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationService.updateConversation(
        ctx.organizationId!,
        input.id,
        input.data
      );

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found"
        });
      }

      return conversation;
    }),

  delete: authenticatedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await conversationService.deleteConversation(
        ctx.organizationId!,
        input.id
      );

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found"
        });
      }

      return { success: true };
    }),

  getMessages: authenticatedProcedure
    .input(z.object({ 
      conversationId: z.string().uuid(),
      limit: z.number().optional().default(50)
    }))
    .query(async ({ ctx, input }) => {
      const conversation = await conversationService.getConversation(
        ctx.organizationId!,
        input.conversationId
      );

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found"
        });
      }

      const messages = input.limit 
        ? await conversationService.getLastMessages(input.conversationId, input.limit)
        : await conversationService.getMessages(input.conversationId);
      
      return messages;
    }),

  addMessage: authenticatedProcedure
    .input(addMessageSchema)
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationService.getConversation(
        ctx.organizationId!,
        input.conversationId
      );

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found"
        });
      }

      const message = await conversationService.addMessage(
        input.conversationId,
        input.message
      );

      return message;
    }),

  invoke: authenticatedProcedure
    .input(invokeSchema)
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationService.getConversation(
        ctx.organizationId!,
        input.conversationId
      );

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found"
        });
      }

      Hay.init();

      const response = await Hay.invoke(
        input.conversationId,
        input.messages as HayInputMessage[]
      );

      return response;
    }),

  invokeWithHistory: authenticatedProcedure
    .input(invokeSchema)
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationService.getConversation(
        ctx.organizationId!,
        input.conversationId
      );

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found"
        });
      }

      Hay.init();

      const response = await Hay.invokeWithHistory(
        input.conversationId,
        input.messages as HayInputMessage[]
      );

      return response;
    })
});