import { Repository } from "typeorm";
import { Agent } from "../database/entities/agent.entity";
import { AppDataSource } from "../database/data-source";

export class AgentRepository {
  private repository: Repository<Agent>;

  constructor() {
    this.repository = AppDataSource.getRepository(Agent);
  }

  async create(data: Partial<Agent>): Promise<Agent> {
    const agent = this.repository.create(data);
    return await this.repository.save(agent);
  }

  async findById(id: string, organizationId: string): Promise<Agent | null> {
    return await this.repository.findOne({
      where: { id, organization_id: organizationId }
    });
  }

  async findByOrganization(organizationId: string): Promise<Agent[]> {
    return await this.repository.find({
      where: { organization_id: organizationId },
      order: { created_at: "DESC" }
    });
  }

  async findEnabledByOrganization(organizationId: string): Promise<Agent[]> {
    return await this.repository.find({
      where: { organization_id: organizationId, enabled: true },
      order: { created_at: "DESC" }
    });
  }

  async update(id: string, organizationId: string, data: Partial<Agent>): Promise<Agent | null> {
    const agent = await this.findById(id, organizationId);
    if (!agent) {
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