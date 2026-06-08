/**
 * Document Source Sync Service
 *
 * Orchestrates per-source synchronization for document_importer plugins
 * (Confluence, Notion, GDocs, etc.). One job ↔ one source. Each job claims a
 * row via DocumentSourceRepository.markRunning, runs either an incremental
 * delta or a full sweep, persists chunks/embeddings, and records the outcome.
 *
 * Wall-clock budget per invocation: 50 seconds. When exceeded, the sync
 * returns 'partial' with a resume cursor so the next scheduled tick can
 * continue. Persisted timestamps still use real wall-clock dates; only
 * elapsed-time comparisons go through this.now() so tests can inject a clock.
 */

import { Job, JobPriority, JobStatus } from "@server/entities/job.entity";
import { jobRepository } from "@server/repositories/job.repository";
import { documentSourceRepository } from "@server/repositories/document-source.repository";
import { documentRepository } from "@server/repositories/document.repository";
import { DocumentSource } from "@server/entities/document-source.entity";
import { DocumentationStatus, ImportMethod, type Document } from "@server/entities/document.entity";
import { pluginRouterRegistry } from "./plugin-router-registry.service";
import { pluginManagerService } from "./plugin-manager.service";
import { WebsiteImporter, isWebsiteSource } from "./importers/website-importer";
import { vectorStoreService } from "./vector-store.service";
import { splitTextIntoChunks, createChunkMetadata } from "@server/utils/text-chunking";
import { createLogger } from "@server/lib/logger";
import type {
  DocumentImporterContract,
  DocumentImporterExternalPage,
  DocumentImporterPageChange,
} from "@server/types/plugin-sdk.types";
import type { AnyRouter } from "@trpc/server";

const logger = createLogger("document-source-sync");

/** Hard ceiling per job invocation. */
const BUDGET_MS = 50_000;
/** Force a full sweep if the last one is older than this. */
const FULL_SWEEP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/** Don't persist live progress more often than this (keeps DB writes bounded). */
const PROGRESS_THROTTLE_MS = 750;

/**
 * Live, per-run progress persisted onto the job's `data.progress` so the
 * dashboard can show what a sync is doing right now (pages discovered, pages
 * imported, the page being processed) instead of just a spinner.
 */
export type SyncProgress = {
  phase: "discovering" | "importing" | "reconciling";
  /** Total pages the importer expects, when known. */
  total?: number;
  /** Distinct pages seen so far this run. */
  discovered: number;
  /** Pages handled so far (created + updated + skipped + failed). */
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  /** The page currently being processed (for a live "now importing…" line). */
  currentTitle?: string;
  currentUrl?: string;
  updatedAt?: string;
};

/** Throttled writer that streams SyncProgress onto a job's data field. */
type ProgressReporter = (progress: SyncProgress, force?: boolean) => Promise<void>;

type SyncStats = {
  created: number;
  updated: number;
  skipped: number;
  deleted: number;
  failed: number;
};

type DiscoveryResult = {
  complete: boolean;
  cursor: string | null;
  stats: SyncStats;
  liveExternalIds: Set<string>;
};

type IncrementalResult = {
  complete: boolean;
  cursor: string | null;
  stats: SyncStats;
};

type UpsertOutcome = "created" | "updated" | "skipped";

function emptyStats(): SyncStats {
  return { created: 0, updated: 0, skipped: 0, deleted: 0, failed: 0 };
}

function mergeStats(a: SyncStats, b: SyncStats): SyncStats {
  return {
    created: a.created + b.created,
    updated: a.updated + b.updated,
    skipped: a.skipped + b.skipped,
    deleted: a.deleted + b.deleted,
    failed: a.failed + b.failed,
  };
}

export class DocumentSourceSyncService {
  /**
   * Injectable monotonic clock — tests can override. All elapsed-time
   * comparisons go through this, never through `new Date()`.
   */
  private now: () => number = () =>
    globalThis.performance?.now?.() ?? Number(process.hrtime.bigint() / 1_000_000n);

  /** Test seam: replace the elapsed-time clock. */
  setClock(clock: () => number): void {
    this.now = clock;
  }

