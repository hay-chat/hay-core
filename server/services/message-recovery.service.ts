import { ConversationRepository } from "../repositories/conversation.repository";
import { StaleConversation, StaleReason } from "./stale-message-detector.service";
import { config } from "../config/env";
import { createLogger } from "@server/lib/logger";
import { MessageType } from "../database/entities/message.entity";

const logger = createLogger("message-recovery");

export interface RecoveryResult {
  success: boolean;
  action: string;
  error?: string;
  backoffMs?: number;
}

export class MessageRecoveryService {
  private conversationRepository: ConversationRepository;
  private readonly maxRecoveryAttempts: number;

  constructor() {
    this.conversationRepository = new ConversationRepository();
    this.maxRecoveryAttempts = config.staleMessageDetection?.maxRecoveryAttempts || 5;
  }

  /**
   * Main entry point for recovering a stale conversation
   */
  async recoverStaleConversation(
    staleConv: StaleConversation,
    dryRun: boolean = false,
  ): Promise<RecoveryResult> {
    const conversation = await this.conversationRepository.findById(staleConv.conversationId);
    if (!conversation) {
      return { success: false, action: "conversation_not_found" };
    }

    logger.info(
      {
        conversationId: staleConv.conversationId,
        reason: staleConv.stuckReason,
        staleDuration: staleConv.staleDuration,
        attempts: staleConv.processingAttempts,
        errors: staleConv.processingErrorCount,
      },
      "Attempting recovery for conversation",
    );

    if (dryRun) {
      return { success: true, action: "dry_run" };
    }

    try {
      // Check if we should escalate to human
      const recoveryAttempts = conversation.recovery_attempts || 0;
      if (recoveryAttempts >= this.maxRecoveryAttempts) {
        return await this.escalateToHuman(conversation, staleConv.stuckReason);
      }

      // Increment recovery attempts
      await this.conversationRepository.updateById(conversation.id, {
        recovery_attempts: recoveryAttempts + 1,
        last_recovery_attempt_at: new Date(),
      });

      // Apply recovery strategy based on stuck reason
      let result: RecoveryResult;
      switch (staleConv.stuckReason) {
        case StaleReason.LOCK_EXPIRED:
          result = await this.recoverFromLockExpiry(conversation);
          break;

        case StaleReason.NO_RESPONSE_TIMEOUT:
          result = await this.recoverFromNoResponseTimeout(conversation);
          break;

        case StaleReason.REPEATED_FAILURES:
          result = await this.recoverFromRepeatedFailures(conversation);
          break;

        case StaleReason.ABANDONED_PROCESSING:
          result = await this.recoverFromAbandonedProcessing(conversation);
          break;

        case StaleReason.COOLDOWN_STUCK:
          result = await this.recoverFromCooldownStuck(conversation);
          break;

        default:
          return { success: false, action: "unknown_stuck_reason" };
      }

      // Enqueue for RabbitMQ processing after successful recovery
      if (result.success) {
        const { orchestratorQueueService } = await import("./orchestrator-queue.service");
        await orchestratorQueueService.enqueue(
          staleConv.conversationId,
          conversation.organization_id,
          "recovery",
        );
      }

      return result;
    } catch (error) {
      logger.error(
        { err: error, conversationId: staleConv.conversationId },
        "Recovery failed for conversation",
      );
      return {
        success: false,
        action: "recovery_error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Recover from expired lock
   */
  private async recoverFromLockExpiry(conversation: any): Promise<RecoveryResult> {
    await this.conversationRepository.updateById(conversation.id, {
      processing_locked_until: null,
      processing_locked_by: null,
      status: "open",
      needs_processing: true,
      is_stuck: false,
      stuck_detected_at: null,
      stuck_reason: null,
    });

    logger.debug({ conversationId: conversation.id }, "Cleared expired lock for conversation");
    return { success: true, action: "cleared_lock_and_requeued" };
  }

  /**
   * Recover from no response timeout
   */
  private async recoverFromNoResponseTimeout(conversation: any): Promise<RecoveryResult> {
    await this.conversationRepository.updateById(conversation.id, {
      needs_processing: true,
      status: "open",
      is_stuck: false,
      stuck_detected_at: null,
      stuck_reason: null,
    });

    logger.debug({ conversationId: conversation.id }, "Requeued conversation after timeout");
    return { success: true, action: "requeued_for_processing" };
  }

  /**
   * Recover from repeated failures with exponential backoff
   */
  private async recoverFromRepeatedFailures(conversation: any): Promise<RecoveryResult> {
    const errorCount = conversation.processing_error_count || 0;

    // Escalate to human after threshold
    if (errorCount >= this.maxRecoveryAttempts) {
      return await this.escalateToHuman(conversation, StaleReason.REPEATED_FAILURES);
    }

    // Calculate exponential backoff: 1s, 2s, 4s, 8s, 16s (max 60s)
    const backoffDelay = Math.min(1000 * Math.pow(2, errorCount), 60000);

    logger.debug(
      {
        conversationId: conversation.id,
        errorCount,
        backoffMs: backoffDelay,
      },
      "Applying backoff for conversation",
    );

    // Wait for backoff period
    await new Promise((resolve) => setTimeout(resolve, backoffDelay));

    // Retry
    await this.conversationRepository.updateById(conversation.id, {
      needs_processing: true,
      status: "open",
      processing_locked_until: null,
      processing_locked_by: null,
      is_stuck: false,
      stuck_detected_at: null,
      stuck_reason: null,
    });

    return {
      success: true,
      action: "retry_with_backoff",
      backoffMs: backoffDelay,
    };
  }

  /**
   * Recover from abandoned processing state
   */
  private async recoverFromAbandonedProcessing(conversation: any): Promise<RecoveryResult> {
    await this.conversationRepository.updateById(conversation.id, {
      needs_processing: true,
      status: "open",
      processing_locked_until: null,
      processing_locked_by: null,
      is_stuck: false,
      stuck_detected_at: null,
      stuck_reason: null,
    });

    logger.debug(
      { conversationId: conversation.id },
      "Reset abandoned processing for conversation",
    );
    return { success: true, action: "reset_and_requeued" };
  }

  /**
   * Recover from stuck cooldown
   */
  private async recoverFromCooldownStuck(conversation: any): Promise<RecoveryResult> {
    await this.conversationRepository.updateById(conversation.id, {
      cooldown_until: null,
      needs_processing: true,
      is_stuck: false,
      stuck_detected_at: null,
      stuck_reason: null,
    });

    logger.debug({ conversationId: conversation.id }, "Cleared cooldown for conversation");
    return { success: true, action: "cleared_cooldown_and_requeued" };
  }

  /**
   * Escalate conversation to human agent
   */
  private async escalateToHuman(conversation: any, reason: string): Promise<RecoveryResult> {
    // Set status to pending-human
    await this.conversationRepository.updateById(conversation.id, {
      status: "pending-human",
      is_stuck: false,
      stuck_detected_at: null,
      stuck_reason: null,
      needs_processing: false,
    });

    // Add customer-facing message
    await conversation.addMessage({
      content:
        "We're having technical difficulties processing your request. A human agent will assist you shortly.",
      type: MessageType.BOT_AGENT,
      metadata: {
        isEscalation: true,
        escalationReason: reason,
        timestamp: new Date().toISOString(),
      },
    });

    // Add system message for internal visibility
    await conversation.addMessage({
      content: `Conversation escalated to human due to: ${reason}. Processing errors: ${conversation.processing_error_count}. Last error: ${conversation.last_processing_error || "N/A"}`,
      type: MessageType.SYSTEM,
      metadata: {
        isEscalation: true,
        escalationReason: reason,
        processingErrors: conversation.processing_error_count,
        lastError: conversation.last_processing_error,
        recoveryAttempts: conversation.recovery_attempts,
        timestamp: new Date().toISOString(),
      },
    });

    // Broadcast alert to organization
    await this.publishStuckConversationAlert(conversation);

    logger.info(
      {
        conversationId: conversation.id,
        reason,
        errorCount: conversation.processing_error_count,
        lastError: conversation.last_processing_error,
      },
      "Escalated conversation to human",
    );

    return {
      success: true,
      action: "escalated_to_human",
    };
  }

  /**
   * Publish alert about stuck conversation to organization
   */
  private async publishStuckConversationAlert(conversation: any): Promise<void> {
    try {
      const { conversationEventsService } = await import("./conversation-events.service");

      await conversationEventsService.broadcastConversationUpdated(
        conversation,
        ["status"], // This will automatically trigger conversation_status_changed event
      );

      logger.debug({ conversationId: conversation.id }, "Published stuck conversation alert");
    } catch (error) {
      logger.error({ err: error }, "Failed to publish stuck conversation alert");
    }
  }

  /**
   * Manually trigger recovery for a specific conversation
   */
  async manualRecovery(conversationId: string, organizationId: string): Promise<RecoveryResult> {
    const conversation = await this.conversationRepository.findByIdAndOrganization(
      conversationId,
      organizationId,
    );

    if (!conversation) {
      return { success: false, action: "conversation_not_found" };
    }

    // Force reset conversation state
    await this.conversationRepository.updateById(conversation.id, {
      processing_locked_until: null,
      processing_locked_by: null,
      needs_processing: true,
      status: "open",
      is_stuck: false,
      stuck_detected_at: null,
      stuck_reason: null,
      cooldown_until: null,
      processing_error_count: 0,
      last_processing_error: null,
      last_processing_error_at: null,
      recovery_attempts: 0,
    });

    logger.info({ conversationId }, "Manual recovery completed for conversation");

    // Enqueue for RabbitMQ processing
    const { orchestratorQueueService } = await import("./orchestrator-queue.service");
    await orchestratorQueueService.enqueue(conversationId, organizationId, "recovery");

    return {
      success: true,
      action: "manual_recovery_complete",
    };
  }
}

// Singleton instance
export const messageRecoveryService = new MessageRecoveryService();
