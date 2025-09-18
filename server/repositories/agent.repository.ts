import { Repository } from "typeorm";
import { Agent } from "../database/entities/agent.entity";
import { AppDataSource } from "../database/data-source";

export class AgentRepository {
  private repository!: Repository<Agent>;

  constructor() {
    // Lazy initialization
  }

  private getRepository(): Repository<Agent> {
    if (!this.repository) {
      if (!AppDataSource?.isInitialized) {
        throw new Error(`Database not initialized. Cannot access Agent repository.`);
      }
      this.repository = AppDataSource.getRepository(Agent);
    }
    return this.repository;
  }

  async create(data: Partial<Agent>): Promise<Agent> {
    const agent = this.getRepository().create(data);
    return await this.getRepository().save(agent);
  }

  async findById(id: string): Promise<Agent | null> {
    return await this.getRepository().findOne({
      where: { id },
    });
  }

  async findByOrganization(organizationId: string): Promise<Agent[]> {
    return await this.getRepository().find({
      where: { organization_id: organizationId },
      order: { created_at: "DESC" },
    });
  }

  async findEnabledByOrganization(organizationId: string): Promise<Agent[]> {
    return await this.getRepository().find({
      where: { organization_id: organizationId, enabled: true },
      order: { created_at: "DESC" },
    });
  }

  async update(id: string, organizationId: string, data: Partial<Agent>): Promise<Agent | null> {
    const agent = await this.findById(id);
    if (!agent || agent.organization_id !== organizationId) {
      return null;
    }

    await this.getRepository().update({ id, organization_id: organizationId }, data);

    return await this.findById(id);
  }

  async delete(id: string, organizationId: string): Promise<boolean> {
    const result = await this.getRepository().delete({
      id,
      organization_id: organizationId,
    });

    return result.affected !== 0;
  }
}

export const agentRepository = new AgentRepository();
