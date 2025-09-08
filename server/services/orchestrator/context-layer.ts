import { ConversationService } from "../conversation.service";
import { AgentService } from "../agent.service";
import { PlaybookService } from "../playbook.service";
import { MessageType } from "../../database/entities/message.entity";
import type { OrchestrationStatus } from "./types";
import { StatusManager } from "./status-manager";
import {
  formatInstructions,
  analyzeInstructions,
  isInstructionsJson,
} from "@server/utils/instruction-formatter";

/**
 * Context Layer manages system message creation and deduplication.
 * Tracks what context has been provided to prevent duplicate messages.
 */
export class ContextLayer {
  private statusManager: StatusManager;

  constructor(
    private conversationService: ConversationService,
    private agentService: AgentService,
    private playbookService: PlaybookService
  ) {
    this.statusManager = new StatusManager(conversationService);
  }

  /**
   * Adds agent context to the conversation if not already present.
   * Creates a system message with agent instructions and personality.
   */
  async addAgent(
    conversationId: string,
    organizationId: string,
    agentId: string
  ): Promise<boolean> {
    try {
      // Check if agent context already exists
      if (await this.hasAgentContext(conversationId, organizationId, agentId)) {
        console.log(
          `[ContextLayer] Agent ${agentId} context already exists, skipping`
        );
        return false;
      }

      // Get agent details
      const agent = await this.agentService.getAgent(agentId, organizationId);
      if (!agent) {
        console.error(
          `[ContextLayer] Agent ${agentId} not found for organization ${organizationId}`
        );
        return false;
      }

      // Create rich agent system message
      const systemMessage = this.createAgentSystemMessage(agent);

      // Add the system message to the conversation
      await this.conversationService.addMessage(
        conversationId,
        organizationId,
        systemMessage
      );

      // Update context tracking
      await this.updateContextTracking(conversationId, organizationId, {
        type: "agent",
        id: agentId,
      });

      console.log(
        `[ContextLayer] ✅ Agent ${agent.name} (${agentId}) context added to conversation ${conversationId}`
      );
      return true;
    } catch (error) {
      console.error(`[ContextLayer] Error adding agent context:`, error);
      return false;
    }
  }

  /**
   * Adds playbook context to the conversation if not already present.
   * Creates a system message with playbook instructions and tools.
   */
  async addPlaybook(
    conversationId: string,
    organizationId: string,
    playbookId: string,
    toolSchemas?: any[]
  ): Promise<boolean> {
    try {
      // Check if playbook context already exists
      if (
        await this.hasPlaybookContext(
          conversationId,
          organizationId,
          playbookId
        )
      ) {
        console.log(
          `[ContextLayer] Playbook ${playbookId} context already exists, skipping`
        );
        return false;
      }

      // Get playbook details
      const playbook = await this.playbookService.getPlaybook(
        playbookId,
        organizationId
      );
      if (!playbook) {
        console.error(
          `[ContextLayer] Playbook ${playbookId} not found for organization ${organizationId}`
        );
        return false;
      }

      // Create rich playbook system message
      const systemMessage = this.createPlaybookSystemMessage(
        playbook,
        toolSchemas
      );

      // Add the system message to the conversation
      await this.conversationService.addMessage(
        conversationId,
        organizationId,
        systemMessage
      );

      // Update context tracking
      await this.updateContextTracking(conversationId, organizationId, {
        type: "playbook",
        id: playbookId,
      });

      console.log(
        `[ContextLayer] ✅ Playbook ${playbook.title} (${playbookId}) context added to conversation ${conversationId}`
      );
      return true;
    } catch (error) {
      console.error(`[ContextLayer] Error adding playbook context:`, error);
      return false;
    }
  }

  /**
   * Adds document context to the conversation.
   * Creates a system message with relevant document information.
   */
  async addDocuments(
    conversationId: string,
    organizationId: string,
    documents: Array<{
      id?: string;
      content: string;
      title?: string;
      source?: string;
      similarity?: number;
    }>,
    query: string
  ): Promise<boolean> {
    try {
      if (!documents || documents.length === 0) {
        return false;
      }

      // Create document IDs for tracking (use content hash if no ID)
      const documentIds = documents.map(
        (doc) => doc.id || this.hashContent(doc.content)
      );

      // Check if these documents are already in context
      const existingDocuments = await this.getExistingDocumentContext(
        conversationId,
        organizationId
      );
      const newDocuments = documents.filter(
        (_, index) => !existingDocuments.includes(documentIds[index])
      );

      if (newDocuments.length === 0) {
        console.log(
          `[ContextLayer] All documents already in context, skipping`
        );
        return false;
      }

      // Create rich document system message
      const systemMessage = this.createDocumentSystemMessage(documents, query);

      // Add the system message to the conversation
      await this.conversationService.addMessage(
        conversationId,
        organizationId,
        systemMessage
      );

      // Update context tracking
      await this.updateContextTracking(conversationId, organizationId, {
        type: "documents",
        ids: documentIds,
      });

      console.log(
        `[ContextLayer] ✅ ${documents.length} documents context added to conversation ${conversationId}`
      );
      return true;
    } catch (error) {
      console.error(`[ContextLayer] Error adding document context:`, error);
      return false;
    }
  }

