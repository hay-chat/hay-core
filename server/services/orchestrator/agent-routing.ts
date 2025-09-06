import { AgentService } from "../agent.service";
import { ConversationService } from "../conversation.service";
import { MessageType } from "../../database/entities/message.entity";
import { ContextLayer } from "./context-layer";
import { PlaybookService } from "../playbook.service";

/**
 * Manages agent routing and assignment for conversations.
 * Handles agent availability checks and fallback to human representatives.
 */
export class AgentRouting {
  private contextLayer: ContextLayer;

  /**
   * Creates a new AgentRouting instance.
   * @param agentService - Service for managing agents
   * @param conversationService - Service for managing conversations
   * @param playbookService - Service for managing playbooks
   */
  constructor(
    private agentService: AgentService,
    private conversationService: ConversationService,
    private playbookService: PlaybookService
  ) {
    this.contextLayer = new ContextLayer(
      conversationService,
      agentService,
      playbookService
    );
  }

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
      type: MessageType.BOT_AGENT,
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
   * Assigns a specific agent to a conversation and creates a system message with agent instructions.
   * @param conversationId - The ID of the conversation
   * @param organizationId - The ID of the organization
   * @param agentId - The ID of the agent to assign
   */
  async assignAgent(
    conversationId: string,
    organizationId: string,
    agentId: string
  ): Promise<void> {
    // Check if agent exists
    const agent = await this.agentService.getAgent(agentId, organizationId);
    if (!agent) {
      console.error(`[AgentRouting] Agent ${agentId} not found for organization ${organizationId}`);
      return;
    }

    // Check if agent is already assigned to prevent unnecessary updates
    const conversation = await this.conversationService.getConversation(conversationId, organizationId);
    if (conversation?.agent_id === agentId) {
      console.log(`[AgentRouting] Agent ${agentId} already assigned to conversation ${conversationId}, skipping`);
      return;
    }

    // Update conversation with agent assignment
    await this.conversationService.updateConversation(
      conversationId,
      organizationId,
      { agent_id: agentId }
    );

    // Use Context Layer to add agent context (handles deduplication automatically)
    const contextAdded = await this.contextLayer.addAgent(
      conversationId,
      organizationId,
      agentId
    );

    if (contextAdded) {
      console.log(`[AgentRouting] ✅ Agent ${agent.name} (${agentId}) assigned to conversation ${conversationId} with context`);
    } else {
      console.log(`[AgentRouting] Agent ${agent.name} (${agentId}) assigned to conversation ${conversationId} (context already exists)`);
    }
  }
}