import { AgentService } from "../agent.service";
import { ConversationService } from "../conversation.service";
import { MessageType } from "../../database/entities/message.entity";

/**
 * Manages agent routing and assignment for conversations.
 * Handles agent availability checks and fallback to human representatives.
 */
export class AgentRouting {
  /**
   * Creates a new AgentRouting instance.
   * @param agentService - Service for managing agents
   * @param conversationService - Service for managing conversations
   */
  constructor(
    private agentService: AgentService,
    private conversationService: ConversationService
  ) {}

  /**
   * Routes to an available agent for the organization.
   * Checks org-specific agents first, then falls back to system agents.
   * @param organizationId - The ID of the organization
   * @returns The agent ID if found, null otherwise
   */
  async routeAgent(organizationId: string): Promise<string | null> {
    // Get org agents first, then system agents
    const agents = await this.agentService.getAgents(organizationId);
    const enabledAgent = agents.find((a) => a.enabled);

    if (enabledAgent) {
      return enabledAgent.id;
    }

    // TODO: Get system agents as fallback
    return null;
  }

  /**
   * Handles the case when no agent is available.
   * Sends a notification message and updates conversation status to pending-human.
   * @param conversationId - The ID of the conversation
   * @param organizationId - The ID of the organization
   */
  async handleNoAgent(
    conversationId: string,
    organizationId: string
  ): Promise<void> {
    await this.conversationService.addMessage(conversationId, organizationId, {
      content:
        "I understand you'd like assistance. I'll make sure a human representative is notified to help you as soon as possible.",
      type: MessageType.AI_MESSAGE,
      sender: "system",
    });

    await this.conversationService.updateConversation(
      conversationId,
      organizationId,
      {
        status: "pending-human",
      }
    );
  }

  /**
   * Assigns a specific agent to a conversation.
   * @param conversationId - The ID of the conversation
   * @param organizationId - The ID of the organization
   * @param agentId - The ID of the agent to assign
   */
  async assignAgent(
    conversationId: string,
    organizationId: string,
    agentId: string
  ): Promise<void> {
    await this.conversationService.updateConversation(
      conversationId,
      organizationId,
      { agent_id: agentId }
    );
  }
}