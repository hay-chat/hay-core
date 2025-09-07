import { Conversation } from "@server/database/entities/conversation.entity";
import { Message, MessageType } from "@server/database/entities/message.entity";
import { LLMService } from "../services/orchestrator/llm.service";

export interface ExecutionResult {
  step: "ASK" | "RESPOND" | "CALL_TOOL" | "HANDOFF" | "CLOSE";
  userMessage?: string;
  tool?: {
    name: string;
    args: Record<string, any>;
  };
  handoff?: {
    reason: string;
    fields: Record<string, any>;
  };
  close?: {
    reason: string;
  };
  rationale?: string;
}

export class ExecutionLayer {
  private llmService: LLMService;
  private plannerSchema: any;

  constructor() {
    this.llmService = new LLMService();

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

  async execute(
    conversation: Conversation,
    messages: Message[]
  ): Promise<ExecutionResult | null> {
    try {
      // Create the prompt for generating a response
      const responsePrompt = `
        Please provide a helpful response or next step to the customer's last message that can be:
          ASK - To gather more information
          RESPOND - To provide a helpful response
          CALL_TOOL - To call a tool to get more information/Handle an action in the playbook. You can call tools iteratively if needed, you're going to get the response from the tool call in the next step and be asked to continue with the conversation or call another tool.
          HANDOFF - To handoff the conversation to a human agent
          CLOSE - To close the conversation`;

      const response = await this.llmService.invoke({
        history: this.prepareMessages(messages),
        prompt: responsePrompt,
        jsonSchema: this.plannerSchema,
      });

      const result = JSON.parse(response) as ExecutionResult;

      switch (result.step) {
        case "CALL_TOOL":
          // TODO: Call the tool
          return result;
        default:
          return result;
      }
    } catch (error) {
      console.error("[ExecutionLayer] Error generating response:", error);
      return {
        step: "RESPOND",
        userMessage:
          "I apologize, but I encountered an error while processing your request. Please try again.",
      };
    }
  }

  private prepareMessages(messages: Message[]): string {
    return messages
      .map((msg) => {
        const typeToRole = {
          [MessageType.CUSTOMER]: "user",
          [MessageType.BOT_AGENT]: "assistant",
          [MessageType.SYSTEM]: "system",
          [MessageType.HUMAN_AGENT]: "assistant",
          [MessageType.TOOL_CALL]: "assistant",
          [MessageType.TOOL_RESPONSE]: "system",
        };
        return {
          role: typeToRole[msg.type],
          content: msg.content,
        };
      })
      .join("\n");
  }
}
