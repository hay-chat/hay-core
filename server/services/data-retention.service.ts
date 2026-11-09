import { allowStorageWaitInTransaction } from "@server/database/session-limits";
import { AppDataSource } from "@server/database/data-source";
import { Conversation } from "@server/database/entities/conversation.entity";
import { AuditLog } from "@server/entities/audit-log.entity";
import { createLogger } from "@server/lib/logger";
import { anonymizeConversations } from "./conversation-anonymizer";
import { deleteConversationMedia } from "./conversation-media.service";

const logger = createLogger("data-retention");

/** Rows handled per transaction, and transactions per organization per run. */
const RETENTION_BATCH_SIZE = 200;
const RETENTION_MAX_BATCHES = 100;
/** Insight text outlives conversations by this factor (RETENTION.md gives the basis). */
const INSIGHT_RETENTION_MULTIPLIER = 2;

interface RetentionOrganization {
  id: string;
  retentionDays: number;
}

/** Organizations with a retention setting; every other organization is never touched. */
async function organizationsWithRetention(): Promise<RetentionOrganization[]> {
  const rows: Array<{ id: string; retention_days: number }> = await AppDataSource.query(
    `SELECT id, (settings->>'retentionDays')::int AS retention_days
     FROM organizations
     WHERE CASE WHEN (settings->>'retentionDays') ~ '^[0-9]+$'
                THEN (settings->>'retentionDays')::int > 0
                ELSE false END`,
  );
  return rows.map((row) => ({ id: row.id, retentionDays: row.retention_days }));
}

function cutoffFor(retentionDays: number): Date {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  return cutoff;
}

/**
 * Data Retention Service
 *
 * Automatic expiry based on each organization's `retentionDays`: conversations
 * become anonymous analytics rows (see anonymizeConversations) and customers
 * left without a live conversation are deleted. Organizations without the
 * setting are skipped, and legal hold always wins.
 */
export class DataRetentionService {
  /**
   * Anonymize expired conversations for all organizations with retention
   * policies. Runs in batches, each in its own transaction with its audit row,
   * so a large backlog progresses and a later failure keeps earlier work.
   */
  async anonymizeExpiredConversations(): Promise<{
    organizationsProcessed: number;
    conversationsAnonymized: number;
    messagesDeleted: number;
    embeddingsDeleted: number;
    mediaDeleted: number;
  }> {
    const totals = {
      organizationsProcessed: 0,
      conversationsAnonymized: 0,
      messagesDeleted: 0,
      embeddingsDeleted: 0,
      mediaDeleted: 0,
    };

    const organizations = await organizationsWithRetention();
    logger.debug(`Found ${organizations.length} organizations with retention policies`);

    for (const organization of organizations) {
      totals.organizationsProcessed++;
      try {
        for (let batch = 0; batch < RETENTION_MAX_BATCHES; batch++) {
          const handled = await this.anonymizeBatch(organization, totals);
          if (handled < RETENTION_BATCH_SIZE) break;
        }
      } catch (error) {
        await this.recordFailure(organization, "retention.cleanup", error);
      }
    }

    logger.debug(totals, "Data retention cleanup complete");
    return totals;
  }

