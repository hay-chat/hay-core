import { AgentRepository } from "../repositories/agent.repository";
import { Agent } from "../database/entities/agent.entity";

export class AgentService {
  private agentRepository: AgentRepository;

  constructor() {
    this.agentRepository = new AgentRepository();
  }

  async createAgent(
    organizationId: string,
    data: {
      name: string;
      description?: string;
      enabled?: boolean;
      instructions?: string;
      tone?: string;
      avoid?: string;
      trigger?: string;
      humanHandoffAvailableInstructions?: unknown[];
      humanHandoffUnavailableInstructions?: unknown[];
    },
  ): Promise<Agent> {
    return await this.agentRepository.create({
      name: data.name,
      description: data.description,
      enabled: data.enabled,
      instructions: data.instructions,
      tone: data.tone,
      avoid: data.avoid,
      trigger: data.trigger,
      human_handoff_available_instructions: data.humanHandoffAvailableInstructions,
      human_handoff_unavailable_instructions: data.humanHandoffUnavailableInstructions,
      organization_id: organizationId,
    });
  }

  async getAgents(organizationId: string): Promise<Agent[]> {
    return await this.agentRepository.findByOrganization(organizationId);
  }

  async getAgent(organizationId: string, agentId: string): Promise<Agent | null> {
    const agent = await this.agentRepository.findById(agentId);
    if (!agent || agent.organization_id !== organizationId) {
      return null;
    }
    return agent;
  }

  async updateAgent(
    organizationId: string,
    agentId: string,
    data: {
      name?: string;
      description?: string;
      enabled?: boolean;
      instructions?: string;
      tone?: string;
      avoid?: string;
      trigger?: string;
      humanHandoffAvailableInstructions?: unknown[];
      humanHandoffUnavailableInstructions?: unknown[];
    },
  ): Promise<Agent | null> {
    return await this.agentRepository.update(agentId, organizationId, {
      name: data.name,
      description: data.description,
      enabled: data.enabled,
      instructions: data.instructions,
      tone: data.tone,
      avoid: data.avoid,
      trigger: data.trigger,
      human_handoff_available_instructions: data.humanHandoffAvailableInstructions,
      human_handoff_unavailable_instructions: data.humanHandoffUnavailableInstructions,
    });
  }

  async deleteAgent(organizationId: string, agentId: string): Promise<boolean> {
    return await this.agentRepository.delete(agentId, organizationId);
  }
}
