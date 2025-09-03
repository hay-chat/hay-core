import { Conversation } from "@server/database/entities/conversation.entity";
import { Message } from "@server/database/entities/message.entity";
import { ConversationRepository } from "@server/repositories/conversation.repository";
import { ConversationContext } from "@server/orchestrator/types";
import { MessageService } from "./message.service";
import { v4 as uuidv4 } from "uuid";

export class ToolExecutionService {
  private conversationRepository: ConversationRepository;
  private messageService: MessageService;

  constructor() {
    this.conversationRepository = new ConversationRepository();
    this.messageService = new MessageService();
  }

  async handleToolExecution(
    conversation: Conversation, 
    toolMessage: Partial<Message>
  ): Promise<void> {
    try {
      const toolCall = (toolMessage.metadata as any)?.tool_call;
      if (!toolCall) {
        console.warn("Tool call message missing tool_call metadata");
        return;
      }

      console.log(`Executing tool: ${toolCall.tool_name} with args:`, toolCall.arguments);
      
      const currentContext = conversation.orchestration_status as ConversationContext | null;
      if (currentContext) {
        const toolLogEntry: {
          turn: number;
          name: string;
          input: any;
          ok: boolean;
          result?: any;
          errorClass?: string;
          latencyMs: number;
          idempotencyKey: string;
        } = {
          turn: currentContext.lastTurn + 1,
          name: toolCall.tool_name,
          input: toolCall.arguments,
          ok: false,
          latencyMs: 0,
          idempotencyKey: uuidv4()
        };

        const startTime = Date.now();
        try {
          const result = await this.executeToolCall(toolCall);
          
          toolLogEntry.ok = true;
          toolLogEntry.result = result;
          toolLogEntry.latencyMs = Date.now() - startTime;

          await this.messageService.saveToolMessage(
            conversation,
            toolCall,
            result,
            true,
            toolLogEntry.latencyMs
          );
        } catch (error: unknown) {
          const err = error as Error;
          toolLogEntry.ok = false;
          toolLogEntry.errorClass = err.constructor.name;
          toolLogEntry.result = err.message || 'Unknown error';
          toolLogEntry.latencyMs = Date.now() - startTime;

          await this.messageService.saveToolMessage(
            conversation,
            toolCall,
            { error: err.message },
            false,
            toolLogEntry.latencyMs
          );
        }

        currentContext.toolLog.push(toolLogEntry);
        await this.conversationRepository.updateById(conversation.id, {
          orchestration_status: currentContext
        });
      }
    } catch (error) {
      console.error("Error handling tool execution:", error);
    }
  }

  private async executeToolCall(toolCall: any): Promise<any> {
    console.log(`Tool execution for ${toolCall.tool_name} would be implemented here`);
    return { success: true, message: "Tool executed successfully (placeholder)" };
  }
}