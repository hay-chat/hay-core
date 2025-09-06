import { Conversation } from "@server/database/entities/conversation.entity";
import { Message } from "@server/database/entities/message.entity";
import { LLMService } from "@server/services/orchestrator/llm.service";
import { MessageService } from "@server/services/orchestrator/message.service";
import { ConversationManagement } from "@server/services/orchestrator/conversation-management";
import { ConversationService } from "@server/services/conversation.service";
import { StatusManager } from "@server/services/orchestrator/status-manager";
import { ToolExecutionService } from "@server/services/orchestrator/tool-execution.service";
import { PlannerOutput, ToolCall, Perception } from "./types";

export class ExecutionLayer {
  private llmService: LLMService;
  private messageService: MessageService;
  private conversationManagement: ConversationManagement;
  private statusManager: StatusManager;
  private toolExecutionService: ToolExecutionService;

  constructor() {
    console.log("ExecutionLayer initialized");
    this.llmService = new LLMService();
    this.messageService = new MessageService();

    const conversationService = new ConversationService();
    this.conversationManagement = new ConversationManagement(
      conversationService
    );
    this.statusManager = new StatusManager(conversationService);
    this.toolExecutionService = new ToolExecutionService();
  }

  async execute(
    conversation: Conversation,
    context: {
      perception?: Perception;
      retrieval?: {
        rag: any;
        playbookAction: string;
        selectedPlaybook?: any;
        systemMessages: Partial<Message>[];
      };
    }
  ): Promise<Partial<Message> | null> {
    try {
      const plannerOutput = await this.generatePlannerOutput(
        conversation,
        context
      );

      // Debug the plannerOutput right before the switch
      console.log("=== EXECUTION SWITCH DEBUG ===");
      console.log(`plannerOutput type: ${typeof plannerOutput}`);
      console.log(`plannerOutput:`, JSON.stringify(plannerOutput, null, 2));
      console.log(`plannerOutput.step: "${plannerOutput.step}" (type: ${typeof plannerOutput.step})`);
      console.log(`Valid steps: ASK, RESPOND, CALL_TOOL, HANDOFF, CLOSE`);
      
      if (plannerOutput.step === undefined || plannerOutput.step === null) {
        console.error("❌ CRITICAL: plannerOutput.step is null/undefined!");
        console.error("This indicates the LLM didn't return a valid step or parsing failed");
        console.error("Full plannerOutput:", plannerOutput);
      }
      console.log("=== END EXECUTION SWITCH DEBUG ===");

      switch (plannerOutput.step) {
        case "ASK":
          return await this.handleAsk(plannerOutput);

        case "RESPOND":
          return await this.handleRespond(plannerOutput);

        case "CALL_TOOL":
          return await this.handleToolCall(plannerOutput, conversation);

        case "HANDOFF":
          return await this.handleHandoff(plannerOutput, conversation);

        case "CLOSE":
          return await this.handleClose(plannerOutput, conversation);

        default:
          throw new Error(`Unknown step: ${plannerOutput.step}`);
      }
    } catch (error: unknown) {
      const err = error as Error;
      console.error("Error in execution layer:", error);
      return this.messageService.createAssistantResponse(
        "I apologize, but I encountered an error while processing your request. Please try again.",
        { error: true, error_message: err.message }
      );
    }
  }

