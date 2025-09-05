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
import { conversationListInputSchema } from "@server/types/entity-list-inputs";
import { createListProcedure } from "@server/trpc/procedures/list";
import { ConversationRepository } from "@server/repositories/conversation.repository";
import { config } from "../../../config/env";

/**
 * Initializes a conversation with system messages and optional welcome message
 * @param conversationId - The conversation ID to initialize
 * @param organizationId - The organization ID
 * @param customerId - Optional customer ID, if present, only system init is performed
 * @param agentId - Optional agent ID to include agent-specific instructions
 */
async function initializeConversation(
  conversationId: string, 
  organizationId: string, 
  customerId?: string,
  agentId?: string
): Promise<void> {
  // Always set up system configuration first
  await setupSystemMessages(conversationId, organizationId, agentId);

  // Only send welcome message if there's no customer context (new conversation)
  if (!customerId) {
    await sendWelcomeMessage(conversationId, organizationId);
  }
}

/**
 * Sets up initial system messages for conversation context
 */
async function setupSystemMessages(
  conversationId: string, 
  organizationId: string,
  agentId?: string
): Promise<void> {
  console.log(`[setupSystemMessages] Setting up system message for conversation ${conversationId}`);
  console.log(`[setupSystemMessages] Organization: ${organizationId}`);
  console.log(`[setupSystemMessages] Agent ID provided: ${agentId || 'NONE'}`);
  
  let effectiveAgentId = agentId;
  
  // If no agent is provided, try to determine one based on the last user message
  if (!agentId) {
    console.log(`[setupSystemMessages] No agent provided, attempting to attribute based on triggers`);
    
    try {
      // Get the last user message to analyze for agent attribution
      const messages = await conversationService.getMessages(conversationId);
      const lastUserMessage = messages
        .filter(m => m.type === MessageType.CUSTOMER)
        .slice(-1)[0];

      if (lastUserMessage) {
        console.log(`[setupSystemMessages] Analyzing message for agent attribution: "${lastUserMessage.content.substring(0, 100)}..."`);
        
        // Use perception layer to analyze and suggest an agent
        const { PerceptionLayer } = await import('../../../orchestrator/perception.layer');
        const perceptionLayer = new PerceptionLayer();
        const perception = await perceptionLayer.perceive(lastUserMessage, organizationId);
        
        if (perception.suggestedAgent && perception.suggestedAgent.score > 0.7) {
          effectiveAgentId = perception.suggestedAgent.id;
          console.log(`[setupSystemMessages] Agent attributed based on triggers: ${effectiveAgentId} (score: ${perception.suggestedAgent.score})`);
        } else {
          console.log(`[setupSystemMessages] No suitable agent found or score too low`);
        }
      }
    } catch (error) {
      console.error(`[setupSystemMessages] Error during agent attribution:`, error);
    }
  }
  
  // Get agent configuration if we have one (either provided or attributed)
  let agent = null;
  if (effectiveAgentId) {
    console.log(`[setupSystemMessages] Fetching agent data for ID: ${effectiveAgentId}`);
    agent = await agentService.getAgent(organizationId, effectiveAgentId);
    console.log(`[setupSystemMessages] Agent found:`, agent ? {
      id: agent.id,
      name: agent.name,
      hasInstructions: !!agent.instructions,
      hasTone: !!agent.tone,
      hasAvoid: !!agent.avoid
    } : 'NULL');
  }

  // Build system message content
  let systemContent = `You are a helpful AI assistant. You should provide accurate, helpful responses based on available context and documentation. Always be professional and courteous.

Key behaviors:
- Use available documentation and context to provide accurate answers
- If you don't know something, clearly state that
- Follow any active playbook instructions when provided
- Be concise but thorough in your responses
- Maintain conversation context throughout the interaction`;

  // Add agent-specific instructions
  if (agent?.instructions) {
    systemContent += `\n\nAgent Instructions:\n${agent.instructions}`;
  }

  // Add tone guidelines
  if (agent?.tone) {
    systemContent += `\n\nTone Guidelines:\n${agent.tone}`;
  }

  // Add things to avoid
  if (agent?.avoid) {
    systemContent += `\n\nThings to Avoid:\n${agent.avoid}`;
  }

  // Create base system message for conversation initialization
  const baseSystemMessage = {
    content: systemContent,
    type: MessageType.SYSTEM,
    sender: "system" as const,
    metadata: {
      path: "initialization",
      agent_id: effectiveAgentId || null,
      agent_attribution: effectiveAgentId !== agentId ? "trigger-based" : "provided",
      confidence: 1.0
    }
  };

  console.log(`[setupSystemMessages] Final system message content (${systemContent.length} chars):`);
  console.log(`[setupSystemMessages] Preview: "${systemContent.substring(0, 200)}..."`);

  // Add the base system message
  await conversationService.addMessage(
    conversationId,
    organizationId,
    baseSystemMessage
  );
}

/**
 * Sends welcome message using active welcome playbook or fallback
 */
async function sendWelcomeMessage(
  conversationId: string, 
  organizationId: string
): Promise<void> {
  // Get welcome playbook or use fallback
  const welcomePlaybook = await playbookService.getActivePlaybook(
    "welcome",
    organizationId
  );
  
  const welcomeMessage = welcomePlaybook?.prompt_template || "Hello! How can I help you today?";

  await conversationService.addMessage(
    conversationId,
    organizationId,
    {
      content: welcomeMessage,
      type: MessageType.BOT_AGENT,
      sender: "assistant",
    }
  );
}

const conversationService = new ConversationService();
const playbookService = new PlaybookService();
const agentService = new AgentService();
const vectorStoreService = new VectorStoreService();
const conversationRepository = new ConversationRepository();
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
  status: z
    .enum(["open", "processing", "pending-human", "resolved", "closed"])
    .optional(),
  customer_id: z.string().uuid().optional(),
});

const updateConversationSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  status: z
    .enum(["open", "processing", "pending-human", "resolved", "closed"])
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
  list: createListProcedure(
    conversationListInputSchema,
    conversationRepository
  ),

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

      // Initialize conversation with system setup and conditional welcome message
      await initializeConversation(conversation.id, ctx.organizationId!, input.customer_id, input.agentId);

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

      // Generate title when conversation is closed or resolved
      if (input.data.status === "closed" || input.data.status === "resolved") {
        await orchestratorService.generateConversationTitle(
          input.id,
          ctx.organizationId!,
          false
        );
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
      if (input.message.type === MessageType.CUSTOMER) {
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
      const messageType =
        input.role === "assistant"
          ? MessageType.BOT_AGENT
          : MessageType.CUSTOMER;

      const message = await conversationService.addMessage(
        input.conversationId,
        ctx.organizationId!,
        {
          content: input.content,
          type: messageType,
          sender: input.role || "user",
        }
      );

      // Mark conversation as needing processing if it's a user message
      if (input.role === "user" || !input.role) {
        // Set cooldown based on configuration
        // This allows the user to keep typing, and we'll process when they stop
        const cooldownUntil = new Date();
        const cooldownSeconds = Math.floor(
          config.conversation.cooldownInterval / 1000
        );
        cooldownUntil.setSeconds(cooldownUntil.getSeconds() + cooldownSeconds);

        // console.log(`[Conversations] Setting cooldown for ${cooldownSeconds} seconds (until ${cooldownUntil.toISOString()})`);

        await conversationService.updateConversation(
          input.conversationId,
          ctx.organizationId!,
          {
            status: "open",
            // needs_processing: true,
            // cooldown_until: cooldownUntil,
            last_user_message_at: new Date(),
          }
        );
      }

      return message;
    }),
});
