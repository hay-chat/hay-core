import type { OrchestrationPlan } from "./types";
import { PlaybookService } from "../playbook.service";
import { VectorStoreService } from "../vector-store.service";

/**
 * Creates orchestration plans for conversation routing.
 * Determines whether to use playbooks, document retrieval, or human escalation.
 */
export class PlanCreation {
  /**
   * Creates a new PlanCreation instance.
   * @param playbookService - Service for managing playbooks
   * @param vectorStoreService - Service for vector-based document retrieval
   */
  constructor(
    private playbookService: PlaybookService,
    private vectorStoreService: VectorStoreService
  ) {}

  /**
   * Creates an orchestration plan based on user message and conversation context.
   * Prioritizes human assistance requests, then document retrieval, then playbooks.
   * @param userMessage - The user's message
   * @param conversation - The current conversation object
   * @param organizationId - The ID of the organization
   * @returns The orchestration plan determining execution path
   */
  async createPlan(
    userMessage: string,
    conversation: any,
    organizationId: string
  ): Promise<OrchestrationPlan> {
    // First check if user is requesting human assistance
    if (this.isHumanAssistanceRequest(userMessage)) {
      console.log(`[Orchestrator] Detected human assistance request, using human escalation playbook`);
      
      const humanEscalationPlaybook = await this.findHumanEscalationPlaybook(organizationId);
      
      if (humanEscalationPlaybook) {
        return {
          path: "playbook",
          agentId: conversation.agent_id,
          playbookId: humanEscalationPlaybook.id,
          requiredFields: [],
        };
      }
    }
    
    // Check if we should use document retrieval or playbook path
    const useDocQA = await this.shouldUseDocumentRetrieval(userMessage, organizationId);
    
    if (useDocQA) {
      return {
        path: "docqa",
        agentId: conversation.agent_id,
        requiredFields: [],
      };
    }
    
    // Otherwise use playbook path
    const playbookId = await this.selectPlaybook(conversation, organizationId);
    
    console.log(`[Orchestrator] Selected playbook path with playbook: ${playbookId || 'none'}`);

    return {
      path: "playbook",
      agentId: conversation.agent_id,
      playbookId: playbookId,
      requiredFields: [],
    };
  }

  /**
   * Detects if the user is requesting human assistance.
   * Checks for patterns indicating desire to speak with a human.
   * @param userMessage - The user's message to analyze
   * @returns True if human assistance is requested
   */
  private isHumanAssistanceRequest(userMessage: string): boolean {
    const humanRequestPatterns = [
      /\b(speak|talk|chat)\s+(to|with)\s+(a\s+)?(human|person|agent|representative|someone)/i,
      /\b(want|need|like)\s+(a\s+)?(human|person|agent|representative)/i,
      /transfer\s+me/i,
      /real\s+person/i,
      /live\s+support/i,
      /customer\s+service/i
    ];
    
    return humanRequestPatterns.some(pattern => pattern.test(userMessage));
  }

  /**
   * Finds the active human escalation playbook for the organization.
   * @param organizationId - The ID of the organization
   * @returns The human escalation playbook if found
   */
  private async findHumanEscalationPlaybook(organizationId: string): Promise<any> {
    const playbooks = await this.playbookService.getPlaybooks(organizationId);
    return playbooks.find(
      p => p.trigger === 'human_escalation' && p.status === 'active'
    );
  }

  /**
   * Determines if document retrieval should be used based on message content.
   * Checks for question patterns and searches for relevant documents.
   * @param userMessage - The user's message to analyze
   * @param organizationId - The ID of the organization
   * @returns True if document retrieval should be used
   */
  private async shouldUseDocumentRetrieval(userMessage: string, organizationId: string): Promise<boolean> {
    // Keywords that suggest document retrieval
    const docQAKeywords = [
      /how (do|can|to)/i,
      /what (is|are|does)/i,
      /explain/i,
      /documentation/i,
      /guide/i,
      /tutorial/i,
      /help with/i,
      /information about/i,
      /tell me about/i
    ];
    
    // Check if message matches document retrieval patterns
    if (!docQAKeywords.some(pattern => pattern.test(userMessage))) {
      return false;
    }

    // Try a quick search to see if we have relevant documents
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

    return false;
  }

  /**
   * Selects an appropriate playbook for the conversation.
   * Uses existing playbook or falls back to welcome playbook.
   * @param conversation - The current conversation object
   * @param organizationId - The ID of the organization
   * @returns The selected playbook ID if found
   */
  private async selectPlaybook(conversation: any, organizationId: string): Promise<string | undefined> {
    // Check if conversation already has a playbook
    let playbookId = conversation.playbook_id;
    
    // If no playbook assigned, try to find a default one
    if (!playbookId) {
      const playbooks = await this.playbookService.getPlaybooks(organizationId);
      const welcomePlaybook = playbooks.find(
        (p) => p.kind === "welcome" && p.status === "active"
      );
      
      if (welcomePlaybook) {
        playbookId = welcomePlaybook.id;
      }
    }

    return playbookId;
  }
}