  /**
   * Adds tool context to the conversation if not already present.
   * Creates a system message with tool schemas and usage instructions.
   */
  async addTools(
    conversationId: string,
    organizationId: string,
    toolSchemas: any[]
  ): Promise<boolean> {
    try {
      if (!toolSchemas || toolSchemas.length === 0) {
        return false;
      }

      const toolIds = toolSchemas.map((tool) => tool.name || tool.id);

      // Check if these tools are already in context
      const existingTools = await this.getExistingToolContext(
        conversationId,
        organizationId
      );
      const newTools = toolSchemas.filter(
        (_, index) => !existingTools.includes(toolIds[index])
      );

      if (newTools.length === 0) {
        console.log(`[ContextLayer] All tools already in context, skipping`);
        return false;
      }

      // Create rich tool system message
      const systemMessage = this.createToolSystemMessage(toolSchemas);

      // Add the system message to the conversation
      await this.conversationService.addMessage(
        conversationId,
        organizationId,
        systemMessage
      );

      // Update context tracking
      await this.updateContextTracking(conversationId, organizationId, {
        type: "tools",
        ids: toolIds,
      });

      console.log(
        `[ContextLayer] ✅ ${toolSchemas.length} tools context added to conversation ${conversationId}`
      );
      return true;
    } catch (error) {
      console.error(`[ContextLayer] Error adding tool context:`, error);
      return false;
    }
  }

  /**
   * Clears all context tracking for a conversation.
   */
  async clearContext(
    conversationId: string,
    organizationId: string
  ): Promise<void> {
    try {
      // Get current status
      const conversation = await this.conversationService.getConversation(
        conversationId,
        organizationId
      );

      if (!conversation) {
        return;
      }

      // Clear context tracking
      const currentStatus = conversation.orchestration_status || {};
      const updatedStatus: OrchestrationStatus = {
        state: currentStatus.state || "waiting_for_user",
        current_playbook: currentStatus.current_playbook,
        documents_used: currentStatus.documents_used,
        intent_analysis: currentStatus.intent_analysis,
        processing_details: currentStatus.processing_details,
        context_tracking: {
          agents: [],
          playbooks: [],
          documents: [],
          tools: [],
          last_context_update: new Date().toISOString(),
        },
        last_updated: new Date().toISOString(),
      };

      await this.conversationService.updateConversation(
        conversationId,
        organizationId,
        { orchestration_status: updatedStatus }
      );

      console.log(
        `[ContextLayer] Context cleared for conversation ${conversationId}`
      );
    } catch (error) {
      console.error(`[ContextLayer] Error clearing context:`, error);
    }
  }

  /**
   * Checks if agent context already exists.
   */
  private async hasAgentContext(
    conversationId: string,
    organizationId: string,
    agentId: string
  ): Promise<boolean> {
    const conversation = await this.conversationService.getConversation(
      conversationId,
      organizationId
    );

    const contextTracking =
      conversation?.orchestration_status?.context_tracking;
    return contextTracking?.agents?.includes(agentId) || false;
  }

  /**
   * Checks if playbook context already exists.
   */
  private async hasPlaybookContext(
    conversationId: string,
    organizationId: string,
    playbookId: string
  ): Promise<boolean> {
    const conversation = await this.conversationService.getConversation(
      conversationId,
      organizationId
    );

    const contextTracking =
      conversation?.orchestration_status?.context_tracking;
    return contextTracking?.playbooks?.includes(playbookId) || false;
  }

  /**
   * Gets existing document context.
   */
  private async getExistingDocumentContext(
    conversationId: string,
    organizationId: string
  ): Promise<string[]> {
    const conversation = await this.conversationService.getConversation(
      conversationId,
      organizationId
    );

    const contextTracking =
      conversation?.orchestration_status?.context_tracking;
    return contextTracking?.documents || [];
  }

