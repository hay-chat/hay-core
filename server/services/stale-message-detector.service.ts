import { AppDataSource } from "../database/data-source";
import { config } from "../config/env";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("stale-message");

/**
 * Grace period after a lock has expired before we treat the conversation as
 * abandoned. The active worker refreshes its lock every 5 seconds; this
 * window must comfortably exceed several missed heartbeats so a momentarily
 * slow worker isn't preempted.
 */
const LOCK_EXPIRY_GRACE_MS = 60_000;

export enum StaleReason {
  LOCK_EXPIRED = "lock_expired",
  NO_RESPONSE_TIMEOUT = "no_response_timeout",
  REPEATED_FAILURES = "repeated_failures",
  ABANDONED_PROCESSING = "abandoned_processing",
  COOLDOWN_STUCK = "cooldown_stuck",
}

/**
 * Shape of a single row returned by the raw stale-conversation detection query.
 * Postgres returns timestamp columns as `Date`, numeric aggregates as strings
 * (e.g. `stale_duration_ms` from `EXTRACT`), and `count`-style columns may come
 * back as either number or string depending on the driver.
 */
interface StaleConversationRow {
  id: string;
  organization_id: string;
  status: string;
  needs_processing: boolean;
  processing_locked_until: Date | null;
  processing_locked_by: string | null;
  cooldown_until: Date | null;
  processing_attempts: number | null;
  processing_error_count: number | null;
  last_processing_error: string | null;
  is_stuck: boolean;
  last_message_at: Date | null;
  last_message_type: string | null;
  last_customer_message_at: Date | null;
  stale_duration_ms: string;
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
      logger.debug("Database not initialized, skipping detection");
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
            -- Lock expired (past grace period) but still in processing status
            OR (status = 'processing' AND processing_locked_until < NOW() - ($2 || ' milliseconds')::interval)
            -- Needs processing but no live lock — grace period covers heartbeat blips
            OR (
              needs_processing = TRUE
              AND (
                processing_locked_until IS NULL
                OR processing_locked_until < NOW() - ($2 || ' milliseconds')::interval
              )
            )
            -- Cooldown expired but not marked for processing
            OR (cooldown_until IS NOT NULL AND cooldown_until < NOW() AND needs_processing = FALSE)
            -- Multiple consecutive failures
            OR (processing_error_count >= 3)
          )
      `;

      const results: StaleConversationRow[] = await AppDataSource.query(query, [
        thresholdDate,
        LOCK_EXPIRY_GRACE_MS,
      ]);

      const staleConversations: StaleConversation[] = results.map((row) => {
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
        logger.debug(
          { total: staleConversations.length, byReason: this.groupByReason(staleConversations) },
          "Found stale conversations",
        );
      }

      return staleConversations;
    } catch (error) {
      logger.error({ err: error }, "Error detecting stale conversations");
      return [];
    }
  }

  /**
   * Determines the specific reason why a conversation is stuck
   */
  private determineStuckReason(row: StaleConversationRow, now: Date): StaleReason {
    const processingErrorCount = row.processing_error_count ?? 0;

    // Already marked as stuck
    if (row.is_stuck === true) {
      // Return the most severe condition
      if (processingErrorCount >= 3) {
        return StaleReason.REPEATED_FAILURES;
      }
    }

    // Check for repeated failures first (highest priority)
    if (processingErrorCount >= 3) {
      return StaleReason.REPEATED_FAILURES;
    }

    const lockExpiryDeadline = new Date(now.getTime() - LOCK_EXPIRY_GRACE_MS);

    // Lock expired (past grace) but still in processing status
    if (
      row.status === "processing" &&
      row.processing_locked_until &&
      new Date(row.processing_locked_until) < lockExpiryDeadline
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

    // Needs processing but no live lock (past grace = abandoned)
    if (
      row.needs_processing === true &&
      (!row.processing_locked_until || new Date(row.processing_locked_until) < lockExpiryDeadline)
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
    return conversations.reduce(
      (acc, conv) => {
        acc[conv.stuckReason] = (acc[conv.stuckReason] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
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
