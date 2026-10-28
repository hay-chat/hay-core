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
import { JobPriority, JobStatus } from "@server/entities/job.entity";
import { jobRepository } from "@server/repositories/job.repository";
import { createLogger } from "@server/lib/logger";
import {
  normalizeTranscript,
  normalizeTranscripts,
  TranscriptImportError,
  TRANSCRIPT_LIMITS,
  type TestTranscript,
} from "@server/services/importers/transcripts/test-transcript";

const logger = createLogger("test-transcripts");

export interface ImportResult {
  importBatchId: string;
  imported: number;
}

/** Transcripts saved per write while a background import streams in. */
const BACKGROUND_BATCH_SIZE = 50;

export interface BackgroundImport {
  jobId: string;
  importBatchId: string;
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
    const importBatchId = randomUUID();
    const imported = await this.save(input, importBatchId, normalizeTranscripts(input.transcripts));
    return { importBatchId, imported };
  }

  /**
   * Import a slow source (an API read ticket by ticket) in the background:
   * returns a job right away, then saves transcripts in batches under one
   * import batch as they arrive. The job's `data.imported` counts what landed
   * so far; it ends COMPLETED with `{ importBatchId, imported }` or FAILED with
   * `{ error }` (transcripts saved before the failure stay).
   *
   * Credentials live only in the iterator's closure, never in the job row.
   * TODO: a server restart abandons a running import, leaving its job PROCESSING.
   */
  async importInBackground(input: {
    organizationId: string;
    source: string;
    transcripts: AsyncIterable<TestTranscript>;
    createdById?: string | null;
  }): Promise<BackgroundImport> {
    const importBatchId = randomUUID();
    const job = await jobRepository.create({
      organizationId: input.organizationId,
      title: `Transcript import (${input.source})`,
      status: JobStatus.PROCESSING,
      priority: JobPriority.NORMAL,
      data: { kind: "transcript_import", source: input.source, importBatchId, imported: 0 },
    });
    void this.runBackgroundImport(input, job.id, importBatchId);
    return { jobId: job.id, importBatchId };
  }

  /** Runs to completion; every outcome, failure included, ends on the job row. */
  async runBackgroundImport(
    input: {
      organizationId: string;
      source: string;
      transcripts: AsyncIterable<TestTranscript>;
      createdById?: string | null;
    },
    jobId: string,
    importBatchId: string,
  ): Promise<void> {
    const progress = (imported: number) => ({
      kind: "transcript_import",
      source: input.source,
      importBatchId,
      imported,
    });
    let imported = 0;
    try {
      let batch: TestTranscript[] = [];
      const flush = async () => {
        if (batch.length === 0) return;
        imported += await this.save(input, importBatchId, batch);
        batch = [];
        await jobRepository.update(jobId, input.organizationId, { data: progress(imported) });
      };
      for await (const raw of input.transcripts) {
        const transcript = normalizeTranscript(raw);
        if (!transcript) continue;
        if (imported + batch.length >= TRANSCRIPT_LIMITS.maxTranscriptsPerImport) break;
        batch.push(transcript);
        if (batch.length >= BACKGROUND_BATCH_SIZE) await flush();
      }
      await flush();
      if (imported === 0) throw new TranscriptImportError("No conversations found");
      await jobRepository.update(jobId, input.organizationId, {
        status: JobStatus.COMPLETED,
        data: progress(imported),
        result: { importBatchId, imported },
      });
    } catch (error) {
      const message =
        error instanceof TranscriptImportError ? error.message : "The import stopped unexpectedly";
      if (!(error instanceof TranscriptImportError)) {
        logger.error(
          { jobId, error: error instanceof Error ? error.message : String(error) },
          "Background transcript import failed",
        );
      }
      await jobRepository
        .update(jobId, input.organizationId, {
          status: JobStatus.FAILED,
          data: progress(imported),
          result: { importBatchId, imported, error: message },
        })
        .catch((updateError) =>
          logger.error({ jobId, error: String(updateError) }, "Could not mark import job failed"),
        );
    }
  }

  /** A transcript import job of this organization, or null. */
  async importStatus(
    organizationId: string,
    jobId: string,
  ): Promise<{
    status: JobStatus;
    importBatchId: string | null;
    imported: number;
    error: string | null;
  } | null> {
    const job = await jobRepository.findById(jobId);
    if (!job || job.organizationId !== organizationId) return null;
    if (job.data?.kind !== "transcript_import") return null;
    const result = job.result ?? {};
    return {
      status: job.status,
      importBatchId: (job.data.importBatchId as string | undefined) ?? null,
      imported: Number(job.data.imported ?? 0),
      error: typeof result.error === "string" ? result.error : null,
    };
  }

  /** Store already-normalized transcripts under an import batch; returns how many. */
  private async save(
    input: { organizationId: string; source: string; createdById?: string | null },
    importBatchId: string,
    transcripts: TestTranscript[],
  ): Promise<number> {
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
    return rows.length;
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