  /**
   * Gets existing tool context.
   */
  private async getExistingToolContext(
    conversationId: string,
    organizationId: string
  ): Promise<string[]> {
    const conversation = await this.conversationService.getConversation(
      conversationId,
      organizationId
    );

    const contextTracking =
      conversation?.orchestration_status?.context_tracking;
    return contextTracking?.tools || [];
  }

  /**
   * Updates context tracking in orchestration status.
   */
  private async updateContextTracking(
    conversationId: string,
    organizationId: string,
    update: {
      type: "agent" | "playbook" | "documents" | "tools";
      id?: string;
      ids?: string[];
    }
  ): Promise<void> {
    const conversation = await this.conversationService.getConversation(
      conversationId,
      organizationId
    );

    if (!conversation) {
      return;
    }

    const currentTracking = conversation.orchestration_status
      ?.context_tracking || {
      agents: [],
      playbooks: [],
      documents: [],
      tools: [],
      last_context_update: new Date().toISOString(),
    };

    // Update the appropriate array
    switch (update.type) {
      case "agent":
        if (update.id && !currentTracking.agents.includes(update.id)) {
          currentTracking.agents.push(update.id);
        }
        break;
      case "playbook":
        if (update.id && !currentTracking.playbooks.includes(update.id)) {
          currentTracking.playbooks.push(update.id);
        }
        break;
      case "documents":
        if (update.ids) {
          for (const id of update.ids) {
            if (!currentTracking.documents.includes(id)) {
              currentTracking.documents.push(id);
            }
          }
        }
        break;
      case "tools":
        if (update.ids) {
          for (const id of update.ids) {
            if (!currentTracking.tools.includes(id)) {
              currentTracking.tools.push(id);
            }
          }
        }
        break;
    }

    currentTracking.last_context_update = new Date().toISOString();

    // Update orchestration status
    const currentStatus = conversation.orchestration_status || {};
    const updatedStatus: OrchestrationStatus = {
      state: currentStatus.state || "waiting_for_user",
      current_playbook: currentStatus.current_playbook,
      documents_used: currentStatus.documents_used,
      intent_analysis: currentStatus.intent_analysis,
      processing_details: currentStatus.processing_details,
      context_tracking: currentTracking,
      last_updated: new Date().toISOString(),
    };

    await this.conversationService.updateConversation(
      conversationId,
      organizationId,
      { orchestration_status: updatedStatus }
    );
  }

  /**
   * Creates a rich agent system message.
   */
  private createAgentSystemMessage(agent: any): {
    content: string;
    type: MessageType;
    sender: string;
    metadata: Record<string, any>;
  } {
    const systemMessageParts = [];

    systemMessageParts.push(`🤖 ${agent.name} has joined the conversation.`);

    if (agent.description) {
      systemMessageParts.push(`\n📋 **About**: ${agent.description}`);
    }

    if (agent.instructions) {
      systemMessageParts.push(`\n📝 **Instructions**: ${agent.instructions}`);
    }

    if (agent.tone) {
      systemMessageParts.push(`\n🎭 **Communication Style**: ${agent.tone}`);
    }

    if (agent.avoid) {
      systemMessageParts.push(`\n🚫 **Guidelines**: Avoid ${agent.avoid}`);
    }

    return {
      content: systemMessageParts.join(""),
      type: MessageType.SYSTEM,
      sender: "system",
      metadata: {
        agent_id: agent.id,
        agent_name: agent.name,
        reason: "agent_assignment",
      },
    };
  }