  private async generatePlannerOutput(
    conversation: Conversation,
    context: {
      perception?: Perception;
      retrieval?: {
        rag: any;
        playbookAction: string;
        selectedPlaybook?: any;
        systemMessages: Partial<Message>[];
      };
    }
  ): Promise<PlannerOutput> {
    console.log("=== EXECUTION LAYER DEBUG INFO ===");
    console.log(`Conversation ID: ${conversation.id}`);
    console.log(`Organization ID: ${conversation.organization_id}`);
    console.log(`Total messages in conversation: ${conversation.messages?.length || 0}`);
    
    // Log context information
    console.log(`\n--- CONTEXT DEBUG ---`);
    console.log(`Has perception: ${!!context.perception}`);
    console.log(`Has retrieval: ${!!context.retrieval}`);
    
    if (context.retrieval) {
      console.log(`Playbook action: ${context.retrieval.playbookAction}`);
      console.log(`Has selected playbook: ${!!context.retrieval.selectedPlaybook}`);
      console.log(`System messages count: ${context.retrieval.systemMessages?.length || 0}`);
      console.log(`Has RAG results: ${!!context.retrieval.rag}`);
      
      if (context.retrieval.rag?.results) {
        console.log(`RAG results count: ${context.retrieval.rag.results.length}`);
      }
    }
    
    // Log message types and distribution
    const allMessages = conversation.messages as Message[] || [];
    const messagesByType = allMessages.reduce((acc, msg) => {
      acc[msg.type] = (acc[msg.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log(`Message types distribution:`, messagesByType);
    
    const plannerSchema = {
      type: "object",
      properties: {
        step: {
          type: "string",
          enum: ["ASK", "RESPOND", "CALL_TOOL", "HANDOFF", "CLOSE"],
        },
        userMessage: {
          type: "string",
          description: "Message to send to user (for ASK or RESPOND steps)",
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

    console.log("=== CALLING LLM SERVICE FOR PLANNER OUTPUT ===");
    console.log("JSON Schema being sent to LLM:");
    console.log(JSON.stringify(plannerSchema, null, 2));
    console.log("=== CONVERSATION MESSAGES BEING SENT TO LLM ===");
    const conversationMessages = conversation.messages as Message[] || [];
    conversationMessages.forEach((msg, index) => {
      console.log(`Message ${index + 1}: ${msg.type} (${msg.content?.length || 0} chars)`);
      if (msg.type === 'System') {
        console.log(`   System message preview: "${(msg.content || '').substring(0, 100)}..."`);
      }
    });
    console.log("=== END CONVERSATION MESSAGES ===");
    
    const systemPrompt = `You are a customer service planning AI. Your job is to analyze the conversation and decide what step to take next.

Available steps:
- ASK: Ask the user for more information
- RESPOND: Provide a direct response to the user
- CALL_TOOL: Execute a tool to help the user
- HANDOFF: Transfer to a human agent
- CLOSE: Close the conversation

IMPORTANT: Always respond with valid JSON using this exact format:

For asking questions or responding:
{
  "step": "ASK",
  "userMessage": "Your question here",
  "rationale": "Why you chose this step"
}

For tool calls:
{
  "step": "CALL_TOOL", 
  "tool": {
    "name": "tool_name",
    "args": { "param1": "value1" }
  },
  "rationale": "Why you need to call this tool"
}

For handoffs:
{
  "step": "HANDOFF",
  "handoff": {
    "reason": "Why human help is needed"
  },
  "rationale": "Explanation"
}

For closing:
{
  "step": "CLOSE",
  "close": {
    "reason": "Why conversation is complete"  
  },
  "rationale": "Explanation"
}

Only use CALL_TOOL when you actually need to execute a specific tool. For simple questions or responses, use ASK or RESPOND.`;

    const result = await this.llmService.chat<PlannerOutput>({
      message: conversation.messages as Message[],
      jsonSchema: plannerSchema,
      systemPrompt,
    });
    
    console.log(`=== PLANNER OUTPUT RESULT ===`);
    console.log(`Raw result type: ${typeof result}`);
    console.log(`Raw result:`, JSON.stringify(result, null, 2));
    
    // Handle nested properties structure that OpenAI sometimes returns
    let parsedResult: any = result;
    
    // TODO: Fix TypeScript issue with nested properties handling
    // NOTE: Removed problematic nested structure handling code
    
    console.log(`Step chosen: ${parsedResult.step}`);
    console.log(`Step type: ${typeof parsedResult.step}`);
    console.log(`Rationale: ${parsedResult.rationale}`);
    
    // Validate the result structure
    if (parsedResult && typeof parsedResult === 'object') {
      console.log(`Result object keys:`, Object.keys(parsedResult));
      
      if (!parsedResult.step) {
        console.error("❌ CRITICAL: result.step is missing from LLM response!");
        console.error("Expected one of: ASK, RESPOND, CALL_TOOL, HANDOFF, CLOSE");
      }
      
      if (!parsedResult.rationale) {
        console.warn("⚠️  WARNING: result.rationale is missing");
      }
    } else {
      console.error("❌ CRITICAL: result is not an object or is null/undefined");
      console.error(`Result value:`, parsedResult);
    }
    
    console.log("=== END EXECUTION LAYER DEBUG INFO ===\n");
    
    return parsedResult;
  }

  private async handleAsk(
    plannerOutput: PlannerOutput
  ): Promise<Partial<Message>> {
    return this.messageService.createAssistantResponse(
      plannerOutput.userMessage ||
        "I need more information to help you better. Could you please provide more details?",
      {
        plan: "ASK",
        rationale: plannerOutput.rationale,
      }
    );
  }

  private async handleRespond(
    plannerOutput: PlannerOutput
  ): Promise<Partial<Message>> {
    return this.messageService.createAssistantResponse(
      plannerOutput.userMessage ||
        "I understand your request. Let me help you with that.",
      {
        plan: "RESPOND",
        rationale: plannerOutput.rationale,
      }
    );
  }

  private async handleToolCall(
    plannerOutput: PlannerOutput,
    conversation: Conversation
  ): Promise<Partial<Message> | null> {
    if (!plannerOutput.tool) {
      throw new Error("Tool call step requires tool specification");
    }

    const isValidToolCall = await this.validateToolCall(
      plannerOutput.tool,
      conversation
    );
    if (!isValidToolCall) {
      return this.messageService.createAssistantResponse(
        "I apologize, but I cannot execute that tool call due to invalid parameters.",
        {
          plan: "CALL_TOOL",
          error: "Invalid tool call",
          attempted_tool: plannerOutput.tool.name,
        }
      );
    }

    const toolCallJson = {
      tool_name: plannerOutput.tool.name,
      arguments: plannerOutput.tool.args,
    };

    // Create and save the TOOL_CALL message
    const toolCallMessage = this.messageService.createToolCallResponse(toolCallJson, {
      plan: "CALL_TOOL",
      rationale: plannerOutput.rationale,
      requires_execution: true,
      tool_call: toolCallJson,
    });
    
    // Save the tool call message to the conversation
    await this.messageService.saveMessage(conversation, toolCallMessage as Message);
    
    console.log(`[ExecutionLayer] Executing tool: ${plannerOutput.tool.name}`);
    
    // Actually execute the tool using ToolExecutionService
    console.log(`[ExecutionLayer] Calling tool execution service for: ${plannerOutput.tool.name}`);
    const toolExecutionResult = await this.toolExecutionService.handleToolExecution(conversation, toolCallMessage);
    
    if (toolExecutionResult.success) {
      console.log(`[ExecutionLayer] Tool executed successfully:`, toolExecutionResult.result);
      
      // Create system message with actual tool results
      const resultSummary = typeof toolExecutionResult.result === 'object' 
        ? JSON.stringify(toolExecutionResult.result, null, 2)
        : String(toolExecutionResult.result);
        
      const continuationMessage = this.messageService.createSystemMessage(
        `The tool "${plannerOutput.tool.name}" has been executed successfully. Tool result: ${resultSummary}. Please provide an appropriate response to the user based on this result.`
      );
      
      return continuationMessage;
    } else {
      console.error(`[ExecutionLayer] Tool execution failed:`, toolExecutionResult.error);
      
      // Return error message to user with specific error details
      return this.messageService.createAssistantResponse(
        `I apologize, but I encountered an error while executing that action: ${toolExecutionResult.error}. Please try again or let me know if you need further assistance.`,
        {
          plan: "CALL_TOOL",
          error: "Tool execution failed",
          attempted_tool: plannerOutput.tool.name,
          error_message: toolExecutionResult.error
        }
      );
    }
  }

  private async handleHandoff(
    plannerOutput: PlannerOutput,
    conversation: Conversation
  ): Promise<Partial<Message>> {
    await this.updateConversationStatus(conversation, "pending-human");

    return this.messageService.createAssistantResponse(
      "I'm transferring you to a human agent who can better assist you with this request.",
      {
        plan: "HANDOFF",
        rationale: plannerOutput.rationale,
        handoff_reason: plannerOutput.handoff?.reason,
        handoff_fields: plannerOutput.handoff?.fields,
      }
    );
  }

  private async handleClose(
    plannerOutput: PlannerOutput,
    conversation: Conversation
  ): Promise<Partial<Message>> {
    await this.updateConversationStatus(conversation, "closed");

    return this.messageService.createAssistantResponse(
      "Thank you for contacting us. This conversation is now closed. Feel free to start a new conversation if you need further assistance.",
      {
        plan: "CLOSE",
        rationale: plannerOutput.rationale,
        close_reason: plannerOutput.close?.reason,
      }
    );
  }

  private async validateToolCall(
    tool: ToolCall,
    _conversation: Conversation
  ): Promise<boolean> {
    try {
      if (!tool.name || !tool.args) {
        return false;
      }

      return true;
    } catch (error) {
      console.error("Error validating tool call:", error);
      return false;
    }
  }

  private async updateConversationStatus(
    conversation: Conversation,
    status: "pending-human" | "closed"
  ): Promise<void> {
    try {
      const conversationRepository = (
        await import("@server/repositories/conversation.repository")
      ).ConversationRepository;
      const repo = new conversationRepository();

      await repo.updateById(conversation.id, {
        status,
        ...(status === "closed" && {
          closed_at: new Date(),
          ended_at: new Date(),
        }),
      });
    } catch (error) {
      console.error("Error updating conversation status:", error);
    }
  }

  // Conversation management methods integrated into ExecutionLayer
  async loadConversation(conversationId: string): Promise<Conversation> {
    return await this.conversationManagement.loadConversation(conversationId);
  }

  async lockConversation(conversationId: string): Promise<void> {
    console.log(`[ExecutionLayer] Locking conversation ${conversationId}`);
    await this.conversationManagement.lockConversation(conversationId);
  }

  async unlockConversation(conversationId: string): Promise<void> {
    console.log(`[ExecutionLayer] Unlocking conversation ${conversationId}`);
    await this.conversationManagement.unlockConversation(conversationId);
  }

  getLastHumanMessage(conversation: Conversation): Message | undefined {
    return this.messageService.getLastHumanMessage(conversation);
  }

  getAllHumanMessages(conversation: Conversation): Message[] {
    return this.messageService.getAllHumanMessages(conversation);
  }

  async saveMessage(
    conversation: Conversation,
    message: Message
  ): Promise<Message> {
    return await this.messageService.saveMessage(conversation, message);
  }

  async saveSystemMessages(
    conversation: Conversation,
    systemMessages: Partial<Message>[]
  ): Promise<void> {
    console.log("=== SAVING SYSTEM MESSAGES DEBUG ===");
    console.log(`Number of system messages to save: ${systemMessages.length}`);
    
    for (const systemMessage of systemMessages) {
      console.log(`Saving system message: ${(systemMessage.content || '').length} chars`);
      console.log(`   Preview: "${(systemMessage.content || '').substring(0, 150)}..."`);
      await this.messageService.saveSystemMessage(conversation, systemMessage);
    }
    
    console.log(`Conversation messages count after saving: ${conversation.messages?.length || 0}`);
    console.log("=== END SAVING SYSTEM MESSAGES DEBUG ===");
  }

  async updateOrchestrationStatus(
    conversationId: string,
    organizationId: string,
    perception: any,
    retrieval: any
  ): Promise<void> {
    // The statusManager doesn't have an updateOrchestrationStatus method anymore,
    // so we'll call updateStatus directly with the orchestration data
    await this.statusManager.updateStatus(conversationId, organizationId, {
      state: "processing",
      intent_analysis: perception,
      documents_used:
        retrieval.rag?.results?.map((r: any) => ({
          document_id: r.docId || "unknown",
          title: r.title || "Document",
          content_preview: r.content ? r.content.substring(0, 200) + "..." : "",
          relevance_score: r.sim || 0,
        })) || [],
      current_playbook: retrieval.selectedPlaybook
        ? {
            id: retrieval.selectedPlaybook.id,
            title: retrieval.selectedPlaybook.title || "Unknown Playbook",
            trigger: retrieval.playbookAction,
            started_at: new Date().toISOString(),
          }
        : undefined,
    });
  }

  async handleToolExecution(
    conversation: Conversation,
    result: Partial<Message>
  ): Promise<void> {
    await this.toolExecutionService.handleToolExecution(conversation, result);
  }
}
