import type { OrchestrationPlan, IntentAnalysis } from "./types";
import { PlaybookService } from "../playbook.service";
import { VectorStoreService } from "../vector-store.service";
import { PlaybookMatcher } from "./playbook-matcher";
import { StatusManager } from "./status-manager";
import { ConversationService } from "../conversation.service";
import { MessageType } from "../../database/entities/message.entity";

/**
 * Creates orchestration plans for conversation routing.
 * Uses dynamic playbook matching for every user message.
 */
export class PlanCreation {
  private playbookMatcher: PlaybookMatcher;
  private statusManager: StatusManager;

  /**
   * Creates a new PlanCreation instance.
   * @param playbookService - Service for managing playbooks
   * @param vectorStoreService - Service for vector-based document retrieval
   * @param conversationService - Service for conversation management
   */
  constructor(
    private playbookService: PlaybookService,
    private vectorStoreService: VectorStoreService,
    private conversationService?: ConversationService
  ) {
    this.playbookMatcher = new PlaybookMatcher(playbookService);
    this.statusManager = new StatusManager(conversationService || {} as ConversationService);
  }

  /**
   * Creates an orchestration plan based on user message and conversation context.
   * Dynamically selects the best playbook for each message.
   * @param userMessage - The user's message
   * @param conversation - The current conversation object
   * @param organizationId - The ID of the organization
   * @param messages - Array of conversation messages for context
   * @returns The orchestration plan determining execution path
   */
  async createPlan(
    userMessage: string,
    conversation: any,
    organizationId: string,
    messages?: any[]
  ): Promise<OrchestrationPlan> {
    console.log(`[Orchestrator] Creating plan for message: "${userMessage.substring(0, 50)}..."`);

    // Update status to analyzing intent
    if (this.conversationService) {
      await this.statusManager.startIntentAnalysis(
        conversation.id,
        organizationId
      );
    }

    // Build conversation history for context
    const conversationHistory = messages ? this.buildConversationHistory(messages) : undefined;

    // Use PlaybookMatcher to dynamically select the best playbook
    const { playbook, intentAnalysis, switched, confidence, reasoning } = await this.playbookMatcher.selectPlaybook(
      userMessage,
      organizationId,
      conversationHistory,
      conversation.playbook_id
    );

    // Update conversation with intent analysis
    if (this.conversationService) {
      await this.statusManager.setIntentAnalysis(
        conversation.id,
        organizationId,
        intentAnalysis
      );

      // If a playbook was selected, update the status with selection details
      if (playbook) {
        await this.statusManager.setCurrentPlaybook(
          conversation.id,
          organizationId,
          {
            id: playbook.id,
            title: playbook.title,
            trigger: playbook.trigger,
            started_at: new Date().toISOString(),
            selection_confidence: confidence,
            selection_reasoning: reasoning
          }
        );
      }
    }

    // If a playbook switch occurred, check if it's allowed
    if (switched && conversation.playbook_id) {
      const currentPlaybook = await this.playbookService.getPlaybook(
        conversation.playbook_id,
        organizationId
      );

      if (currentPlaybook && !this.playbookMatcher.shouldAllowSwitch(currentPlaybook, playbook)) {
        console.log(`[Orchestrator] Playbook switch not allowed, continuing with current playbook`);
        return {
          path: "playbook",
          agentId: conversation.agent_id,
          playbookId: conversation.playbook_id,
          requiredFields: currentPlaybook.required_fields || []
        };
      }
    }

    // Update conversation with new playbook if switched or first-time assignment
    if (switched && playbook && this.conversationService) {
      await this.conversationService.updateConversation(
        conversation.id,
        organizationId,
        { playbook_id: playbook.id }
      );

      // Create system message for playbook switch/assignment
      await this.createPlaybookSystemMessage(
        conversation.id,
        organizationId,
        playbook,
        conversation.playbook_id // previous playbook ID (could be null for first assignment)
      );
    }

    // Handle first-time playbook assignment when no switching occurred but playbook is selected
    if (!switched && playbook && !conversation.playbook_id && this.conversationService) {
      await this.conversationService.updateConversation(
        conversation.id,
        organizationId,
        { playbook_id: playbook.id }
      );

      // Create system message for first-time playbook assignment
      await this.createPlaybookSystemMessage(
        conversation.id,
        organizationId,
        playbook,
        undefined // no previous playbook
      );
    }

    // Check if we should use document retrieval based on intent
    const useDocQA = await this.shouldUseDocumentRetrieval(
      userMessage,
      organizationId,
      intentAnalysis
    );
    
    if (useDocQA) {
      console.log(`[Orchestrator] Using document retrieval path`);
      return {
        path: "docqa",
        agentId: conversation.agent_id,
        requiredFields: []
      };
    }
    
    // Use the selected playbook
    if (playbook) {
      console.log(`[Orchestrator] Using playbook: ${playbook.title} (${playbook.trigger})`);
      return {
        path: "playbook",
        agentId: conversation.agent_id,
        playbookId: playbook.id,
        requiredFields: playbook.required_fields || []
      };
    }

    // Fallback to default if no playbook found
    console.log(`[Orchestrator] No suitable playbook found, using default`);
    return {
      path: "playbook",
      agentId: conversation.agent_id,
      requiredFields: []
    };
  }

  /**
   * Builds a formatted conversation history string from messages.
   * @param messages - Array of conversation messages
   * @returns Formatted conversation history string
   */
  private buildConversationHistory(messages: any[]): string {
    return messages.map(msg => {
      if (msg.type === MessageType.CUSTOMER) {
        return `User: ${msg.content}`;
      } else if (msg.type === MessageType.BOT_AGENT) {
        return `Assistant: ${msg.content}`;
      }
      return null;
    }).filter(Boolean).join('\n');
  }

