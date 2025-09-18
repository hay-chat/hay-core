import { ConversationRepository } from "../repositories/conversation.repository";
import { MessageRepository } from "../repositories/message.repository";
import { CustomerService } from "./customer.service";
import { Conversation } from "../database/entities/conversation.entity";
import { Message, MessageType } from "../database/entities/message.entity";
import { getUTCNow } from "../utils/date.utils";

export class ConversationService {
  private conversationRepository: ConversationRepository;
  private messageRepository: MessageRepository;
  private customerService: CustomerService;

  constructor() {
    this.conversationRepository = new ConversationRepository();
    this.messageRepository = new MessageRepository();
    this.customerService = new CustomerService();
  }

  async createConversation(
    organizationId: string,
    data: {
      title?: string;
      agentId?: string | null;
      playbook_id?: string | null;
      metadata?: Record<string, any>;
      status?: "open" | "processing" | "pending-human" | "resolved" | "closed";
      customer_id?: string | null;
    },
  ): Promise<Conversation> {
    // If no customer_id is provided, create an anonymous customer
    let customerId = data.customer_id;
    if (!customerId) {
      const anonymousCustomer = await this.customerService.createAnonymousCustomer(organizationId);
      customerId = anonymousCustomer.id;
    }

    return await this.conversationRepository.create({
      title: data.title || "New Conversation",
      agent_id: data.agentId || null,
      playbook_id: data.playbook_id || null,
      organization_id: organizationId,
      status: data.status || "open",
      context: {},
      metadata: data.metadata || {},
      needs_processing: data.status === "open" || data.status === "processing",
      customer_id: customerId,
    });
  }

  async getConversations(organizationId: string): Promise<Conversation[]> {
    return await this.conversationRepository.findByOrganization(organizationId);
  }

  async getConversationsByAgent(organizationId: string, agentId: string): Promise<Conversation[]> {
    return await this.conversationRepository.findByAgent(agentId, organizationId);
  }

  async getConversation(
    conversationId: string,
    organizationId: string,
  ): Promise<Conversation | null> {
    const conversation = await this.conversationRepository.findById(conversationId);
    if (!conversation || conversation.organization_id !== organizationId) {
      return null;
    }
    return conversation;
  }

  async updateConversation(
    conversationId: string,
    organizationId: string,
    data: {
      title?: string;
      status?: "open" | "processing" | "pending-human" | "resolved" | "closed";
      needs_processing?: boolean;
      last_processed_at?: Date | null;
      agent_id?: string | null;
      cooldown_until?: Date | null;
      processing_locked_until?: Date | null;
      processing_locked_by?: string | null;
      ended_at?: Date;
      closed_at?: Date | null;
      context?: Record<string, any>;
      resolution_metadata?: {
        resolved: boolean;
        confidence: number;
        reason: string;
      };
      playbook_id?: string | null;
      orchestration_status?: Record<string, any> | null;
    },
  ): Promise<Conversation | null> {
    // Automatically set closed_at when status changes to closed or resolved
    const updateData = { ...data };
    if (data.status === "closed" || data.status === "resolved") {
      updateData.closed_at = getUTCNow();
    }
    return await this.conversationRepository.update(conversationId, organizationId, updateData);
  }

  async deleteConversation(organizationId: string, conversationId: string): Promise<boolean> {
    return await this.conversationRepository.delete(conversationId, organizationId);
  }

  async addMessage(
    conversationId: string,
    organizationId: string,
    data: {
      content: string;
      type: MessageType;
      sender?: string;
      usage_metadata?: Record<string, any>;
      metadata?: Record<string, any>;
    },
  ): Promise<Message> {
    return await this.messageRepository.create({
      conversation_id: conversationId,
      content: data.content,
      type: data.type,
      sender: data.sender || null,
      usage_metadata: data.usage_metadata || null,
      metadata: data.metadata || null,
    });
  }

  async addMessages(
    conversationId: string,
    messages: Array<{
      content: string;
      type: MessageType;
      usage_metadata?: Record<string, any>;
    }>,
  ): Promise<Message[]> {
    const messagesToCreate = messages.map((msg) => ({
      conversation_id: conversationId,
      content: msg.content,
      type: msg.type,
      usage_metadata: msg.usage_metadata || null,
    }));

    return await this.messageRepository.createBulk(messagesToCreate);
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    return await this.messageRepository.findByConversation(conversationId);
  }

  async getLastMessages(
    conversationId: string,
    organizationId: string,
    limit: number = 10,
  ): Promise<Message[]> {
    const messages = await this.messageRepository.getLastMessages(conversationId, limit);
    return messages.reverse();
  }

  async getDailyConversationStats(
    organizationId: string,
    days: number = 30,
    startDate?: Date,
    endDate?: Date,
  ): Promise<Array<{ date: string; count: number; label: string }>> {
    return await this.conversationRepository.getDailyStats(
      organizationId,
      days,
      startDate,
      endDate,
    );
  }
}
