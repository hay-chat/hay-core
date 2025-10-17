import { LLMService } from "../services/core/llm.service";
import { Conversation } from "@server/database/entities/conversation.entity";
import { PromptService } from "../services/prompt.service";
import { debugLog } from "@server/lib/debug-logger";

export interface ExecutionResult {
  step: "ASK" | "RESPOND" | "CALL_TOOL" | "HANDOFF" | "CLOSE";
  userMessage?: string;
  tool?: {
    name: string;
    args: Record<string, unknown>;
  };
  handoff?: {
    reason: string;
    fields: Record<string, unknown>;
  };
  close?: {
    reason: string;
  };
  rationale?: string;
}

export class ExecutionLayer {
  private llmService: LLMService;
  private promptService: PromptService;
  private plannerSchema: object;

  constructor() {
    this.llmService = new LLMService();
    this.promptService = PromptService.getInstance();
    debugLog("execution", "ExecutionLayer initialized");

    this.plannerSchema = {
      type: "object",
      properties: {
        step: {
          type: "string",
          enum: ["ASK", "RESPOND", "CALL_TOOL", "HANDOFF", "CLOSE"],
        },
        userMessage: {
          type: "string",
          description: "Message to send to user",
        },
        tool: {
          type: "object",
          properties: {
            name: { type: "string" },
            args: { type: "object" },
          },
          description: "Tool to call (for CALL_TOOL step)",
        },
        handoff: {
          type: "object",
          properties: {
            reason: { type: "string" },
            fields: { type: "object" },
          },
          description: "Handoff details (for HANDOFF step)",
        },
        close: {
          type: "object",
          properties: {
            reason: { type: "string" },
          },
          description: "Close reason (for CLOSE step)",
        },
        rationale: {
          type: "string",
          description: "Explanation of why this step was chosen",
        },
      },
      required: ["step", "rationale"],
    };
  }

  async execute(conversation: Conversation, customerLanguage?: string): Promise<ExecutionResult | null> {
    try {
      debugLog("execution", "Starting execution for conversation", {
        conversationId: conversation.id,
        organizationId: conversation.organization_id,
        agentId: conversation.agent_id,
        playbookId: conversation.playbook_id,
        enabledTools: conversation.enabled_tools,
        customerLanguage,
      });

      const messages = await conversation.getMessages();

      debugLog("execution", "Retrieved conversation messages", {
        messagesCount: messages.length,
        messageTypes: messages.map((m) => m.type),
      });

      // Get the prompt from PromptService
      const responsePrompt = await this.promptService.getPrompt(
        "execution/planner",
        {
          hasTools: conversation.enabled_tools && conversation.enabled_tools.length > 0,
          tools: conversation.enabled_tools?.join(", "),
        },
        { conversationId: conversation.id, organizationId: conversation.organization_id },
      );

      // Inject explicit language instruction if customer language is detected
      let finalPrompt = responsePrompt;
      if (customerLanguage) {
        const languageNames: Record<string, string> = {
          en: "English",
          pt: "Portuguese",
          es: "Spanish",
          de: "German",
          fr: "French",
          it: "Italian",
          nl: "Dutch",
          pl: "Polish",
          ru: "Russian",
          ja: "Japanese",
          zh: "Chinese",
          ko: "Korean",
          ar: "Arabic",
          hi: "Hindi",
        };
        const languageName = languageNames[customerLanguage] || customerLanguage.toUpperCase();
        const languageInstruction = `\n\nIMPORTANT LANGUAGE REQUIREMENT: The customer is communicating in ${languageName}. You MUST respond ONLY in ${languageName}, regardless of the language used in the prompts, instructions, or system messages. This is a critical requirement that overrides all other language-related instructions.`;
        finalPrompt = responsePrompt + languageInstruction;

        debugLog("execution", "Injected language enforcement instruction", {
          customerLanguage,
          languageName,
        });
      }

      debugLog("execution", "Retrieved execution planner prompt", {
        promptLength: finalPrompt.length,
        hasTools: conversation.enabled_tools && conversation.enabled_tools.length > 0,
        tools: conversation.enabled_tools,
      });

      debugLog("execution", "Invoking LLM for execution planning");

      const response = await this.llmService.invoke({
        history: messages, // Pass Message[] directly instead of converting to string
        prompt: finalPrompt,
        jsonSchema: this.plannerSchema,
      });

      const result = JSON.parse(response) as ExecutionResult;

      debugLog("execution", "Execution planning complete", {
        step: result.step,
        hasUserMessage: !!result.userMessage,
        userMessagePreview: result.userMessage?.substring(0, 100),
        hasTool: !!result.tool,
        toolName: result.tool?.name,
        hasHandoff: !!result.handoff,
        hasClose: !!result.close,
        rationale: result.rationale,
      });

      return result;
    } catch (error) {
      debugLog("execution", "Error in execution layer", {
        level: "error",
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      console.error("[ExecutionLayer] Error generating response:", error);
      return {
        step: "RESPOND",
        userMessage:
          "I apologize, but I encountered an error while processing your request. Please try again.",
      };
    }
  }
}
