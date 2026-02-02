import { AppDataSource } from "@server/database/data-source";
import { Conversation } from "@server/database/entities/conversation.entity";
import { Message } from "@server/database/entities/message.entity";
import { Organization } from "@server/entities/organization.entity";
import { debugLog } from "@server/lib/debug-logger";

/**
 * Data Retention Service
 *
 * Handles automatic anonymization of expired conversations based on
 * organization retention policies. This preserves conversation metadata
 * for analytics while removing personal information (GDPR-compliant).
 *
 * What gets preserved (for analytics):
 * - timestamps (created_at, closed_at, updated_at)
 * - status, channel, agent_id
 * - organization_id
 *
 * What gets removed (PII):
 * - messages (deleted)
 * - customer link (set to NULL)
 * - title, context, metadata
 */
export class DataRetentionService {
  /**
   * Anonymize expired conversations for all organizations with retention policies.
   * Called by the scheduled job daily.
   */
  async anonymizeExpiredConversations(): Promise<{
    organizationsProcessed: number;
    conversationsAnonymized: number;
    messagesDeleted: number;
  }> {
    const organizationRepository = AppDataSource.getRepository(Organization);
    const conversationRepository = AppDataSource.getRepository(Conversation);
    const messageRepository = AppDataSource.getRepository(Message);

    let organizationsProcessed = 0;
    let conversationsAnonymized = 0;
    let messagesDeleted = 0;

    // Find organizations with retention policies enabled
    const organizations = await organizationRepository
      .createQueryBuilder("org")
      .where("org.settings->>'retentionDays' IS NOT NULL")
      .andWhere("(org.settings->>'retentionDays')::int > 0")
      .getMany();

    debugLog(
      "data-retention",
      `Found ${organizations.length} organizations with retention policies`,
    );

    for (const org of organizations) {
      try {
        const retentionDays = org.settings?.retentionDays;
        if (!retentionDays || retentionDays <= 0) continue;

        organizationsProcessed++;

        // Calculate cutoff date
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

        // Find conversations eligible for anonymization:
        // - Not already anonymized (deleted_at IS NULL)
        // - Not on legal hold
        // - Closed or resolved status
        // - Closed date (or created date if never closed) is before cutoff
        const expiredConversations = await conversationRepository
          .createQueryBuilder("conv")
          .where("conv.organization_id = :orgId", { orgId: org.id })
          .andWhere("conv.deleted_at IS NULL")
          .andWhere("conv.legal_hold = false")
          .andWhere("conv.status IN (:...statuses)", { statuses: ["closed", "resolved"] })
          .andWhere(
            "(conv.closed_at IS NOT NULL AND conv.closed_at < :cutoff) OR " +
              "(conv.closed_at IS NULL AND conv.created_at < :cutoff)",
            { cutoff: cutoffDate },
          )
          .getMany();

        if (expiredConversations.length === 0) {
          debugLog("data-retention", `No expired conversations for org ${org.id}`);
          continue;
        }

        debugLog(
          "data-retention",
          `Found ${expiredConversations.length} expired conversations for org ${org.id} (${org.name})`,
        );

        const conversationIds = expiredConversations.map((c) => c.id);

        // Delete messages first (before anonymizing conversations)
        const messageDeleteResult = await messageRepository
          .createQueryBuilder()
          .delete()
          .where("conversation_id IN (:...ids)", { ids: conversationIds })
          .execute();

        messagesDeleted += messageDeleteResult.affected || 0;

        // Anonymize conversations
        const now = new Date();
        await conversationRepository
          .createQueryBuilder()
          .update()
          .set({
            deleted_at: now,
            customer_id: null,
            title: "[Anonymized]",
            context: null,
            metadata: null,
            // Keep analytics-relevant fields: status, channel, agent_id, timestamps
          })
          .where("id IN (:...ids)", { ids: conversationIds })
          .execute();

        conversationsAnonymized += expiredConversations.length;

        debugLog(
          "data-retention",
          `Anonymized ${expiredConversations.length} conversations for org ${org.id}`,
          {
            messagesDeleted: messageDeleteResult.affected || 0,
            retentionDays,
            cutoffDate: cutoffDate.toISOString(),
          },
        );
      } catch (error) {
        debugLog("data-retention", `Error processing org ${org.id}`, {
          level: "error",
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with other organizations
      }
    }

    debugLog("data-retention", "Data retention cleanup complete", {
      organizationsProcessed,
      conversationsAnonymized,
      messagesDeleted,
    });

    return {
      organizationsProcessed,
      conversationsAnonymized,
      messagesDeleted,
    };
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

    debugLog(
      "data-retention",
      `Legal hold ${legalHold ? "enabled" : "disabled"} for conversation ${conversationId}`,
    );

    // Fetch and return the updated conversation
    return conversationRepository.findOne({
      where: { id: conversationId, organization_id: organizationId },
    });
  }
}

export const dataRetentionService = new DataRetentionService();
