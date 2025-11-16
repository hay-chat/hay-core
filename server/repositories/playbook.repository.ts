import { Repository, In } from "typeorm";
import { Playbook, PlaybookStatus } from "../database/entities/playbook.entity";
import { Agent } from "../database/entities/agent.entity";
import { AppDataSource } from "../database/data-source";

export class PlaybookRepository {
  private repository!: Repository<Playbook>;
  private agentRepository!: Repository<Agent>;

  constructor() {
    // Lazy initialization
  }

  private getRepository(): Repository<Playbook> {
    if (!this.repository) {
      if (!AppDataSource?.isInitialized) {
        throw new Error(`Database not initialized. Cannot access Playbook repository.`);
      }
      this.repository = AppDataSource.getRepository(Playbook);
    }
    return this.repository;
  }

  private getAgentRepository(): Repository<Agent> {
    if (!this.agentRepository) {
      if (!AppDataSource?.isInitialized) {
        throw new Error(`Database not initialized. Cannot access Agent repository.`);
      }
      this.agentRepository = AppDataSource.getRepository(Agent);
    }
    return this.agentRepository;
  }

  async create(data: Partial<Playbook>): Promise<Playbook> {
    const playbook = this.getRepository().create(data);
    return await this.getRepository().save(playbook);
  }

  /**
   * @deprecated Use findByIdAndOrganization instead to ensure proper organization scoping
   */
  async findById(id: string): Promise<Playbook | null> {
    return await this.getRepository().findOne({
      where: { id },
      relations: ["agents"],
    });
  }

  /**
   * Find playbook by ID and organizationId - ensures proper organization scoping
   */
  async findByIdAndOrganization(id: string, organizationId: string): Promise<Playbook | null> {
    return await this.getRepository().findOne({
      where: { id, organization_id: organizationId },
      relations: ["agents"],
    });
  }

  async findByOrganization(organizationId: string): Promise<Playbook[]> {
    return await this.getRepository().find({
      where: { organization_id: organizationId },
      relations: ["agents"],
      order: { created_at: "DESC" },
    });
  }

  async findByStatus(organizationId: string, status: PlaybookStatus): Promise<Playbook[]> {
    return await this.getRepository().find({
      where: { organization_id: organizationId, status },
      relations: ["agents"],
      order: { created_at: "DESC" },
    });
  }

  async update(
    id: string,
    organizationId: string,
    data: Partial<Playbook>,
  ): Promise<Playbook | null> {
    const playbook = await this.findById(id);
    if (!playbook || playbook.organization_id !== organizationId) {
      return null;
    }

    if (data.agents !== undefined) {
      playbook.agents = data.agents;
      await this.getRepository().save(playbook);
      delete data.agents;
    }

    // Note: Messages are created when a playbook is assigned to a conversation,
    // not when the playbook itself is updated. See conversation.entity.ts updatePlaybook method.

    if (Object.keys(data).length > 0) {
      await this.getRepository().update({ id, organization_id: organizationId }, data as any);
    }

    return await this.findById(id);
  }

  async delete(id: string, organizationId: string): Promise<boolean> {
    const result = await this.getRepository().delete({
      id,
      organization_id: organizationId,
    });

    return result.affected !== 0;
  }

  async assignAgents(
    playbookId: string,
    agentIds: string[],
    organizationId: string,
  ): Promise<Playbook | null> {
    const playbook = await this.findById(playbookId);
    if (!playbook || playbook.organization_id !== organizationId) {
      return null;
    }

    if (agentIds.length > 0) {
      const agents = await this.getAgentRepository().find({
        where: {
          id: In(agentIds),
          organization_id: organizationId,
        },
      });
      playbook.agents = agents;
    } else {
      playbook.agents = [];
    }

    return await this.getRepository().save(playbook);
  }

  async addAgent(
    playbookId: string,
    agentId: string,
    organizationId: string,
  ): Promise<Playbook | null> {
    const playbook = await this.findById(playbookId);
    if (!playbook || playbook.organization_id !== organizationId) {
      return null;
    }

    const agentExists = playbook.agents.some((agent) => agent.id === agentId);
    if (!agentExists) {
      const agent = await this.getAgentRepository().findOne({
        where: { id: agentId, organization_id: organizationId },
      });
      if (agent) {
        playbook.agents.push(agent);
        await this.getRepository().save(playbook);
      }
    }

    return await this.findById(playbookId);
  }

  async removeAgent(
    playbookId: string,
    agentId: string,
    organizationId: string,
  ): Promise<Playbook | null> {
    const playbook = await this.findById(playbookId);
    if (!playbook || playbook.organization_id !== organizationId) {
      return null;
    }

    playbook.agents = playbook.agents.filter((agent) => agent.id !== agentId);
    await this.getRepository().save(playbook);

    return await this.findById(playbookId);
  }
}

export const playbookRepository = new PlaybookRepository();
