import { t, authenticatedProcedure } from "@server/trpc";
import { z } from "zod";
import { ConversationService } from "../../../services/conversation.service";
import { MessageType } from "../../../database/entities/message.entity";
import { Hay } from "../../../services/hay.service";
import type { HayInputMessage } from "../../../services/hay.service";
import { TRPCError } from "@trpc/server";
import { PlaybookService } from "../../../services/playbook.service";
import { OrchestratorService } from "../../../services/orchestrator.service";
import { AgentService } from "../../../services/agent.service";
import { VectorStoreService } from "../../../services/vector-store.service";

const conversationService = new ConversationService();
const playbookService = new PlaybookService();
const agentService = new AgentService();
const vectorStoreService = new VectorStoreService();
const orchestratorService = new OrchestratorService(
  conversationService,
  playbookService,
  agentService,
  vectorStoreService
);

const createConversationSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  agentId: z.string().uuid().optional(),
  playbook_id: z.string().uuid().optional(),
  metadata: z.record(z.any()).optional(),
  status: z.enum(['open', 'processing', 'pending-human', 'resolved', 'closed']).optional(),
});

const updateConversationSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  status: z.enum(['open', 'processing', 'pending-human', 'resolved', 'closed']).optional(),
  metadata: z.record(z.any()).optional(),
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
  role: z.enum(['user', 'assistant']).optional().default('user'),
});

export const conversationsRouter = t.router({
  list: authenticatedProcedure
    .input(z.object({
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
      orderBy: z.string().optional().default('created_at'),
      orderDirection: z.enum(['asc', 'desc']).optional().default('desc'),
    }).optional())
    .query(async ({ ctx, input }) => {
      const conversations = await conversationService.getConversations(
        ctx.organizationId!
      );
      
      // Apply ordering and pagination
      const sorted = conversations.sort((a, b) => {
        const order = input?.orderDirection === 'desc' ? -1 : 1;
        return order * (new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      });
      
      const paginated = sorted.slice(
        input?.offset || 0, 
        (input?.offset || 0) + (input?.limit || 50)
      );
      
      return {
        items: paginated,
        total: conversations.length,
        limit: input?.limit || 50,
        offset: input?.offset || 0
      };
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
        input.id,
        ctx.organizationId!
      );

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
      const conversation = await conversationService.createConversation(
        ctx.organizationId!,
        input
      );
      
      // Add welcome message
      const welcomePlaybook = await playbookService.getActivePlaybook("welcome", ctx.organizationId!);
      const welcomeMessage = welcomePlaybook?.prompt_template || "Hello! How can I help you today?";
      
      await conversationService.addMessage(
        conversation.id,
        ctx.organizationId!,
        {
          content: welcomeMessage,
          type: MessageType.AI_MESSAGE,
          sender: "assistant"
        }
      );
      
      return conversation;
    }),

  update: authenticatedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: updateConversationSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationService.updateConversation(
        input.id,
        ctx.organizationId!,
        input.data
      );

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
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
      })
    )
    .query(async ({ ctx, input }) => {
      const conversation = await conversationService.getConversation(
        input.conversationId,
        ctx.organizationId!
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
            input.limit
          )
        : await conversationService.getMessages(input.conversationId);

      return messages;
    }),

  addMessage: authenticatedProcedure
    .input(addMessageSchema)
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationService.getConversation(
        input.conversationId,
        ctx.organizationId!
      );

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      const message = await conversationService.addMessage(
        input.conversationId,
        ctx.organizationId!,
        input.message
      );

      // Check for resolution detection if it's a user message
      if (input.message.type === MessageType.HUMAN_MESSAGE) {
        await orchestratorService.detectResolution(
          input.conversationId,
          ctx.organizationId!,
          input.message.content
        );
      }

      return message;
    }),

  invoke: authenticatedProcedure
    .input(invokeSchema)
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationService.getConversation(
        input.conversationId,
        ctx.organizationId!
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
        input.messages as HayInputMessage[]
      );

      return response;
    }),

  invokeWithHistory: authenticatedProcedure
    .input(invokeSchema)
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationService.getConversation(
        input.conversationId,
        ctx.organizationId!
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
        input.messages as HayInputMessage[]
      );

      return response;
    }),

  sendMessage: authenticatedProcedure
    .input(sendMessageSchema)
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationService.getConversation(
        input.conversationId,
        ctx.organizationId!
      );

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      // Add the message
      const messageType = input.role === 'assistant' 
        ? MessageType.AI_MESSAGE 
        : MessageType.HUMAN_MESSAGE;
      
      const message = await conversationService.addMessage(
        input.conversationId,
        ctx.organizationId!,
        {
          content: input.content,
          type: messageType,
          sender: input.role || 'user'
        }
      );

      // Mark conversation as needing processing if it's a user message
      if (input.role === 'user' || !input.role) {
        // Set cooldown to 10 seconds from now
        // This allows the user to keep typing, and we'll process when they stop
        const cooldownUntil = new Date();
        cooldownUntil.setSeconds(cooldownUntil.getSeconds() + 10);
        
        await conversationService.updateConversation(
          input.conversationId,
          ctx.organizationId!,
          { 
            status: 'open',
            needs_processing: true,
            cooldown_until: cooldownUntil,
            last_user_message_at: new Date()
          }
        );
      }

      return message;
    }),
});