  private async anonymizeBatch(
    organization: RetentionOrganization,
    totals: {
      conversationsAnonymized: number;
      messagesDeleted: number;
      embeddingsDeleted: number;
      mediaDeleted: number;
    },
  ): Promise<number> {
    const cutoff = cutoffFor(organization.retentionDays);

    return AppDataSource.transaction(async (manager) => {
      await allowStorageWaitInTransaction(manager);
      // Locked so a conversation reopened right now is either waited for or skipped.
      const rows: Array<{ id: string }> = await manager.query(
        `SELECT id FROM conversations
         WHERE organization_id = $1
           AND deleted_at IS NULL
           AND legal_hold = false
           AND status IN ('closed', 'resolved', 'unresolved')
           AND ((closed_at IS NOT NULL AND closed_at < $2)
                OR (closed_at IS NULL AND created_at < $2))
         LIMIT $3
         FOR UPDATE SKIP LOCKED`,
        [organization.id, cutoff, RETENTION_BATCH_SIZE],
      );
      if (!rows.length) return 0;
      const conversationIds = rows.map((row) => row.id);

      // Before the messages, whose attachments name uploads stored before linking existed.
      const media = await deleteConversationMedia({
        organizationId: organization.id,
        conversationIds,
      });
      const result = await anonymizeConversations(manager, organization.id, conversationIds, {
        title: "[Anonymized]",
        deleteInsightIssues: false,
      });

      await manager.getRepository(AuditLog).save(
        AuditLog.createLog({
          organizationId: organization.id,
          action: "retention.cleanup",
          metadata: {
            conversationsAnonymized: result.conversationsAnonymized,
            messagesDeleted: result.messagesDeleted,
            embeddingsDeleted: result.embeddingsDeleted,
            mediaDeleted: media.deleted,
            mediaFailed: media.failed,
            retentionDays: organization.retentionDays,
            cutoffDate: cutoff.toISOString(),
            conversationIds,
          },
          status: "success",
        }),
      );

      totals.conversationsAnonymized += result.conversationsAnonymized;
      totals.messagesDeleted += result.messagesDeleted;
      totals.embeddingsDeleted += result.embeddingsDeleted;
      totals.mediaDeleted += media.deleted;
      return rows.length;
    });
  }

  /**
   * Delete customers whose record has not changed within the retention window
   * and who have no live conversation and none on legal hold. Open privacy
   * requests keep their customer until they are answered.
   */
  async sweepExpiredCustomers(): Promise<{ customersDeleted: number; mediaDeleted: number }> {
    const totals = { customersDeleted: 0, mediaDeleted: 0 };

    for (const organization of await organizationsWithRetention()) {
      try {
        for (let batch = 0; batch < RETENTION_MAX_BATCHES; batch++) {
          const handled = await this.deleteCustomerBatch(organization, totals);
          if (handled < RETENTION_BATCH_SIZE) break;
        }
      } catch (error) {
        await this.recordFailure(organization, "retention.customers", error);
      }
    }

    logger.debug(totals, "Customer retention sweep complete");
    return totals;
  }

  private async deleteCustomerBatch(
    organization: RetentionOrganization,
    totals: { customersDeleted: number; mediaDeleted: number },
  ): Promise<number> {
    const cutoff = cutoffFor(organization.retentionDays);

    return AppDataSource.transaction(async (manager) => {
      await allowStorageWaitInTransaction(manager);
      const rows: Array<{ id: string }> = await manager.query(
        `SELECT c.id FROM customers c
         WHERE c.organization_id = $1
           AND c.updated_at < $2
           AND NOT EXISTS (
             SELECT 1 FROM conversations conv
             WHERE conv.customer_id = c.id AND (conv.deleted_at IS NULL OR conv.legal_hold = true)
           )
           AND NOT EXISTS (
             SELECT 1 FROM privacy_requests pr
             WHERE pr.customer_id = c.id
               AND pr.status IN ('pending_verification', 'verified', 'processing')
           )
         LIMIT $3
         FOR UPDATE OF c SKIP LOCKED`,
        [organization.id, cutoff, RETENTION_BATCH_SIZE],
      );
      if (!rows.length) return 0;
      const customerIds = rows.map((row) => row.id);

      let mediaDeleted = 0;
      for (const customerId of customerIds) {
        const media = await deleteConversationMedia({
          organizationId: organization.id,
          conversationIds: [],
          customerId,
        });
        mediaDeleted += media.deleted;
      }
      await manager.query(`DELETE FROM customers WHERE id = ANY($1) AND organization_id = $2`, [
        customerIds,
        organization.id,
      ]);

      await manager.getRepository(AuditLog).save(
        AuditLog.createLog({
          organizationId: organization.id,
          action: "retention.customers",
          metadata: {
            customersDeleted: customerIds.length,
            mediaDeleted,
            retentionDays: organization.retentionDays,
            cutoffDate: cutoff.toISOString(),
            customerIds,
          },
          status: "success",
        }),
      );

      totals.customersDeleted += customerIds.length;
      totals.mediaDeleted += mediaDeleted;
      return customerIds.length;
    });
  }

