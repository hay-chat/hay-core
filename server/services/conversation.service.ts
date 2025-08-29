import { ConversationRepository } from "../repositories/conversation.repository";
import { MessageRepository } from "../repositories/message.repository";
import { Conversation } from "../database/entities/conversation.entity";
import { Message, MessageType } from "../database/entities/message.entity";

export class ConversationService {
  private conversationRepository: ConversationRepository;
  private messageRepository: MessageRepository;

  constructor() {
    this.conversationRepository = new ConversationRepository();
    this.messageRepository = new MessageRepository();
  }

  async createConversation(organizationId: string, data: {
    title: string;
    agentId: string;
  }): Promise<Conversation> {
    return await this.conversationRepository.create({
      title: data.title,
      agent_id: data.agentId,
      organization_id: organizationId
    });
  }

  async getConversations(organizationId: string): Promise<Conversation[]> {
    return await this.conversationRepository.findByOrganization(organizationId);
  }

  async getConversationsByAgent(organizationId: string, agentId: string): Promise<Conversation[]> {
    return await this.conversationRepository.findByAgent(agentId, organizationId);
  }

  async getConversation(organizationId: string, conversationId: string): Promise<Conversation | null> {
    return await this.conversationRepository.findById(conversationId, organizationId);
  }

  async updateConversation(
    organizationId: string,
    conversationId: string,
    data: {
      title?: string;
    }
  ): Promise<Conversation | null> {
    return await this.conversationRepository.update(conversationId, organizationId, data);
  }

  async deleteConversation(organizationId: string, conversationId: string): Promise<boolean> {
    return await this.conversationRepository.delete(conversationId, organizationId);
  }

  async addMessage(conversationId: string, data: {
    content: string;
    type: MessageType;
    usage_metadata?: Record<string, any>;
  }): Promise<Message> {
    return await this.messageRepository.create({
      conversation_id: conversationId,
      content: data.content,
      type: data.type,
      usage_metadata: data.usage_metadata || null
    });
  }

  async addMessages(conversationId: string, messages: Array<{
    content: string;
    type: MessageType;
    usage_metadata?: Record<string, any>;
  }>): Promise<Message[]> {
    const messagesToCreate = messages.map(msg => ({
      conversation_id: conversationId,
      content: msg.content,
      type: msg.type,
      usage_metadata: msg.usage_metadata || null
    }));
    
    return await this.messageRepository.createBulk(messagesToCreate);
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    return await this.messageRepository.findByConversation(conversationId);
  }

  async getLastMessages(conversationId: string, limit: number = 10): Promise<Message[]> {
    const messages = await this.messageRepository.getLastMessages(conversationId, limit);
    return messages.reverse();
  }
}