  /**
   * Enqueue a sync run for a document source. Returns the queued job id.
   * The job is picked up by JobQueueService.processNextJob.
   */
  async enqueueSync(
    documentSourceId: string,
    opts: { forceFullSweep?: boolean } = {},
  ): Promise<{ jobId: string }> {
    const source = await documentSourceRepository.findByIdInternal(documentSourceId);
    if (!source) {
      throw new Error(`DocumentSource not found: ${documentSourceId}`);
    }

    // Idempotency: if a sync is already in flight for this source, reuse it
    // instead of queuing a duplicate. Without this, the 60s dispatcher enqueues
    // a fresh job every tick for a source whose first sync has not yet recorded
    // a result (e.g. a brand-new source with no lastSyncedAt), and the UI ends
    // up polling a duplicate that bailed at markRunning and never reports progress.
    const inFlight = await jobRepository.findActiveSyncJob(documentSourceId);
    if (inFlight) {
      logger.debug(
        { documentSourceId, jobId: inFlight.id },
        "Sync already in flight; reusing existing job",
      );
      return { jobId: inFlight.id };
    }

    const job = await jobRepository.create({
      title: `Sync ${source.displayName}`,
      description: `Sync document source ${source.displayName} (${source.pluginId})`,
      status: JobStatus.QUEUED,
      priority: JobPriority.NORMAL,
      data: {
        type: "document_source_sync",
        documentSourceId,
        forceFullSweep: opts.forceFullSweep ?? false,
      },
      organizationId: source.organizationId,
    });
    return { jobId: job.id };
  }

  /**
   * Entry point invoked by JobQueueService.dispatchBackgroundJob.
   */
  async processSyncJob(job: Job): Promise<void> {
    const data = (job.data ?? {}) as {
      documentSourceId?: string;
      forceFullSweep?: boolean;
    };
    const documentSourceId = data.documentSourceId;
    if (!documentSourceId) {
      logger.warn({ jobId: job.id }, "Sync job missing documentSourceId");
      return;
    }

    const source = await documentSourceRepository.findByIdInternal(documentSourceId);
    if (!source) {
      logger.warn({ jobId: job.id, documentSourceId }, "DocumentSource not found");
      return;
    }
    if (!source.enabled) {
      logger.debug({ documentSourceId }, "Source disabled, skipping sync");
      return;
    }

    const locked = await documentSourceRepository.markRunning(source.id);
    if (!locked) {
      logger.debug({ documentSourceId }, "Source already running, skipping");
      return;
    }

    const startedAt = this.now();
    let status: "success" | "error" | "partial" = "success";
    let errorMessage: string | null = null;
    let stats: SyncStats = emptyStats();
    let cursor: string | null = null;
    let isFullSweep = false;
    let initiallyDoingFullSweep = false;

    if (!vectorStoreService.initialized) {
      await vectorStoreService.initialize();
    }

    const report = this.makeProgressReporter(job, source.organizationId);

    try {
      const importer = await this.resolveImporter(source);

      initiallyDoingFullSweep = this.shouldDoFullSweep(source, data.forceFullSweep ?? false);

      // Seed a "discovering" state immediately so the UI shows life while the
      // importer enumerates (fetching a sitemap / first page can take a moment).
      await report({ phase: "discovering", discovered: 0, processed: 0, ...emptyStats() }, true);

      if (initiallyDoingFullSweep) {
        isFullSweep = true;
        const result = await this.fullDiscovery(source, importer, startedAt, report);
        stats = mergeStats(stats, result.stats);
        cursor = result.cursor;

        if (result.complete) {
          // Only reconcile deletions when the discovery loop ran end-to-end;
          // otherwise the "live set" is partial and would archive valid docs.
          await report(
            {
              phase: "reconciling",
              discovered: result.liveExternalIds.size,
              processed: 0,
              ...stats,
            },
            true,
          );
          const reconcile = await this.reconcileDeletions(
            source,
            result.liveExternalIds,
            startedAt,
          );
          stats = mergeStats(stats, reconcile.stats);
          status = reconcile.complete ? "success" : "partial";
        } else {
          status = "partial";
        }
      } else {
        const result = await this.incrementalSync(source, importer, startedAt, report);
        stats = mergeStats(stats, result.stats);
        cursor = result.cursor;
        status = result.complete ? "success" : "partial";
      }
    } catch (err) {
      status = "error";
      errorMessage = err instanceof Error ? err.message : String(err);
      logger.error({ err, documentSourceId }, "Sync run failed");
    } finally {
      try {
        await documentSourceRepository.recordSyncResult(source.id, {
          status,
          error: errorMessage,
          cursor: status === "success" ? null : cursor,
          stats: stats as unknown as Record<string, unknown>,
          isFullSweep: isFullSweep && status === "success",
        });
      } catch (recordErr) {
        logger.error({ err: recordErr, documentSourceId }, "Failed to record sync result");
      }
    }
  }

