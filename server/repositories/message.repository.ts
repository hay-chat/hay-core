import { Repository } from "typeorm";
import type { QueryDeepPartialEntity } from "typeorm";
import { Message, MessageType, MessageSentiment } from "../database/entities/message.entity";
import { AppDataSource } from "../database/data-source";
import type { DeliveryState } from "../types/message-feedback.types";

export class MessageRepository {
  private repository!: Repository<Message>;

  constructor() {
    // Lazy initialization
  }

  private getRepository(): Repository<Message> {
    if (!this.repository) {
      if (!AppDataSource?.isInitialized) {
        throw new Error(`Database not initialized. Cannot access Message repository.`);
      }
      this.repository = AppDataSource.getRepository(Message);
    }
    return this.repository;
  }

  async create(data: Partial<Message>): Promise<Message> {
    const message = this.getRepository().create(data);
    return await this.getRepository().save(message);
  }

  async createBulk(messages: Partial<Message>[]): Promise<Message[]> {
    const messageEntities = this.getRepository().create(messages);
    return await this.getRepository().save(messageEntities);
  }

  /**
   * @deprecated Use findByIdAndOrganization instead to ensure proper organization scoping
   */
  async findById(id: string): Promise<Message | null> {
    return await this.getRepository().findOne({
      where: { id },
    });
  }

  /**
   * Find message by ID and organizationId - ensures proper organization scoping
   * Messages are scoped through their parent conversation's organization
   */
  async findByIdAndOrganization(id: string, organizationId: string): Promise<Message | null> {
    return await this.getRepository()
      .createQueryBuilder("message")
      .innerJoin("message.conversation", "conversation")
      .where("message.id = :id", { id })
      .andWhere("conversation.organization_id = :organizationId", { organizationId })
      .getOne();
  }

  /**
   * Find message by the channel provider's message id (e.g. Meta wamid),
   * scoped to the organization through the parent conversation.
   */
  async findByProviderMessageIdAndOrganization(
    providerMessageId: string,
    organizationId: string,
  ): Promise<Message | null> {
    return await this.getRepository()
      .createQueryBuilder("message")
      .innerJoin("message.conversation", "conversation")
      .where("message.provider_message_id = :providerMessageId", { providerMessageId })
      .andWhere("conversation.organization_id = :organizationId", { organizationId })
      .getOne();
  }

  /**
   * An outbound message by provider id across organizations, with its
   * conversation's organization. Only for provider callbacks that carry no
   * organization (account-wide email event webhooks, D13-10).
   */
  async findOutboundByProviderMessageIds(
    providerMessageIds: string[],
  ): Promise<{ message: Message; organizationId: string; channel: string } | null> {
    if (providerMessageIds.length === 0) return null;
    const message = await this.getRepository()
      .createQueryBuilder("message")
      .innerJoinAndSelect("message.conversation", "conversation")
      .where("message.provider_message_id IN (:...providerMessageIds)", { providerMessageIds })
      .andWhere("message.type IN (:...types)", {
        types: [MessageType.BOT_AGENT, MessageType.HUMAN_AGENT],
      })
      .getOne();
    if (!message) return null;
    return {
      message,
      organizationId: message.conversation.organization_id,
      channel: message.conversation.channel,
    };
  }

  async findByConversation(conversationId: string): Promise<Message[]> {
    return await this.getRepository().find({
      where: { conversation_id: conversationId },
      order: { created_at: "ASC" },
    });
  }

  async findByType(conversationId: string, type: MessageType): Promise<Message[]> {
    return await this.getRepository().find({
      where: { conversation_id: conversationId, type },
      order: { created_at: "ASC" },
    });
  }

  async getLastMessages(conversationId: string, limit: number = 10): Promise<Message[]> {
    return await this.getRepository().find({
      where: { conversation_id: conversationId },
      order: { created_at: "DESC" },
      take: limit,
    });
  }

  async update(id: string, data: Partial<Message>): Promise<Message | null> {
    await this.getRepository().update(id, data as QueryDeepPartialEntity<Message>);
    return await this.findById(id);
  }

  /**
   * Apply `data` only while the message is still in the `from` delivery state.
   * Returns null when another writer moved it first, so two concurrent
   * approvals of the same reply cannot both succeed and deliver it twice.
   */
  async transitionDeliveryState(
    id: string,
    from: DeliveryState,
    data: Partial<Message>,
  ): Promise<Message | null> {
    const result = await this.getRepository().update(
      { id, deliveryState: from },
      data as QueryDeepPartialEntity<Message>,
    );
    if (!result.affected) return null;
    return await this.findById(id);
  }

  async updateProviderMessageId(id: string, providerMessageId: string): Promise<void> {
    await this.getRepository().update(id, { providerMessageId });
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.getRepository().delete(id);
    return result.affected !== 0;
  }

  async deleteByConversation(conversationId: string): Promise<boolean> {
    const result = await this.getRepository().delete({
      conversation_id: conversationId,
    });
    return result.affected !== 0;
  }

  async getSentimentDistribution(
    organizationId: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<Array<{ sentiment: MessageSentiment; count: number }>> {
    const queryBuilder = this.getRepository()
      .createQueryBuilder("message")
      .innerJoin("message.conversation", "conversation")
      .select("message.sentiment", "sentiment")
      .addSelect("COUNT(*)", "count")
      .where("conversation.organization_id = :organizationId", { organizationId })
      .andWhere("message.type = :type", { type: MessageType.CUSTOMER })
      .andWhere("message.sentiment IS NOT NULL");

    if (startDate) {
      queryBuilder.andWhere("message.created_at >= :startDate", { startDate });
    }

    if (endDate) {
      queryBuilder.andWhere("message.created_at <= :endDate", { endDate });
    }

    queryBuilder.groupBy("message.sentiment");

    const results = await queryBuilder.getRawMany();

    return results.map((row) => ({
      sentiment: row.sentiment as MessageSentiment,
      count: parseInt(row.count, 10),
    }));
  }

  async getAverageMessagesPerConversation(
    organizationId: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<number> {
    // Build the query with proper parameterization
    let query = `
      WITH conversation_message_counts AS (
        SELECT c.id, COUNT(m.id) as message_count
        FROM conversations c
        LEFT JOIN messages m ON m.conversation_id = c.id
        WHERE c.organization_id = $1
    `;

    const params: (string | Date)[] = [organizationId];
    let paramIndex = 2;

    if (startDate) {
      query += ` AND c.created_at >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND c.created_at <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    query += `
        GROUP BY c.id
      )
      SELECT AVG(message_count) as avg_messages FROM conversation_message_counts
    `;

    const avgResult: Array<{ avg_messages: string | null }> = await this.getRepository().query(
      query,
      params,
    );

    return avgResult[0]?.avg_messages ? parseFloat(avgResult[0].avg_messages) : 0;
  }
}

export const messageRepository = new MessageRepository();
