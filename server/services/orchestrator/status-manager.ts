import { ConversationService } from "../conversation.service";
import type { 
  OrchestrationStatus, 
  OrchestrationState, 
  PlaybookStatus,
  DocumentUsed,
  IntentAnalysis,
  ProcessingDetails
} from "./types";

/**
 * Manages orchestration status updates for conversations.
 * Provides real-time visibility into AI processing state.
 */
export class StatusManager {
  /**
   * Creates a new StatusManager instance.
   * @param conversationService - Service for conversation management
   */
  constructor(
    private conversationService: ConversationService
  ) {}

  /**
   * Updates the orchestration status for a conversation.
   * @param conversationId - The conversation ID
   * @param organizationId - The organization ID
   * @param status - The new orchestration status
   */
  async updateStatus(
    conversationId: string,
    organizationId: string,
    status: Partial<OrchestrationStatus>
  ): Promise<void> {
    try {
      // Get current status
      const conversation = await this.conversationService.getConversation(
        conversationId,
        organizationId
      );

      if (!conversation) {
        console.error(`[StatusManager] Conversation ${conversationId} not found`);
        return;
      }

      // Merge with existing status
      const currentStatus = conversation.orchestration_status || {};
      const updatedStatus: OrchestrationStatus = {
        state: "waiting_for_user" as OrchestrationState,
        ...currentStatus,
        ...status,
        last_updated: new Date().toISOString()
      };

      // Update conversation with new status
      await this.conversationService.updateConversation(
        conversationId,
        organizationId,
        {
          orchestration_status: updatedStatus
        }
      );

      console.log(`[StatusManager] Updated status for conversation ${conversationId}: state=${updatedStatus.state}`);
    } catch (error) {
      console.error(`[StatusManager] Error updating status for conversation ${conversationId}:`, error);
    }
  }

  /**
   * Sets the processing state of a conversation.
   * @param conversationId - The conversation ID
   * @param organizationId - The organization ID
   * @param state - The new orchestration state
   */
  async setState(
    conversationId: string,
    organizationId: string,
    state: OrchestrationState
  ): Promise<void> {
    await this.updateStatus(conversationId, organizationId, { state });
  }

  /**
   * Updates the current playbook information.
   * @param conversationId - The conversation ID
   * @param organizationId - The organization ID
   * @param playbook - The playbook information
   */
  async setCurrentPlaybook(
    conversationId: string,
    organizationId: string,
    playbook: PlaybookStatus | undefined
  ): Promise<void> {
    await this.updateStatus(conversationId, organizationId, { 
      current_playbook: playbook 
    });
  }

  /**
   * Updates the documents used in the response.
   * @param conversationId - The conversation ID
   * @param organizationId - The organization ID
   * @param documents - Array of documents used
   */
  async setDocumentsUsed(
    conversationId: string,
    organizationId: string,
    documents: DocumentUsed[]
  ): Promise<void> {
    await this.updateStatus(conversationId, organizationId, { 
      documents_used: documents 
    });
  }

  /**
   * Updates the intent analysis results.
   * @param conversationId - The conversation ID
   * @param organizationId - The organization ID
   * @param analysis - The intent analysis
   */
  async setIntentAnalysis(
    conversationId: string,
    organizationId: string,
    analysis: IntentAnalysis
  ): Promise<void> {
    await this.updateStatus(conversationId, organizationId, { 
      intent_analysis: analysis 
    });
  }

  /**
   * Updates processing details like locks and cooldowns.
   * @param conversationId - The conversation ID
   * @param organizationId - The organization ID
   * @param details - Processing details
   */
  async setProcessingDetails(
    conversationId: string,
    organizationId: string,
    details: ProcessingDetails
  ): Promise<void> {
    await this.updateStatus(conversationId, organizationId, { 
      processing_details: details 
    });
  }

  /**
   * Clears the orchestration status (e.g., when conversation ends).
   * @param conversationId - The conversation ID
   * @param organizationId - The organization ID
   */
  async clearStatus(
    conversationId: string,
    organizationId: string
  ): Promise<void> {
    await this.conversationService.updateConversation(
      conversationId,
      organizationId,
      {
        orchestration_status: {
          state: "waiting_for_user",
          last_updated: new Date().toISOString()
        }
      }
    );

    console.log(`[StatusManager] Cleared status for conversation ${conversationId}`);
  }

  /**
   * Sets an error state with details.
   * @param conversationId - The conversation ID
   * @param organizationId - The organization ID
   * @param error - Error message or details
   */
  async setError(
    conversationId: string,
    organizationId: string,
    error: string
  ): Promise<void> {
    await this.updateStatus(conversationId, organizationId, {
      state: "error",
      processing_details: {
        error
      }
    });
  }

  /**
   * Helper to track the start of playbook execution.
   * @param conversationId - The conversation ID
   * @param organizationId - The organization ID
   * @param playbook - The playbook being executed
   */
  async startPlaybookExecution(
    conversationId: string,
    organizationId: string,
    playbook: { id: string; title: string; trigger: string }
  ): Promise<void> {
    await this.updateStatus(conversationId, organizationId, {
      state: "executing_playbook",
      current_playbook: {
        id: playbook.id,
        title: playbook.title,
        trigger: playbook.trigger,
        started_at: new Date().toISOString()
      }
    });
  }

  /**
   * Helper to track document search.
   * @param conversationId - The conversation ID
   * @param organizationId - The organization ID
   */
  async startDocumentSearch(
    conversationId: string,
    organizationId: string
  ): Promise<void> {
    await this.setState(conversationId, organizationId, "searching_documents");
  }

  /**
   * Helper to track intent analysis.
   * @param conversationId - The conversation ID
   * @param organizationId - The organization ID
   */
  async startIntentAnalysis(
    conversationId: string,
    organizationId: string
  ): Promise<void> {
    await this.setState(conversationId, organizationId, "analyzing_intent");
  }

  /**
   * Helper to set processing state with lock details.
   * @param conversationId - The conversation ID
   * @param organizationId - The organization ID
   * @param instanceId - The instance ID that holds the lock
   * @param lockUntil - When the lock expires
   */
  async setProcessingLock(
    conversationId: string,
    organizationId: string,
    instanceId: string,
    lockUntil: Date
  ): Promise<void> {
    await this.updateStatus(conversationId, organizationId, {
      state: "processing",
      processing_details: {
        locked_by: instanceId,
        locked_until: lockUntil.toISOString()
      }
    });
  }

  /**
   * Helper to set cooldown state.
   * @param conversationId - The conversation ID
   * @param organizationId - The organization ID
   * @param cooldownUntil - When the cooldown expires
   */
  async setCooldown(
    conversationId: string,
    organizationId: string,
    cooldownUntil: Date
  ): Promise<void> {
    await this.updateStatus(conversationId, organizationId, {
      state: "cooldown",
      processing_details: {
        cooldown_until: cooldownUntil.toISOString()
      }
    });
  }
}