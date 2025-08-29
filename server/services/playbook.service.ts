import { PlaybookRepository } from "../repositories/playbook.repository";
import { AgentRepository } from "../repositories/agent.repository";
import { Playbook, PlaybookStatus } from "../database/entities/playbook.entity";
import { Agent } from "../database/entities/agent.entity";

export class PlaybookService {
  private playbookRepository: PlaybookRepository;
  private agentRepository: AgentRepository;

  constructor() {
    this.playbookRepository = new PlaybookRepository();
    this.agentRepository = new AgentRepository();
  }

  async createPlaybook(organizationId: string, data: {
    name: string;
    description?: string;
    instructions?: string;
    status?: PlaybookStatus;
    agentIds?: string[];
  }): Promise<Playbook> {
    const { agentIds, ...playbookData } = data;
    
    const agents: Agent[] = [];
    if (agentIds && agentIds.length > 0) {
      for (const agentId of agentIds) {
        const agent = await this.agentRepository.findById(agentId, organizationId);
        if (agent) {
          agents.push(agent);
        }
      }
    }

    return await this.playbookRepository.create({
      ...playbookData,
      organization_id: organizationId,
      agents
    });
  }

  async getPlaybooks(organizationId: string): Promise<Playbook[]> {
    return await this.playbookRepository.findByOrganization(organizationId);
  }

  async getPlaybooksByStatus(organizationId: string, status: PlaybookStatus): Promise<Playbook[]> {
    return await this.playbookRepository.findByStatus(organizationId, status);
  }

  async getPlaybook(organizationId: string, playbookId: string): Promise<Playbook | null> {
    return await this.playbookRepository.findById(playbookId, organizationId);
  }

  async updatePlaybook(
    organizationId: string,
    playbookId: string,
    data: {
      name?: string;
      description?: string;
      instructions?: string;
      status?: PlaybookStatus;
      agentIds?: string[];
    }
  ): Promise<Playbook | null> {
    const { agentIds, ...updateData } = data;
    
    let agents: Agent[] | undefined;
    if (agentIds !== undefined) {
      agents = [];
      for (const agentId of agentIds) {
        const agent = await this.agentRepository.findById(agentId, organizationId);
        if (agent) {
          agents.push(agent);
        }
      }
    }

    return await this.playbookRepository.update(playbookId, organizationId, {
      ...updateData,
      ...(agents !== undefined && { agents })
    });
  }

  async deletePlaybook(organizationId: string, playbookId: string): Promise<boolean> {
    return await this.playbookRepository.delete(playbookId, organizationId);
  }

  async addAgentToPlaybook(organizationId: string, playbookId: string, agentId: string): Promise<Playbook | null> {
    const agent = await this.agentRepository.findById(agentId, organizationId);
    if (!agent) {
      throw new Error("Agent not found");
    }

    return await this.playbookRepository.addAgent(playbookId, agentId, organizationId);
  }

  async removeAgentFromPlaybook(organizationId: string, playbookId: string, agentId: string): Promise<Playbook | null> {
    return await this.playbookRepository.removeAgent(playbookId, agentId, organizationId);
  }
}