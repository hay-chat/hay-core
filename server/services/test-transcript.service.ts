/**
 * Stored test transcripts (D7-8): import, list, read, delete, and retention.
 * Replays and test cases (lane L7b) read transcripts through `get` and turn
 * their turns into simulation seeds.
 */

import { randomUUID } from "crypto";
import { In, LessThan } from "typeorm";
import { AppDataSource } from "@server/database/data-source";
import { TestTranscript as TestTranscriptRow } from "@server/database/entities/test-transcript.entity";
import { Organization } from "@server/entities/organization.entity";
import { createLogger } from "@server/lib/logger";
import {
  normalizeTranscripts,
  type TestTranscript,
} from "@server/services/importers/transcripts/test-transcript";

const logger = createLogger("test-transcripts");

export interface ImportResult {
  importBatchId: string;
  imported: number;
}

export interface TranscriptSummary {
  id: string;
  source: string;
  externalId: string | null;
  title: string | null;
  orderRef: string | null;
  turnCount: number;
  preview: string;
  startedAt: Date | null;
  importBatchId: string;
  createdAt: Date;
}

function repo() {
  return AppDataSource.getRepository(TestTranscriptRow);
}

function summarize(row: TestTranscriptRow): TranscriptSummary {
  return {
    id: row.id,
    source: row.source,
    externalId: row.external_id,
    title: row.title,
    orderRef: row.order_ref,
    turnCount: row.turn_count,
    preview: (row.turns.find((t) => t.role === "customer")?.text ?? "").slice(0, 160),
    startedAt: row.started_at,
    importBatchId: row.import_batch_id,
    createdAt: row.created_at,
  };
}

export class TestTranscriptService {
  /** Normalize and store parsed transcripts as one import batch. */
  async importTranscripts(input: {
    organizationId: string;
    source: string;
    transcripts: TestTranscript[];
    createdById?: string | null;
  }): Promise<ImportResult> {
    const transcripts = normalizeTranscripts(input.transcripts);
    const importBatchId = randomUUID();
    const rows = transcripts.map((t) => {
      const firstTime = t.turns.find((turn) => turn.timestamp)?.timestamp;
      return repo().create({
        organization_id: input.organizationId,
        source: input.source,
        external_id: t.externalId?.slice(0, 255) ?? null,
        title: t.title?.slice(0, 255) ?? null,
        order_ref: t.orderRef?.slice(0, 255) ?? null,
        turns: t.turns,
        turn_count: t.turns.length,
        started_at: firstTime ? new Date(firstTime) : null,
        import_batch_id: importBatchId,
        created_by_id: input.createdById ?? null,
      });
    });
    await repo().save(rows, { chunk: 200 });
    return { importBatchId, imported: rows.length };
  }

  async list(
    organizationId: string,
    options: { limit: number; offset: number; importBatchId?: string },
  ): Promise<{ items: TranscriptSummary[]; total: number }> {
    const [rows, total] = await repo().findAndCount({
      where: {
        organization_id: organizationId,
        ...(options.importBatchId ? { import_batch_id: options.importBatchId } : {}),
      },
      order: { created_at: "DESC", id: "ASC" },
      take: options.limit,
      skip: options.offset,
    });
    return { items: rows.map(summarize), total };
  }

  async get(organizationId: string, id: string): Promise<TestTranscriptRow | null> {
    return repo().findOne({ where: { id, organization_id: organizationId } });
  }

  async remove(organizationId: string, ids: string[]): Promise<number> {
    const result = await repo().delete({ organization_id: organizationId, id: In(ids) });
    return result.affected ?? 0;
  }

  /**
   * Imported transcripts follow the organization's retention setting: delete
   * the ones imported more than `settings.retentionDays` ago. Run by the
   * daily conversation retention job.
   */
  async deleteExpired(now: Date = new Date()): Promise<number> {
    const organizations = await AppDataSource.getRepository(Organization)
      .createQueryBuilder("org")
      .where("org.settings->>'retentionDays' IS NOT NULL")
      .andWhere("(org.settings->>'retentionDays')::int > 0")
      .getMany();

    let deleted = 0;
    for (const org of organizations) {
      const retentionDays = org.settings?.retentionDays;
      if (!retentionDays || retentionDays <= 0) continue;
      const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
      try {
        const result = await repo().delete({
          organization_id: org.id,
          created_at: LessThan(cutoff),
        });
        deleted += result.affected ?? 0;
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          `Failed to delete expired test transcripts for org ${org.id}`,
        );
      }
    }
    if (deleted > 0) logger.info(`Deleted ${deleted} expired test transcripts`);
    return deleted;
  }
}

export const testTranscriptService = new TestTranscriptService();
