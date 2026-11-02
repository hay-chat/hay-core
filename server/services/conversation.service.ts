import { ConversationRepository } from "../repositories/conversation.repository";
import { MessageRepository } from "../repositories/message.repository";
import { CustomerService } from "./customer.service";
import { Conversation, type ConversationStatus } from "../database/entities/conversation.entity";
import { Message, MessageType } from "../database/entities/message.entity";
import { getUTCNow } from "../utils/date.utils";
import { hookManager } from "./hooks/hook-manager";
import { SupportedLanguage } from "../types/language.types";
import { createLogger } from "@server/lib/logger";
import { StorageService } from "./storage.service";

const logger = createLogger("conversation");

const SUPPORTED_LANGUAGE_VALUES = new Set<string>(Object.values(SupportedLanguage));

/** "pt-BR" / "pt" -> "pt"; anything we don't support -> null. */
function toSupportedLanguage(value: string | null | undefined): SupportedLanguage | null {
  const primary = value?.split("-")[0].toLowerCase();
  return primary && SUPPORTED_LANGUAGE_VALUES.has(primary) ? (primary as SupportedLanguage) : null;
}

/** A customer id given for a new conversation is not in its organization. */
export class ConversationReferenceNotFoundError extends Error {
  constructor(kind: "Customer") {
    super(`${kind} not found`);
    this.name = "ConversationReferenceNotFoundError";
  }
}

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
      playbook_id?: string | null;
      metadata?: Record<string, unknown>;
      status?: ConversationStatus;
      customer_id?: string | null;
      language?: string | null;
    },
  ): Promise<Conversation> {
    // If no customer_id is provided, create an anonymous customer
    let customerId = data.customer_id;
    if (customerId) {
      if (!(await this.customerService.getCustomer(customerId, organizationId))) {
        throw new ConversationReferenceNotFoundError("Customer");
      }
    } else {
      const anonymousCustomer = await this.customerService.createAnonymousCustomer(organizationId);
      customerId = anonymousCustomer.id;
    }

    const conversation = await this.conversationRepository.create({
      title: data.title || "",
      playbook_id: data.playbook_id || null,
      organization_id: organizationId,
      status: data.status || "open",
      context: {},
      metadata: data.metadata || {},
      needs_processing: false,
      customer_id: customerId,
      language: toSupportedLanguage(data.language),
    });

    // An open conversation starts with its instructions and the greeting,
    // written before we return. The caller (the widget) sends the shopper's
    // first message right after, so the greeting always comes first and no
    // run races that message. If this fails, fall back to the orchestrator
    // run, which writes whatever is missing.
    if (data.status === "open" || data.status === "processing") {
      try {
        await conversation.addInitialSystemMessage();
        await conversation.addInitialAssistantInstructions();
        await conversation.addInitialBotMessage();
      } catch (error) {
        logger.warn(
          { err: error, conversationId: conversation.id },
          "Initial messages failed, leaving them to the orchestrator",
        );
        await this.conversationRepository.updateById(conversation.id, { needs_processing: true });
        conversation.needs_processing = true;
      }
    }

    // Trigger hook for conversation created
    await hookManager.trigger("conversation.created", {
      organizationId,
      conversationId: conversation.id,
      metadata: {
        customerId,
        status: data.status || "open",
        language: data.language,
      },
    });

    // Enqueue for RabbitMQ processing if conversation needs it
    if (conversation.needs_processing) {
      const { orchestratorQueueService } = await import("./orchestrator-queue.service");
      await orchestratorQueueService.enqueue(conversation.id, organizationId, "creation");
    }

    return conversation;
  }

  async getConversations(organizationId: string): Promise<Conversation[]> {
    return await this.conversationRepository.findByOrganization(organizationId);
  }

  async getConversation(
    conversationId: string,
    organizationId: string,
  ): Promise<Conversation | null> {
    const conversation = await this.conversationRepository.findById(conversationId);
    if (!conversation || conversation.organization_id !== organizationId) {
      return null;
    }
    // Surface a usable URL for the assistant's avatar (the entity only carries
    // the raw upload record), so the dashboard can show it on AI messages.
    if (conversation.organization?.assistantAvatarUpload) {
      conversation.organization.assistantAvatarUrl = new StorageService().getUrl(
        conversation.organization.assistantAvatarUpload,
      );
    }
    return conversation;
  }

  async updateConversation(
    conversationId: string,
    organizationId: string,
    data: {
      title?: string;
      status?: ConversationStatus;
      needs_processing?: boolean;
      last_processed_at?: Date | null;
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
    if (data.status === "closed" || data.status === "resolved" || data.status === "unresolved") {
      updateData.closed_at = getUTCNow();
    }

    const result = await this.conversationRepository.update(
      conversationId,
      organizationId,
      updateData,
    );

    // Generate conversation title and handoff summary when status changes to pending-human
    if (data.status === "pending-human") {
      import("../orchestrator/conversation-utils").then(
        ({ generateConversationTitle, generateHandoffSummary }) => {
          generateConversationTitle(conversationId, organizationId, false).catch((error) => {
            logger.error({ err: error }, "Error generating title for pending-human conversation");
          });
          generateHandoffSummary(conversationId, organizationId, true).catch((error) => {
            logger.error({ err: error }, "Error generating handoff summary");
          });
        },
      );
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
    // automatically deleted by database CASCADE.
    // If embedding deletion fails, we abort the conversation deletion to ensure no
    // personal data remains orphaned in vector storage.
    const { vectorStoreService } = await import("./vector-store.service");
    if (vectorStoreService.initialized) {
      try {
        // Delete embeddings by conversation ID
        await vectorStoreService.deleteByConversationIds(organizationId, [conversationId]);

        // Delete embeddings by message IDs
        const messageIds = conversation.messages?.map((m) => m.id) || [];
        if (messageIds.length > 0) {
          await vectorStoreService.deleteByMessageIds(organizationId, messageIds);
        }
      } catch (error) {
        logger.error(
          { err: error, conversationId },
          "Failed to delete embeddings for conversation",
        );
        throw error; // Re-throw to abort conversation deletion for GDPR compliance
      }
    }

    // Media files are not removed by the row's CASCADE either.
    const { deleteConversationMedia } = await import("./conversation-media.service");
    await deleteConversationMedia({ organizationId, conversationIds: [conversationId] });

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
