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
    // First, get the agent details to create system message
    const agent = await this.agentService.getAgent(agentId, organizationId);
    if (!agent) {
      console.error(`[AgentRouting] Agent ${agentId} not found for organization ${organizationId}`);
      return;
    }

    // Check if agent is already assigned to prevent duplicate system messages
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

    // Check if we already have an agent assignment system message to prevent duplicates
    const existingMessages = await this.conversationService.getMessages(conversationId);
    const hasAgentAssignmentMessage = existingMessages.some(
      msg => msg.type === MessageType.SYSTEM && 
             msg.metadata && 
             typeof msg.metadata === 'object' && 
             'reason' in msg.metadata && 
             msg.metadata.reason === "agent_assignment"
    );

    if (hasAgentAssignmentMessage) {
      console.log(`[AgentRouting] Agent assignment system message already exists for conversation ${conversationId}, skipping duplicate`);
      return;
    }

    // Create system message with agent instructions
    const systemMessageParts = [];
    
    // Add agent name and description
    systemMessageParts.push(`🤖 ${agent.name} has joined the conversation.`);
    
    if (agent.description) {
      systemMessageParts.push(`\n📋 **About**: ${agent.description}`);
    }

    // Add instructions if available
    if (agent.instructions) {
      systemMessageParts.push(`\n📝 **Instructions**: ${agent.instructions}`);
    }

    // Add tone guidance if available
    if (agent.tone) {
      systemMessageParts.push(`\n🎭 **Communication Style**: ${agent.tone}`);
    }

    // Add avoidance guidelines if available
    if (agent.avoid) {
      systemMessageParts.push(`\n🚫 **Guidelines**: Avoid ${agent.avoid}`);
    }

    const systemMessage = systemMessageParts.join('');

    // Add the system message to the conversation
    await this.conversationService.addMessage(conversationId, organizationId, {
      content: systemMessage,
      type: MessageType.SYSTEM,
      sender: "system",
      metadata: {
        agent_id: agentId,
        agent_name: agent.name,
        reason: "agent_assignment"
      }
    });

    console.log(`[AgentRouting] ✅ Agent ${agent.name} (${agentId}) assigned to conversation ${conversationId} with system message`);
  }
}