  /**
   * True when we should run a full sweep instead of an incremental delta.
   *   - no prior sync yet, OR
   *   - caller forced it, OR
   *   - it has been > FULL_SWEEP_INTERVAL_MS since the last full sweep.
   */
  private shouldDoFullSweep(source: DocumentSource, forceFullSweep: boolean): boolean {
    if (forceFullSweep) return true;
    if (!source.lastSyncedAt) return true;
    const lastFull = source.lastFullSweepAt?.getTime();
    if (!lastFull) return true;
    return Date.now() - lastFull > FULL_SWEEP_INTERVAL_MS;
  }

  /**
   * Walk the importer's `discover` cursor end-to-end (or until budget),
   * upserting every page. Returns the set of externalIds observed this run
   * so reconcileDeletions can archive anything missing.
   */
  private async fullDiscovery(
    source: DocumentSource,
    importer: DocumentImporterContract,
    startedAt: number,
    report: ProgressReporter,
  ): Promise<DiscoveryResult> {
    const liveExternalIds = new Set<string>();
    let stats = emptyStats();
    let cursor: string | undefined = source.lastSyncCursor ?? undefined;
    let total: number | undefined;
    if (!source.externalRootId) {
      throw new Error(`DocumentSource ${source.id} has no externalRootId; cannot discover`);
    }

    while (true) {
      if (this.elapsed(startedAt) > BUDGET_MS) {
        return { complete: false, cursor: cursor ?? null, stats, liveExternalIds };
      }

      const page = await importer.discover({
        instanceId: source.pluginInstanceId ?? "",
        rootId: source.externalRootId,
        cursor,
      });
      if (typeof page.total === "number") total = page.total;

      for (const item of page.pages) {
        if (this.elapsed(startedAt) > BUDGET_MS) {
          return { complete: false, cursor: cursor ?? null, stats, liveExternalIds };
        }
        liveExternalIds.add(item.externalId);
        await report({
          phase: "importing",
          total,
          discovered: liveExternalIds.size,
          processed: this.processedCount(stats),
          ...stats,
          currentTitle: item.title,
          currentUrl: item.externalUrl,
        });
        const outcome = await this.safeUpsert(source, importer, item, stats);
        stats = this.bumpStats(stats, outcome);
      }

      cursor = page.nextCursor;
      if (!cursor) {
        await report(
          {
            phase: "importing",
            total,
            discovered: liveExternalIds.size,
            processed: this.processedCount(stats),
            ...stats,
          },
          true,
        );
        return { complete: true, cursor: null, stats, liveExternalIds };
      }
    }
  }

  /**
   * Pull pages changed since the last sync via importer.listChanges. Each
   * change is either an upsert (refetch+rechunk) or a delete (archive).
   */
  private async incrementalSync(
    source: DocumentSource,
    importer: DocumentImporterContract,
    startedAt: number,
    report: ProgressReporter,
  ): Promise<IncrementalResult> {
    if (!source.externalRootId) {
      throw new Error(`DocumentSource ${source.id} has no externalRootId; cannot sync`);
    }
    const since = (source.lastSyncedAt ?? new Date(0)).toISOString();
    let stats = emptyStats();
    let cursor: string | undefined = source.lastSyncCursor ?? undefined;
    let discovered = 0;

    while (true) {
      if (this.elapsed(startedAt) > BUDGET_MS) {
        return { complete: false, cursor: cursor ?? null, stats };
      }

      const page = await importer.listChanges({
        instanceId: source.pluginInstanceId ?? "",
        rootId: source.externalRootId,
        since,
        cursor,
      });

      for (const change of page.changes) {
        if (this.elapsed(startedAt) > BUDGET_MS) {
          return { complete: false, cursor: cursor ?? null, stats };
        }
        discovered += 1;
        await report({
          phase: "importing",
          discovered,
          processed: this.processedCount(stats),
          ...stats,
          currentUrl: change.externalId,
        });
        try {
          if (change.op === "upsert") {
            const outcome = await this.upsertPage(source, importer, this.changeToPage(change));
            stats = this.bumpStats(stats, outcome);
          } else {
            const deleted = await this.archiveRemovedDoc(source, change.externalId);
            if (deleted) stats.deleted += 1;
          }
        } catch (err) {
          stats.failed += 1;
          logger.error(
            { err, documentSourceId: source.id, externalId: change.externalId },
            "Failed to process change",
          );
        }
      }

      cursor = page.nextCursor;
      if (!cursor) {
        return { complete: true, cursor: null, stats };
      }
    }
  }

