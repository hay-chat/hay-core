import { MessageRepository } from "@server/repositories/message.repository";
import { Message, MessageType } from "@server/database/entities/message.entity";
import { Conversation } from "@server/database/entities/conversation.entity";
import { Agent } from "@server/database/entities/agent.entity";
import { Organization } from "@server/entities/organization.entity";
import { DeliveryState } from "@server/types/message-feedback.types";
import type { ToolCall } from "@server/orchestrator/types";

export class MessageService {
  private messageRepository: MessageRepository;

  constructor() {
    this.messageRepository = new MessageRepository();
  }

  async saveSystemMessage(
    conversation: Conversation,
    systemMessage: Partial<Message>,
  ): Promise<Message> {
    return await this.messageRepository.create({
      conversation_id: conversation.id,
      content: systemMessage.content!,
      type: MessageType.SYSTEM,
      sender: "system",
      metadata: systemMessage.metadata || {},
      usage_metadata: null,
    });
  }

  async saveToolMessage(
    conversation: Conversation,
    toolCall: ToolCall,
    toolResult: unknown,
    success: boolean = true,
    latencyMs: number = 0,
  ): Promise<Message> {
    const content = success
      ? `Tool "${toolCall.name}" executed successfully`
      : `Tool "${toolCall.name}" failed`;

    return await this.messageRepository.create({
      conversation_id: conversation.id,
      content,
      type: MessageType.TOOL_RESPONSE,
      sender: "system",
      metadata: {
        latency_ms: latencyMs,
        ...(toolResult as Record<string, unknown>),
      } as Record<string, unknown>,
      usage_metadata: null,
    });
  }

  async saveAssistantMessage(
    conversation: Conversation,
    content: string,
    metadata: Record<string, unknown> = {},
    usageMetadata: Record<string, unknown> | null = null,
  ): Promise<Message> {
    return await this.messageRepository.create({
      conversation_id: conversation.id,
      content,
      type: MessageType.BOT_AGENT,
      sender: "assistant",
      metadata,
      usage_metadata: usageMetadata,
    });
  }

  async saveMessage(conversation: Conversation, message: Message): Promise<Message> {
    return await this.messageRepository.create({
      conversation_id: conversation.id,
      content: message.content,
      type: message.type,
      sender: message.sender || "assistant",
      metadata: message.metadata,
      usage_metadata: message.usage_metadata,
    });
  }

  createAssistantResponse(
    content: string,
    metadata: Record<string, unknown> = {},
    usageMetadata: Record<string, unknown> | null = null,
  ): Partial<Message> {
    return {
      content,
      type: MessageType.BOT_AGENT,
      sender: "assistant",
      metadata,
      usage_metadata: usageMetadata,
    };
  }

  createToolCallResponse(
    toolCall: ToolCall,
    metadata: Record<string, unknown> = {},
  ): Partial<Message> {
    return {
      content: JSON.stringify(toolCall),
      type: MessageType.TOOL_CALL,
      sender: "assistant",
      metadata: {
        ...metadata,
      } as Record<string, unknown>,
      usage_metadata: null,
    };
  }

  createSystemMessage(content: string, metadata: Record<string, unknown> = {}): Partial<Message> {
    return {
      content,
      type: MessageType.SYSTEM,
      sender: "system",
      metadata,
      usage_metadata: null,
    };
  }

  getLastHumanMessage(conversation: Conversation): Message | undefined {
    return conversation.messages
      .filter((message) => message.type === MessageType.CUSTOMER)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];
  }

  getAllHumanMessages(conversation: Conversation): Message[] {
    return conversation.messages
      .filter((message) => message.type === MessageType.CUSTOMER)
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
  }

  /**
   * Determine if a message needs approval based on test mode and source
   */
  shouldRequireApproval(
    sourceId: string,
    agent: Agent | null,
    organization: Organization
  ): boolean {
    // Playground always bypasses approval
    if (sourceId === "playground") {
      return false;
    }

    // Get effective test mode: agent override → org default → false
    const testMode = agent?.testMode ?? organization.settings?.testModeDefault ?? false;

    return testMode;
  }

  /**
   * Get delivery state for a new message
   */
  getDeliveryState(reviewRequired: boolean): DeliveryState {
    return reviewRequired ? DeliveryState.QUEUED : DeliveryState.SENT;
  }

  /**
   * Create assistant message with test mode logic
   */
  async createAssistantMessageWithTestMode(
    conversation: Conversation,
    content: string,
    sourceId: string = "webchat",
    agent: Agent | null,
    organization: Organization,
    metadata: Record<string, unknown> = {},
    usageMetadata: Record<string, unknown> | null = null
  ): Promise<Message> {
    const reviewRequired = this.shouldRequireApproval(sourceId, agent, organization);
    const deliveryState = this.getDeliveryState(reviewRequired);

    return await this.messageRepository.create({
      conversation_id: conversation.id,
      content,
      type: MessageType.BOT_AGENT,
      sender: "assistant",
      sourceId: sourceId,
      reviewRequired: reviewRequired,
      deliveryState: deliveryState,
      metadata,
      usage_metadata: usageMetadata,
    });
  }
}
