import { AppDataSource } from "../database/data-source";
import { Conversation } from "../database/entities/conversation.entity";
import { MessageType } from "../database/entities/message.entity";
import { config } from "../config/env";
import { debugLog } from "../lib/debug-logger";

export enum StaleReason {
  LOCK_EXPIRED = "lock_expired",
  NO_RESPONSE_TIMEOUT = "no_response_timeout",
  REPEATED_FAILURES = "repeated_failures",
  ABANDONED_PROCESSING = "abandoned_processing",
  COOLDOWN_STUCK = "cooldown_stuck",
}

export interface StaleConversation {
  conversationId: string;
  organizationId: string;
  status: string;
  stuckReason: StaleReason;
  staleDuration: number; // milliseconds since last customer message
  processingAttempts: number;
  processingErrorCount: number;
  lastProcessingError: string | null;
}

export class StaleMessageDetectorService {
  private readonly thresholdMs: number;

  constructor() {
    this.thresholdMs = config.staleMessageDetection?.thresholdMs || 30000;
  }

  /**
   * Detects conversations that are stuck/stale based on multiple criteria
   */
  async detectStaleConversations(): Promise<StaleConversation[]> {
    if (!AppDataSource?.isInitialized) {
      debugLog("stale-detector", "Database not initialized, skipping detection");
      return [];
    }

    const thresholdDate = new Date(Date.now() - this.thresholdMs);
    const now = new Date();

    try {
      // Query to find potentially stuck conversations
      const query = `
        WITH last_messages AS (
          SELECT
            c.id,
            c.organization_id,
            c.status,
            c.needs_processing,
            c.processing_locked_until,
            c.processing_locked_by,
            c.cooldown_until,
            c.processing_attempts,
            c.processing_error_count,
            c.last_processing_error,
            c.is_stuck,
            c.assigned_user_id,
            c.last_message_at,
            (
              SELECT m.type
              FROM messages m
              WHERE m.conversation_id = c.id
                AND m.type IN ('Customer', 'BotAgent', 'HumanAgent')
              ORDER BY m.created_at DESC
              LIMIT 1
            ) as last_message_type,
            (
              SELECT m.created_at
              FROM messages m
              WHERE m.conversation_id = c.id
                AND m.type = 'Customer'
              ORDER BY m.created_at DESC
              LIMIT 1
            ) as last_customer_message_at
          FROM conversations c
          WHERE c.status IN ('open', 'processing')
            AND c.assigned_user_id IS NULL
        )
        SELECT
          id,
          organization_id,
          status,
          needs_processing,
          processing_locked_until,
          processing_locked_by,
          cooldown_until,
          processing_attempts,
          processing_error_count,
          last_processing_error,
          is_stuck,
          last_message_at,
          last_message_type,
          last_customer_message_at,
          EXTRACT(EPOCH FROM (NOW() - last_customer_message_at)) * 1000 as stale_duration_ms
        FROM last_messages
        WHERE last_message_type = 'Customer'
          AND last_customer_message_at < $1
          AND (
            -- Already marked as stuck
            is_stuck = TRUE
            -- Lock expired but still in processing status
            OR (status = 'processing' AND processing_locked_until < NOW())
            -- Needs processing but no lock held for threshold duration
            OR (needs_processing = TRUE AND (processing_locked_until IS NULL OR processing_locked_until < NOW()))
            -- Cooldown expired but not marked for processing
            OR (cooldown_until IS NOT NULL AND cooldown_until < NOW() AND needs_processing = FALSE)
            -- Multiple consecutive failures
            OR (processing_error_count >= 3)
          )
      `;

      const results = await AppDataSource.query(query, [thresholdDate]);

      const staleConversations: StaleConversation[] = results.map((row: any) => {
        const stuckReason = this.determineStuckReason(row, now);

        return {
          conversationId: row.id,
          organizationId: row.organization_id,
          status: row.status,
          stuckReason,
          staleDuration: parseFloat(row.stale_duration_ms),
          processingAttempts: row.processing_attempts || 0,
          processingErrorCount: row.processing_error_count || 0,
          lastProcessingError: row.last_processing_error,
        };
      });

      if (staleConversations.length > 0) {
        debugLog(
          "stale-detector",
          `Found ${staleConversations.length} stale conversations`,
          {
            total: staleConversations.length,
            byReason: this.groupByReason(staleConversations),
          }
        );
      }

      return staleConversations;
    } catch (error) {
      console.error("[StaleMessageDetector] Error detecting stale conversations:", error);
      return [];
    }
  }

  /**
   * Determines the specific reason why a conversation is stuck
   */
  private determineStuckReason(row: any, now: Date): StaleReason {
    // Already marked as stuck
    if (row.is_stuck === true) {
      // Return the most severe condition
      if (row.processing_error_count >= 3) {
        return StaleReason.REPEATED_FAILURES;
      }
    }

    // Check for repeated failures first (highest priority)
    if (row.processing_error_count >= 3) {
      return StaleReason.REPEATED_FAILURES;
    }

    // Lock expired but still in processing status
    if (
      row.status === "processing" &&
      row.processing_locked_until &&
      new Date(row.processing_locked_until) < now
    ) {
      return StaleReason.LOCK_EXPIRED;
    }

    // Cooldown expired but not requeued
    if (
      row.cooldown_until &&
      new Date(row.cooldown_until) < now &&
      row.needs_processing === false
    ) {
      return StaleReason.COOLDOWN_STUCK;
    }

    // Needs processing but no lock held (abandoned)
    if (
      row.needs_processing === true &&
      (!row.processing_locked_until || new Date(row.processing_locked_until) < now)
    ) {
      return StaleReason.ABANDONED_PROCESSING;
    }

    // Default: No response timeout (customer sent message but no bot response)
    return StaleReason.NO_RESPONSE_TIMEOUT;
  }

  /**
   * Groups stale conversations by their stuck reason
   */
  private groupByReason(conversations: StaleConversation[]): Record<string, number> {
    return conversations.reduce((acc, conv) => {
      acc[conv.stuckReason] = (acc[conv.stuckReason] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  /**
   * Checks if a specific conversation is stuck
   */
  async isConversationStuck(conversationId: string): Promise<boolean> {
    const staleConversations = await this.detectStaleConversations();
    return staleConversations.some((conv) => conv.conversationId === conversationId);
  }
}

// Singleton instance
export const staleMessageDetectorService = new StaleMessageDetectorService();