  /**
   * Idempotent insert-or-update for a single page. Returns 'skipped' when the
   * stored copy is current or has been explicitly excluded by a user.
   */
  private async upsertPage(
    source: DocumentSource,
    importer: DocumentImporterContract,
    page: DocumentImporterExternalPage,
  ): Promise<UpsertOutcome> {
    const existing = await documentRepository.findByExternalId(source.id, page.externalId);
    if (existing?.excludedFromSync) {
      return "skipped";
    }

    const incomingUpdatedAt = page.externalUpdatedAt ? new Date(page.externalUpdatedAt) : null;
    if (
      existing &&
      existing.externalUpdatedAt &&
      incomingUpdatedAt &&
      existing.externalUpdatedAt.getTime() >= incomingUpdatedAt.getTime()
    ) {
      return "skipped";
    }

    let document: Document;
    let wasNew = false;
    if (!existing) {
      wasNew = true;
      document = await documentRepository.create({
        title: page.title,
        importMethod: ImportMethod.PLUGIN,
        status: DocumentationStatus.PROCESSING,
        documentSourceId: source.id,
        organizationId: source.organizationId,
        externalId: page.externalId,
        externalUpdatedAt: incomingUpdatedAt ?? undefined,
        externalUrl: page.externalUrl,
      });
    } else {
      document = existing;
    }

    const fetched = await importer.fetchPage({
      instanceId: source.pluginInstanceId ?? "",
      externalId: page.externalId,
    });

    const fetchedUpdatedAt = fetched.externalUpdatedAt
      ? new Date(fetched.externalUpdatedAt)
      : (incomingUpdatedAt ?? undefined);

    const updated = await documentRepository.update(document.id, source.organizationId, {
      title: fetched.title,
      content: fetched.markdown,
      externalUpdatedAt: fetchedUpdatedAt,
      externalUrl: fetched.externalUrl ?? page.externalUrl,
      status: DocumentationStatus.PUBLISHED,
      lastCrawledAt: new Date(),
    });

    const finalDoc = updated ?? document;

    // Re-embed: wipe old embeddings then insert new chunks.
    await vectorStoreService.deleteByDocumentId(source.organizationId, finalDoc.id);

    if (fetched.markdown && fetched.markdown.trim().length > 0) {
      const chunks = splitTextIntoChunks(fetched.markdown, {
        chunkSize: 1000,
        chunkOverlap: 200,
      });
      if (chunks.length > 0) {
        const vectorChunks = chunks.map((content, index) => ({
          content,
          metadata: createChunkMetadata(index, chunks.length, {
            documentId: finalDoc.id,
            documentTitle: finalDoc.title,
            documentSourceId: source.id,
            externalId: page.externalId,
            externalUrl: fetched.externalUrl ?? page.externalUrl,
          }),
        }));
        await vectorStoreService.addChunks(source.organizationId, finalDoc.id, vectorChunks);
      }
    }

    return wasNew ? "created" : "updated";
  }

  /**
   * Archive a doc that was removed in the source-of-truth system. Returns
   * true when an archive actually happened (so the caller can count it).
   * User-excluded docs are left alone.
   */
  private async archiveRemovedDoc(source: DocumentSource, externalId: string): Promise<boolean> {
    const doc = await documentRepository.findByExternalId(source.id, externalId);
    if (!doc) return false;
    if (doc.excludedFromSync) return false;
    if (doc.status === DocumentationStatus.ARCHIVED) {
      // Already archived — nothing to do, don't double-count.
      return false;
    }
    await documentRepository.update(doc.id, source.organizationId, {
      status: DocumentationStatus.ARCHIVED,
    });
    await vectorStoreService.deleteByDocumentId(source.organizationId, doc.id);
    return true;
  }

  /**
   * After a complete full sweep, archive any stored doc whose externalId was
   * NOT observed during discovery. Budget-bounded; returns complete=false if
   * we run out of time mid-pass.
   */
  private async reconcileDeletions(
    source: DocumentSource,
    liveExternalIds: Set<string>,
    startedAt: number,
  ): Promise<{ complete: boolean; stats: SyncStats }> {
    const stored = await documentRepository.findExternalIdsForSource(source.id);
    const stats = emptyStats();
    for (const id of stored) {
      if (this.elapsed(startedAt) > BUDGET_MS) {
        return { complete: false, stats };
      }
      if (!liveExternalIds.has(id)) {
        try {
          const archived = await this.archiveRemovedDoc(source, id);
          if (archived) stats.deleted += 1;
        } catch (err) {
          stats.failed += 1;
          logger.error(
            { err, documentSourceId: source.id, externalId: id },
            "Failed to archive removed document",
          );
        }
      }
    }
    return { complete: true, stats };
  }

