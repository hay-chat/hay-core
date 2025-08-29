import { Repository } from "typeorm";
import { Message, MessageType } from "../database/entities/message.entity";
import { AppDataSource } from "../database/data-source";

export class MessageRepository {
  private repository: Repository<Message>;

  constructor() {
    this.repository = AppDataSource.getRepository(Message);
  }

  async create(data: Partial<Message>): Promise<Message> {
    const message = this.repository.create(data);
    return await this.repository.save(message);
  }

  async createBulk(messages: Partial<Message>[]): Promise<Message[]> {
    const messageEntities = this.repository.create(messages);
    return await this.repository.save(messageEntities);
  }

  async findById(id: string): Promise<Message | null> {
    return await this.repository.findOne({
      where: { id }
    });
  }

  async findByConversation(conversationId: string): Promise<Message[]> {
    return await this.repository.find({
      where: { conversation_id: conversationId },
      order: { created_at: "ASC" }
    });
  }

  async findByType(conversationId: string, type: MessageType): Promise<Message[]> {
    return await this.repository.find({
      where: { conversation_id: conversationId, type },
      order: { created_at: "ASC" }
    });
  }

  async getLastMessages(conversationId: string, limit: number = 10): Promise<Message[]> {
    return await this.repository.find({
      where: { conversation_id: conversationId },
      order: { created_at: "DESC" },
      take: limit
    });
  }

  async update(id: string, data: Partial<Message>): Promise<Message | null> {
    await this.repository.update(id, data);
    return await this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.repository.delete(id);
    return result.affected !== 0;
  }

  async deleteByConversation(conversationId: string): Promise<boolean> {
    const result = await this.repository.delete({
      conversation_id: conversationId
    });
    return result.affected !== 0;
  }
}