  /**
   * Insight issues are redacted, but by regex and an instruction to the model,
   * so they don't stay forever: gone at twice the organization's retention.
   * Cluster text is copied from them, so clusters quiet that long lose theirs.
   */
  async expireInsightText(): Promise<{ issuesDeleted: number; clustersCleared: number }> {
    const totals = { issuesDeleted: 0, clustersCleared: 0 };

    for (const organization of await organizationsWithRetention()) {
      const cutoff = cutoffFor(organization.retentionDays * INSIGHT_RETENTION_MULTIPLIER);
      try {
        for (let batch = 0; batch < RETENTION_MAX_BATCHES; batch++) {
          const [, deleted] = (await AppDataSource.query(
            `DELETE FROM insight_issues WHERE id IN (
               SELECT i.id FROM insight_issues i
               LEFT JOIN conversations c ON c.id = i.conversation_id
               WHERE i.organization_id = $1 AND i.created_at < $2
                 AND c.legal_hold IS NOT TRUE
               LIMIT $3)`,
            [organization.id, cutoff, RETENTION_BATCH_SIZE],
          )) as [unknown, number];
          totals.issuesDeleted += deleted;
          if (deleted < RETENTION_BATCH_SIZE) break;
        }
        const [, cleared] = (await AppDataSource.query(
          `UPDATE insight_clusters SET snippets = '[]'::jsonb, paraphrases = '[]'::jsonb
           WHERE organization_id = $1 AND last_seen_at < $2
             AND (snippets <> '[]'::jsonb OR paraphrases <> '[]'::jsonb)`,
          [organization.id, cutoff],
        )) as [unknown, number];
        totals.clustersCleared += cleared;
      } catch (error) {
        await this.recordFailure(organization, "retention.cleanup", error);
      }
    }

    logger.debug(totals, "Insight text expiry complete");
    return totals;
  }

  /** Log a failed run for one organization; the others carry on. */
  private async recordFailure(
    organization: RetentionOrganization,
    action: "retention.cleanup" | "retention.customers",
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, organizationId: organization.id }, `${action} failed`);
    try {
      await AppDataSource.getRepository(AuditLog).save(
        AuditLog.createLog({
          organizationId: organization.id,
          action,
          metadata: { retentionDays: organization.retentionDays },
          status: "failure",
          errorMessage: message,
        }),
      );
    } catch {
      // Audit logging must never stop the other organizations.
    }
  }

  /**
   * Set legal hold status on a conversation.
   * Conversations on legal hold are exempt from automatic anonymization.
   */
  async setLegalHold(
    conversationId: string,
    organizationId: string,
    legalHold: boolean,
  ): Promise<Conversation | null> {
    const conversationRepository = AppDataSource.getRepository(Conversation);

    // Use atomic update to avoid race conditions
    const result = await conversationRepository.update(
      { id: conversationId, organization_id: organizationId },
      { legal_hold: legalHold, legal_hold_set_at: new Date() },
    );

    if (result.affected === 0) {
      return null;
    }

    logger.debug(
      `Legal hold ${legalHold ? "enabled" : "disabled"} for conversation ${conversationId}`,
    );

    // Fetch and return the updated conversation
    return conversationRepository.findOne({
      where: { id: conversationId, organization_id: organizationId },
    });
  }
}

export const dataRetentionService = new DataRetentionService();
