import { Repository } from "typeorm";
import { Message, MessageType, MessageSentiment } from "../database/entities/message.entity";
import { AppDataSource } from "../database/data-source";

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

  async findById(id: string): Promise<Message | null> {
    return await this.getRepository().findOne({
      where: { id },
    });
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
    await this.getRepository().update(id, data as any);
    return await this.findById(id);
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
    endDate?: Date
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

    return results.map(row => ({
      sentiment: row.sentiment as MessageSentiment,
      count: parseInt(row.count, 10)
    }));
  }

  async getAverageMessagesPerConversation(
    organizationId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<number> {
    const queryBuilder = this.getRepository()
      .createQueryBuilder("message")
      .innerJoin("message.conversation", "conversation")
      .select("conversation.id", "conversation_id")
      .addSelect("COUNT(*)", "message_count")
      .where("conversation.organization_id = :organizationId", { organizationId });

    if (startDate) {
      queryBuilder.andWhere("conversation.created_at >= :startDate", { startDate });
    }

    if (endDate) {
      queryBuilder.andWhere("conversation.created_at <= :endDate", { endDate });
    }

    queryBuilder.groupBy("conversation.id");

    const subQuery = `(${queryBuilder.getQuery()})`;
    const avgResult = await this.getRepository().query(
      `SELECT AVG(message_count) as avg_messages FROM ${subQuery} as counts`,
      queryBuilder.getParameters()
    );

    return avgResult[0]?.avg_messages ? parseFloat(avgResult[0].avg_messages) : 0;
  }
}

export const messageRepository = new MessageRepository();
