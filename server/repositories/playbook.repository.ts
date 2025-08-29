import { Repository } from "typeorm";
import { Playbook, PlaybookStatus } from "../database/entities/playbook.entity";
import { AppDataSource } from "../database/data-source";

export class PlaybookRepository {
  private repository: Repository<Playbook>;

  constructor() {
    this.repository = AppDataSource.getRepository(Playbook);
  }

  async create(data: Partial<Playbook>): Promise<Playbook> {
    const playbook = this.repository.create(data);
    return await this.repository.save(playbook);
  }

  async findById(id: string, organizationId: string): Promise<Playbook | null> {
    return await this.repository.findOne({
      where: { id, organization_id: organizationId },
      relations: ["agents"]
    });
  }

  async findByOrganization(organizationId: string): Promise<Playbook[]> {
    return await this.repository.find({
      where: { organization_id: organizationId },
      relations: ["agents"],
      order: { created_at: "DESC" }
    });
  }

  async findByStatus(organizationId: string, status: PlaybookStatus): Promise<Playbook[]> {
    return await this.repository.find({
      where: { organization_id: organizationId, status },
      relations: ["agents"],
      order: { created_at: "DESC" }
    });
  }

  async update(id: string, organizationId: string, data: Partial<Playbook>): Promise<Playbook | null> {
    const playbook = await this.findById(id, organizationId);
    if (!playbook) {
      return null;
    }
    
    if (data.agents !== undefined) {
      playbook.agents = data.agents;
      await this.repository.save(playbook);
      delete data.agents;
    }
    
    if (Object.keys(data).length > 0) {
      await this.repository.update(
        { id, organization_id: organizationId },
        data
      );
    }
    
    return await this.findById(id, organizationId);
  }

  async delete(id: string, organizationId: string): Promise<boolean> {
    const result = await this.repository.delete({
      id,
      organization_id: organizationId
    });
    
    return result.affected !== 0;
  }

  async addAgent(playbookId: string, agentId: string, organizationId: string): Promise<Playbook | null> {
    const playbook = await this.findById(playbookId, organizationId);
    if (!playbook) {
      return null;
    }

    const agentExists = playbook.agents.some(agent => agent.id === agentId);
    if (!agentExists) {
      playbook.agents.push({ id: agentId } as any);
      await this.repository.save(playbook);
    }

    return await this.findById(playbookId, organizationId);
  }

  async removeAgent(playbookId: string, agentId: string, organizationId: string): Promise<Playbook | null> {
    const playbook = await this.findById(playbookId, organizationId);
    if (!playbook) {
      return null;
    }

    playbook.agents = playbook.agents.filter(agent => agent.id !== agentId);
    await this.repository.save(playbook);

    return await this.findById(playbookId, organizationId);
  }
}