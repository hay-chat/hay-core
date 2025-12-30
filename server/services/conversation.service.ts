import { ConversationRepository } from "../repositories/conversation.repository";
import { MessageRepository } from "../repositories/message.repository";
import { CustomerService } from "./customer.service";
import { Conversation } from "../database/entities/conversation.entity";
import { Message, MessageType } from "../database/entities/message.entity";
import { getUTCNow } from "../utils/date.utils";
import { hookManager } from "./hooks/hook-manager";

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
      metadata?: Record<string, unknown>;
      status?: "open" | "processing" | "pending-human" | "human-took-over" | "resolved" | "closed";
      customer_id?: string | null;
      language?: string | null;
    },
  ): Promise<Conversation> {
    // If no customer_id is provided, create an anonymous customer
    let customerId = data.customer_id;
    if (!customerId) {
      const anonymousCustomer = await this.customerService.createAnonymousCustomer(organizationId);
      customerId = anonymousCustomer.id;
    }

    // Determine agent_id: use provided, or fall back to organization's default agent, or first agent
    let agentId = data.agentId || null;
    if (!agentId) {
      const { organizationRepository } = await import("../repositories/organization.repository");
      const org = await organizationRepository.findById(organizationId);
      if (org?.defaultAgentId) {
        agentId = org.defaultAgentId;
      } else {
        // Fallback to first agent if no default is set
        const { agentRepository } = await import("../repositories/agent.repository");
        const agents = await agentRepository.findByOrganization(organizationId);
        if (agents && agents.length > 0) {
          agentId = agents[0].id;
        }
      }
    }

    const conversation = await this.conversationRepository.create({
      title: data.title || "",
      agent_id: agentId,
      playbook_id: data.playbook_id || null,
      organization_id: organizationId,
      status: data.status || "open",
      context: {},
      metadata: data.metadata || {},
      needs_processing: data.status === "open" || data.status === "processing",
      customer_id: customerId,
      language: data.language as any || null,
    });

    // Trigger hook for conversation created
    await hookManager.trigger("conversation.created", {
      organizationId,
      conversationId: conversation.id,
      metadata: {
        agentId,
        customerId,
        status: data.status || "open",
        language: data.language,
      },
    });

    return conversation;
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
      status?: "open" | "processing" | "pending-human" | "human-took-over" | "resolved" | "closed";
      needs_processing?: boolean;
      last_processed_at?: Date | null;
      agent_id?: string | null;
      cooldown_until?: Date | null;
      processing_locked_until?: Date | null;
      processing_locked_by?: string | null;
      ended_at?: Date;
      closed_at?: Date | null;
      context?: Record<string, unknown>;
      resolution_metadata?: {
        resolved: boolean;
        confidence: number;
        reason: string;
      };
      playbook_id?: string | null;
      orchestration_status?: Record<string, unknown> | null;
    },
  ): Promise<Conversation | null> {
    // Automatically set closed_at when status changes to closed or resolved
    const updateData = { ...data };
    if (data.status === "closed" || data.status === "resolved") {
      updateData.closed_at = getUTCNow();
    }

    const result = await this.conversationRepository.update(conversationId, organizationId, updateData);

    // Generate conversation title when status changes to pending-human
    if (data.status === "pending-human") {
      import("../orchestrator/conversation-utils").then(({ generateConversationTitle }) => {
        generateConversationTitle(conversationId, organizationId, false).catch((error) => {
          console.error("Error generating title for pending-human conversation:", error);
        });
      });
    }

    return result;
  }

  async deleteConversation(organizationId: string, conversationId: string): Promise<boolean> {
    // Get the conversation first to access message IDs for embedding cleanup
    const conversation = await this.conversationRepository.findById(conversationId);
    if (!conversation || conversation.organization_id !== organizationId) {
      return false;
    }

    // Delete embeddings linked to this conversation and its messages (GDPR compliance)
    // Embeddings are linked via metadata fields, not foreign keys, so they won't be
    // automatically deleted by database CASCADE
    const { vectorStoreService } = await import("./vector-store.service");
    if (vectorStoreService.initialized) {
      // Delete embeddings by conversation ID
      await vectorStoreService.deleteByConversationIds(organizationId, [conversationId]);

      // Delete embeddings by message IDs
      const messageIds = conversation.messages?.map((m) => m.id) || [];
      if (messageIds.length > 0) {
        await vectorStoreService.deleteByMessageIds(organizationId, messageIds);
      }
    }

    return await this.conversationRepository.delete(conversationId, organizationId);
  }

  async addMessage(
    conversationId: string,
    organizationId: string,
    data: {
      content: string;
      type: MessageType;
      sender?: string;
      usage_metadata?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    },
  ): Promise<Message> {
    const message = await this.messageRepository.create({
      conversation_id: conversationId,
      content: data.content,
      type: data.type,
      sender: data.sender || null,
      usage_metadata: data.usage_metadata || null,
      metadata: data.metadata || null,
    });

    // Trigger hook for message sent
    await hookManager.trigger("message.sent", {
      organizationId,
      conversationId,
      metadata: {
        messageId: message.id,
        messageType: data.type,
        sender: data.sender,
      },
    });

    return message;
  }

  async addMessages(
    conversationId: string,
    messages: Array<{
      content: string;
      type: MessageType;
      usage_metadata?: Record<string, unknown>;
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
