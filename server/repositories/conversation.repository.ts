import { Repository } from "typeorm";
import { Conversation } from "../database/entities/conversation.entity";
import { AppDataSource } from "../database/data-source";

export class ConversationRepository {
  private repository: Repository<Conversation>;

  constructor() {
    this.repository = AppDataSource.getRepository(Conversation);
  }

  async create(data: Partial<Conversation>): Promise<Conversation> {
    const conversation = this.repository.create(data);
    return await this.repository.save(conversation);
  }

  async findById(id: string, organizationId: string): Promise<Conversation | null> {
    return await this.repository.findOne({
      where: { id, organization_id: organizationId },
      relations: ["messages"]
    });
  }

  async findByAgent(agentId: string, organizationId: string): Promise<Conversation[]> {
    return await this.repository.find({
      where: { agent_id: agentId, organization_id: organizationId },
      order: { created_at: "DESC" }
    });
  }

  async findByOrganization(organizationId: string): Promise<Conversation[]> {
    return await this.repository.find({
      where: { organization_id: organizationId },
      order: { created_at: "DESC" }
    });
  }

  async update(id: string, organizationId: string, data: Partial<Conversation>): Promise<Conversation | null> {
    const conversation = await this.findById(id, organizationId);
    if (!conversation) {
      return null;
    }
    
    await this.repository.update(
      { id, organization_id: organizationId },
      data
    );
    
    return await this.findById(id, organizationId);
  }

  async delete(id: string, organizationId: string): Promise<boolean> {
    const result = await this.repository.delete({
      id,
      organization_id: organizationId
    });
    
    return result.affected !== 0;
  }
}