  /**
   * Determines if document retrieval should be used based on LLM analysis.
   * Uses AI to decide whether the message would benefit from document search.
   * @param userMessage - The user's message to analyze
   * @param organizationId - The ID of the organization
   * @param intentAnalysis - Optional intent analysis results
   * @returns True if document retrieval should be used
   */
  private async shouldUseDocumentRetrieval(
    userMessage: string, 
    organizationId: string,
    intentAnalysis?: IntentAnalysis
  ): Promise<boolean> {
    try {
      // Use LLM to determine if this message would benefit from document search
      const { Hay } = await import("../hay.service");
      Hay.init();

      const systemPrompt = `You are a routing assistant. Determine if a user's message would benefit from searching through documentation and knowledge base articles.

Messages that benefit from document search:
- Questions about how to use features
- Requests for specific information or explanations
- Technical questions that might be in documentation
- Questions about processes or procedures

Messages that do NOT need document search:
- General greetings
- Simple confirmations
- Customer service requests (billing, account issues)
- Complaints that need human attention
- Already specific and don't need additional information

Respond with JSON: {"use_documents": true/false, "reasoning": "explanation"}`;

      const response = await Hay.invokeWithSystemPrompt(
        systemPrompt,
        `User message: ${userMessage}`
      );

      const analysis = JSON.parse(response.content);
      
      if (analysis.use_documents) {
        // Try a quick search to see if we actually have relevant documents
        try {
          if (!this.vectorStoreService.initialized) {
            await this.vectorStoreService.initialize();
          }
          
          const quickSearch = await this.vectorStoreService.search(
            organizationId,
            userMessage,
            1
          );
          
          // If we find highly relevant documents (similarity > 0.7), use docqa path
          if (quickSearch.length > 0 && (quickSearch[0].similarity || 0) > 0.7) {
            console.log(`[Orchestrator] High relevance document found (${quickSearch[0].similarity}), using docqa path`);
            return true;
          }
        } catch (error) {
          console.error(`[Orchestrator] Error checking for documents:`, error);
        }
      }

      return false;
    } catch (error) {
      console.error(`[Orchestrator] Error in document retrieval decision:`, error);
      return false;
    }
  }

  /**
   * Creates a system message when a playbook is switched or assigned for the first time.
   * Only creates a message if switching to a different playbook to prevent duplicates.
   * @param conversationId - The conversation ID
   * @param organizationId - The organization ID
   * @param playbook - The new playbook being assigned
   * @param previousPlaybookId - The previous playbook ID (if any)
   */
  private async createPlaybookSystemMessage(
    conversationId: string,
    organizationId: string,
    playbook: any,
    previousPlaybookId?: string
  ): Promise<void> {
    if (!this.conversationService) {
      return;
    }

    try {
      // Check if we already have a system message for this specific playbook to prevent duplicates
      const existingMessages = await this.conversationService.getMessages(conversationId);
      const hasPlaybookMessage = existingMessages.some(
        msg => msg.type === MessageType.SYSTEM && 
               msg.metadata && 
               typeof msg.metadata === 'object' && 
               'reason' in msg.metadata && 
               msg.metadata.reason === "playbook_assignment" &&
               'playbook_id' in msg.metadata &&
               msg.metadata.playbook_id === playbook.id
      );

      if (hasPlaybookMessage) {
        console.log(`[PlanCreation] Playbook system message already exists for playbook ${playbook.id}, skipping duplicate`);
        return;
      }

      // Create system message with playbook information
      const systemMessageParts = [];
      
      // Add playbook activation message
      if (previousPlaybookId) {
        systemMessageParts.push(`📋 Switched to **${playbook.title}** playbook.`);
      } else {
        systemMessageParts.push(`📋 **${playbook.title}** playbook is now active.`);
      }
      
      if (playbook.description) {
        systemMessageParts.push(`\n📝 **About**: ${playbook.description}`);
      }

      // Add trigger information
      if (playbook.trigger) {
        systemMessageParts.push(`\n🎯 **Trigger**: ${playbook.trigger}`);
      }

      // Add instructions if available (show first 200 characters)
      if (playbook.instructions) {
        const instructionText = typeof playbook.instructions === 'object' 
          ? playbook.instructions.text || JSON.stringify(playbook.instructions)
          : playbook.instructions;
        const truncatedInstructions = instructionText.length > 200 
          ? `${instructionText.substring(0, 200)}...`
          : instructionText;
        systemMessageParts.push(`\n📖 **Instructions**: ${truncatedInstructions}`);
      }

      // Add required fields if any
      if (playbook.required_fields && playbook.required_fields.length > 0) {
        systemMessageParts.push(`\n✅ **Required Info**: ${playbook.required_fields.join(', ')}`);
      }

      const systemMessage = systemMessageParts.join('');

      // Add the system message to the conversation
      await this.conversationService.addMessage(conversationId, organizationId, {
        content: systemMessage,
        type: MessageType.SYSTEM,
        sender: "system",
        metadata: {
          playbook_id: playbook.id,
          playbook_title: playbook.title,
          previous_playbook_id: previousPlaybookId,
          reason: "playbook_assignment"
        }
      });

      const actionText = previousPlaybookId ? "switched to" : "activated";
      console.log(`[PlanCreation] ✅ Playbook ${playbook.title} (${playbook.id}) ${actionText} for conversation ${conversationId} with system message`);
    } catch (error) {
      console.error(`[PlanCreation] Error creating playbook system message:`, error);
    }
  }

}