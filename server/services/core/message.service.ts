import { MessageRepository } from "@server/repositories/message.repository";
import { Message, MessageType } from "@server/database/entities/message.entity";
import { Conversation } from "@server/database/entities/conversation.entity";

export class MessageService {
  public messageRepository: MessageRepository;

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
}
