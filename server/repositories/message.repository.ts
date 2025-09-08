import { Repository } from "typeorm";
import { Message, MessageType } from "../database/entities/message.entity";
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

  async findByType(
    conversationId: string,
    type: MessageType
  ): Promise<Message[]> {
    return await this.getRepository().find({
      where: { conversation_id: conversationId, type },
      order: { created_at: "ASC" },
    });
  }

  async getLastMessages(
    conversationId: string,
    limit: number = 10
  ): Promise<Message[]> {
    return await this.getRepository().find({
      where: { conversation_id: conversationId },
      order: { created_at: "DESC" },
      take: limit,
    });
  }

  async update(id: string, data: Partial<Message>): Promise<Message | null> {
    await this.getRepository().update(id, data);
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
}

export const messageRepository = new MessageRepository();