  /**
   * Creates a rich playbook system message.
   */
  private createPlaybookSystemMessage(
    playbook: any,
    toolSchemas?: any[]
  ): {
    content: string;
    type: MessageType;
    sender: string;
    metadata: Record<string, any>;
  } {
    const instructions = playbook.instructions || playbook.prompt_template;
    let instructionText = "";
    let referencedActions: string[] = [];
    let referencedDocuments: string[] = [];

    if (isInstructionsJson(instructions)) {
      const analysis = analyzeInstructions(instructions);
      instructionText = analysis.formattedText;
      referencedActions = analysis.actions;
      referencedDocuments = analysis.documents;
    } else {
      instructionText = formatInstructions(instructions);
    }

    let content = `📋 **${playbook.title}** playbook is now active.

**Description:** ${playbook.description || "No description provided"}

**Instructions:**
${instructionText}

**Required Fields:** ${
      playbook.required_fields?.length
        ? playbook.required_fields.join(", ")
        : "None"
    }

**Trigger:** ${playbook.trigger}`;

    // Add referenced actions if any exist
    if (referencedActions.length > 0 && toolSchemas && toolSchemas.length > 0) {
      content += `\n\n**Referenced Actions:**
The following tools are available for you to use. You MUST return only valid JSON when calling tools, with no additional text:`;

      const actionDetails = referencedActions.map((actionName) => {
        let toolSchema = toolSchemas.find(
          (schema) => schema.name === actionName
        );

        if (!toolSchema && actionName.includes(":")) {
          const parts = actionName.split(":");
          if (parts.length >= 2) {
            const toolName = parts[parts.length - 1];
            toolSchema = toolSchemas.find((schema) => schema.name === toolName);

            if (!toolSchema) {
              const toolNameSuffix = parts.slice(1).join(":");
              toolSchema = toolSchemas.find(
                (schema) => schema.name === toolNameSuffix
              );
            }
          }
        }

        if (toolSchema) {
          const requiredFields =
            toolSchema.required && toolSchema.required.length > 0
              ? ` (Required: ${toolSchema.required.join(", ")})`
              : "";
          return `- **${actionName}**: ${
            toolSchema.description
          }${requiredFields}\n  Input Schema: ${JSON.stringify(
            toolSchema.parameters || {},
            null,
            2
          )}`;
        } else {
          return `- **${actionName}**: Action not found in available tools`;
        }
      });

      content += `\n${actionDetails.join("\n\n")}`;
    }

    // Add referenced documents if any exist
    if (referencedDocuments.length > 0) {
      content += `\n\n**Referenced Documents:**
${referencedDocuments.map((document) => `- ${document}`).join("\n")}`;
    }

    return {
      content,
      type: MessageType.SYSTEM,
      sender: "system",
      metadata: {
        path: "playbook",
        playbook_id: playbook.id,
        playbook_title: playbook.title,
        reason: "playbook_assignment",
        tools: toolSchemas?.map((s) => s.name) || [],
        referenced_actions: referencedActions,
        referenced_documents: referencedDocuments,
        confidence: 1.0,
      },
    };
  }

  /**
   * Creates a rich document system message.
   */
  private createDocumentSystemMessage(
    documents: Array<{
      content: string;
      title?: string;
      source?: string;
      similarity?: number;
    }>,
    query: string
  ): {
    content: string;
    type: MessageType;
    sender: string;
    metadata: Record<string, any>;
  } {
    const documentsContext = documents
      .map((result, index) => {
        const title = result.title || `Document ${index + 1}`;
        const source = result.source ? ` (Source: ${result.source})` : "";
        const similarity = result.similarity
          ? result.similarity.toFixed(3)
          : "N/A";

        return `**${title}**${source} (Similarity: ${similarity})
${result.content}`;
      })
      .join("\n\n---\n\n");

    const content = `📚 **Relevant Documents Available**

You have access to the following relevant documents to help answer the user's question. Use this information to provide accurate, detailed, and contextual responses:

${documentsContext}

**Guidelines:**
- Base your answers primarily on the information provided in these documents
- If the answer cannot be found in these documents, clearly indicate that
- You can reference specific documents by their titles when citing information
- When a source URL is available (starts with http:// or https://), include a link in your response using the format [article title or "Read more"](URL)
- Only link to sources when they are relevant to the information you're presenting and when the tutorial or article contains additional useful information
- Provide comprehensive answers using the full context available

**User Query:** "${query}"`;

    return {
      content,
      type: MessageType.SYSTEM,
      sender: "system",
      metadata: {
        path: "docqa",
        reason: "document_context",
        document_count: documents.length,
        confidence:
          documents.length > 0
            ? Math.max(...documents.map((r) => r.similarity || 0))
            : 0,
      },
    };
  }

  /**
   * Creates a rich tool system message.
   */
  private createToolSystemMessage(toolSchemas: any[]): {
    content: string;
    type: MessageType;
    sender: string;
    metadata: Record<string, any>;
  } {
    const content = `🔧 **Available Tools**

You have access to the following tools. When calling a tool, you MUST respond with ONLY valid JSON in the exact format specified, with no additional text:

${toolSchemas
  .map(
    (schema) =>
      `**${schema.name}**
Description: ${schema.description || "No description provided"}
Parameters: ${JSON.stringify(schema.parameters, null, 2)}
Required: ${schema.required || []}`
  )
  .join("\n\n---\n\n")}

**Response format when calling a tool:**
{
  "tool_name": "exact_tool_name",
  "arguments": { 
    // All required parameters and any optional ones you want to include
  }
}`;

    return {
      content,
      type: MessageType.SYSTEM,
      sender: "system",
      metadata: {
        reason: "tool_context",
        tools: toolSchemas.map((s) => s.name),
      },
    };
  }

  /**
   * Creates a simple hash for content identification.
   */
  private hashContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}
