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

    // Update conversation with new playbook if switched
    if (switched && playbook && this.conversationService) {
      await this.conversationService.updateConversation(
        conversation.id,
        organizationId,
        { playbook_id: playbook.id }
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

}