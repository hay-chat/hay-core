import { AppDataSource } from "@server/database/data-source";
import { createLogger } from "@server/lib/logger";
import { isTestConversation } from "@server/services/close-classification/outcome-rules";

const logger = createLogger("insight-backfill");

/** How far back the backfill reviews closed conversations (Roger: last 30 days). */
export const BACKFILL_DAYS = 30;

export interface BackfillStatus {
  requestedAt: Date | null;
  completedAt: Date | null;
  reviewed: number;
  running: boolean;
}

/**
 * D3-18: when Insights is first enabled (the first visit to the Insights page),
 * review the org's closed conversations of the last 30 days so the page is not
 * empty. Insights-only: it never creates outcome rows, bills or changes status
 * (closes from before D1-3 have no outcome row at all).
 */
export class InsightBackfillService {
  /** Idempotent: only the first request starts a backfill. */
  async request(organizationId: string): Promise<void> {
    await AppDataSource.query(
      `INSERT INTO insight_org_state (organization_id, backfill_requested_at)
       VALUES ($1, now())
       ON CONFLICT (organization_id) DO UPDATE
         SET backfill_requested_at = coalesce(insight_org_state.backfill_requested_at, now()),
             updated_at = CASE WHEN insight_org_state.backfill_requested_at IS NULL
                               THEN now() ELSE insight_org_state.updated_at END`,
      [organizationId],
    );
  }

  async status(organizationId: string): Promise<BackfillStatus> {
    const [row] = await AppDataSource.query(
      `SELECT backfill_requested_at, backfill_completed_at, backfill_reviewed
         FROM insight_org_state WHERE organization_id = $1`,
      [organizationId],
    );
    return {
      requestedAt: row?.backfill_requested_at ?? null,
      completedAt: row?.backfill_completed_at ?? null,
      reviewed: Number(row?.backfill_reviewed ?? 0),
      running: !!row?.backfill_requested_at && !row?.backfill_completed_at,
    };
  }

  /** Closed conversations in the window not yet reviewed, after the cursor. */
  private async candidates(
    organizationId: string,
    cursor: Date | null,
    limit: number,
  ): Promise<Array<{ id: string; closed_at: Date; metadata: Record<string, unknown> | null }>> {
    return AppDataSource.query(
      `SELECT c.id, c.closed_at, c.metadata
         FROM conversations c
        WHERE c.organization_id = $1
          AND c.closed_at IS NOT NULL
          AND c.closed_at >= now() - ($2 || ' days')::interval
          AND ($3::timestamptz IS NULL OR c.closed_at > $3::timestamptz)
          AND c.spam_flagged_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM insight_issues i
                           WHERE i.conversation_id = c.id AND i.source = 'ai_review')
          AND NOT EXISTS (SELECT 1 FROM conversation_outcomes o WHERE o.conversation_id = c.id)
        ORDER BY c.closed_at ASC
        LIMIT $4`,
      [organizationId, String(BACKFILL_DAYS), cursor, limit],
    );
  }

  /** One batch per org with a running backfill. Runs every couple of minutes. */
  async processPending(batchSize = 10, maxOrgs = 5): Promise<number> {
    const orgs: Array<{ organization_id: string; backfill_cursor: Date | null }> =
      await AppDataSource.query(
        `SELECT organization_id, backfill_cursor FROM insight_org_state
          WHERE backfill_requested_at IS NOT NULL AND backfill_completed_at IS NULL
          ORDER BY backfill_requested_at ASC
          LIMIT $1`,
        [maxOrgs],
      );
    let reviewed = 0;
    for (const org of orgs) {
      reviewed += await this.processOrganization(
        org.organization_id,
        org.backfill_cursor,
        batchSize,
      );
    }
    return reviewed;
  }

  async processOrganization(
    organizationId: string,
    cursor: Date | null,
    batchSize: number,
  ): Promise<number> {
    const { closeClassifierService } =
      await import("@server/services/close-classification/close-classifier.service");
    const batch = await this.candidates(organizationId, cursor, batchSize);
    let reviewed = 0;
    let lastClosedAt = cursor;
    for (const conversation of batch) {
      lastClosedAt = conversation.closed_at;
      if (isTestConversation(conversation.metadata)) continue;
      try {
        if (await closeClassifierService.reviewForInsights(conversation.id)) reviewed++;
      } catch (error) {
        // One bad transcript must not stall the backfill; it is skipped.
        logger.warn(
          { err: error, organizationId, conversationId: conversation.id },
          "Backfill review failed",
        );
      }
    }
    const done = batch.length < batchSize;
    await AppDataSource.query(
      `UPDATE insight_org_state
          SET backfill_cursor = $2,
              backfill_reviewed = backfill_reviewed + $3,
              backfill_completed_at = CASE WHEN $4::boolean THEN now() ELSE NULL END,
              updated_at = now()
        WHERE organization_id = $1`,
      [organizationId, lastClosedAt, reviewed, done],
    );
    if (done) await this.finish(organizationId);
    return reviewed;
  }

  /** Embed what the backfill wrote and cluster right away instead of waiting for the night. */
  private async finish(organizationId: string): Promise<void> {
    try {
      const { insightEmbeddingService } = await import("./insight-embedding.service");
      await insightEmbeddingService.embedPending(200);
      const { insightClusteringService } = await import("./insight-clustering.service");
      await insightClusteringService.clusterOrganization(organizationId);
    } catch (error) {
      // The nightly clustering picks up whatever is left.
      logger.warn({ err: error, organizationId }, "Post-backfill clustering failed");
    }
  }
}

export const insightBackfillService = new InsightBackfillService();