  /** upsertPage wrapper that records failures into stats instead of throwing. */
  private async safeUpsert(
    source: DocumentSource,
    importer: DocumentImporterContract,
    page: DocumentImporterExternalPage,
    stats: SyncStats,
  ): Promise<UpsertOutcome | "failed"> {
    try {
      return await this.upsertPage(source, importer, page);
    } catch (err) {
      stats.failed += 1;
      logger.error(
        { err, documentSourceId: source.id, externalId: page.externalId },
        "Failed to upsert page",
      );
      return "failed";
    }
  }

  private bumpStats(stats: SyncStats, outcome: UpsertOutcome | "failed"): SyncStats {
    if (outcome === "created") stats.created += 1;
    else if (outcome === "updated") stats.updated += 1;
    else if (outcome === "skipped") stats.skipped += 1;
    // 'failed' is already counted by safeUpsert.
    return stats;
  }

  private processedCount(stats: SyncStats): number {
    return stats.created + stats.updated + stats.skipped + stats.failed;
  }

  /**
   * Build a throttled reporter that streams SyncProgress onto the job's
   * `data.progress`. The dashboard polls the job (via getSyncHistory) and
   * renders this as a live "discovering / importing page N of M" panel.
   * Writes are best-effort: a failed progress write never fails the sync.
   */
  private makeProgressReporter(job: Job, organizationId: string): ProgressReporter {
    let lastWrite = 0;
    const baseData = { ...(job.data ?? {}) };
    return async (progress, force = false) => {
      const now = this.now();
      if (!force && now - lastWrite < PROGRESS_THROTTLE_MS) return;
      lastWrite = now;
      try {
        await jobRepository.update(job.id, organizationId, {
          data: { ...baseData, progress: { ...progress, updatedAt: new Date().toISOString() } },
        });
      } catch (err) {
        logger.debug({ err, jobId: job.id }, "Failed to persist sync progress");
      }
    };
  }

  /**
   * A change-record minus the 'op' field is shaped enough like a discover()
   * page that upsertPage can consume it. fetchPage() is the source of truth
   * for title/content anyway.
   */
  private changeToPage(change: DocumentImporterPageChange): DocumentImporterExternalPage {
    return {
      externalId: change.externalId,
      title: "",
      externalUpdatedAt: change.externalUpdatedAt ?? new Date().toISOString(),
    };
  }

  private elapsed(startedAt: number): number {
    return this.now() - startedAt;
  }

  /**
   * Resolve the importer for a source. Built-in sources (websites) use a
   * native importer; everything else resolves to a document_importer plugin's
   * tRPC router. This is the single seam that lets non-plugin importers exist.
   */
  private async resolveImporter(source: DocumentSource): Promise<DocumentImporterContract> {
    if (isWebsiteSource(source)) {
      return new WebsiteImporter(source);
    }
    // Self-heal: register the plugin's router on demand if it wasn't loaded at
    // boot (e.g. the plugin was built/installed/enabled while the server ran).
    await pluginManagerService.ensurePluginRouterRegistered(source.pluginId);
    const pluginRouter = pluginRouterRegistry.getRouter(source.pluginId);
    if (!pluginRouter) {
      throw new Error(`Plugin not registered: ${source.pluginId}`);
    }
    return this.createImporter(pluginRouter, source);
  }

  /**
   * Build a typed importer facade over a plugin's tRPC router. Plugins
   * implementing the document_importer contract must expose procedures named
   * exactly as the contract methods. We bypass tRPC's HTTP layer by using
   * the router's createCaller with a minimal admin context scoped to the
   * source's organization.
   */
  private createImporter(
    pluginRouter: AnyRouter,
    source: DocumentSource,
  ): DocumentImporterContract {
    // createCaller is attached to v11 router instances. We pass a partial
    // Context with only the org context populated — plugin importer
    // procedures are expected to authorize off `organizationId`.
    const ctx = {
      user: null,
      organizationId: source.organizationId,
      req: undefined as unknown as never,
      res: undefined as unknown as never,
    };
    const caller =
      typeof pluginRouter.createCaller === "function" ? pluginRouter.createCaller(ctx) : null;
    if (!caller) {
      throw new Error(
        `Plugin router for ${source.pluginId} does not expose createCaller; ` +
          `cannot invoke document_importer contract`,
      );
    }
    return caller as unknown as DocumentImporterContract;
  }
}

export const documentSourceSyncService = new DocumentSourceSyncService();
