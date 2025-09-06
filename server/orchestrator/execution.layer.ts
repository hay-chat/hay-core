import { Conversation } from "@server/database/entities/conversation.entity";
import { Message } from "@server/database/entities/message.entity";
import { LLMService } from "../services/orchestrator/llm.service";

export interface ExecutionResult {
  content: string;
  metadata?: Record<string, unknown>;
}

export class ExecutionLayer {
  private llmService: LLMService;

  constructor() {
    // console.log("ExecutionLayer initialized");
    this.llmService = new LLMService();
  }

  async execute(
    conversation: Conversation,
    messages: Message[]
  ): Promise<ExecutionResult | null> {
    try {
      // Get recent messages for context
      const recentMessages = messages.slice(-10);

      // Prepare conversation history for the LLM
      const conversationHistory = recentMessages
        .map((msg) => `${msg.type}: ${msg.content}`)
        .join("\n");

      // Get agent instructions if available
      let instructions = "You are a helpful customer service assistant.";
      if (conversation.agent_id && conversation.agent) {
        instructions = conversation.agent.instructions || instructions;
      }

      // Create the prompt for generating a response
      const responsePrompt = `${instructions}

        Conversation history:
        ${conversationHistory}

        Please provide a helpful response to the customer's last message. Be professional, empathetic, and focused on solving their problem.`;

      const response = await this.llmService.invoke({
        prompt: responsePrompt,
      });

      console.log(
        "[ExecutionLayer] Generated response:",
        response.substring(0, 100) + "..."
      );

      return {
        content: response,
        metadata: {
          model: "gpt-4o",
          path: conversation.playbook_id ? "playbook" : "direct",
          agent_id: conversation.agent_id,
          playbook_id: conversation.playbook_id,
        },
      };
    } catch (error) {
      console.error("[ExecutionLayer] Error generating response:", error);
      return {
        content:
          "I apologize, but I encountered an error while processing your request. Please try again.",
        metadata: {
          error: true,
          error_message:
            error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }
}
