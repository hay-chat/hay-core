import { AppDataSource } from "@server/database/data-source";
import { Job, JobStatus } from "@server/entities/job.entity";
import {
  DocumentSourceSyncStatus,
  type DocumentSource,
} from "@server/entities/document-source.entity";
import { documentSourceRepository } from "@server/repositories/document-source.repository";
import { documentRepository } from "@server/repositories/document.repository";
import { documentSourceSyncService } from "@server/services/document-source-sync.service";
import type { SyncProgress } from "@server/services/document-source-sync.service";
import { WEBSITE_PLUGIN_ID } from "@server/services/importers/website-importer";
import {
  createWebsiteSource,
  findWebsiteSource,
  normalizeWebsiteUrl,
} from "@server/services/website-source.service";
import { createLogger } from "@server/lib/logger";
import type { SetupSiteState } from "@server/types/setup.types";

const logger = createLogger("setup-site");

const ACTIVE_JOB_STATUSES: JobStatus[] = [
  JobStatus.PENDING,
  JobStatus.QUEUED,
  JobStatus.PROCESSING,
  JobStatus.RETRYING,
];

/**
 * A website sync is capped at 50 seconds per job. A big site ends `partial` with a resume cursor,
 * and the scheduler would only continue it a day later. While setup is open we continue it
 * ourselves, up to this many jobs in the window below (about 7 minutes of reading), so a large
 * site is neither left half-read nor crawled without end.
 */
export const MAX_SETUP_SYNC_JOBS = 8;
const SYNC_JOB_WINDOW_MS = 30 * 60 * 1000;

export interface SiteReading {
  state: SetupSiteState;
  /** When the site was last read, used to tell whether an older check may be out of date. */
  syncedAt?: string;
}

/** What the sync job and source say, reduced to the four states setup shows. */
export function resolveSiteState(input: {
  source: Pick<DocumentSource, "id" | "lastSyncStatus" | "lastSyncedAt"> | null;
  jobStatus?: JobStatus;
  progress?: Partial<SyncProgress>;
  website?: string;
  /** Pages stored for this source. Used instead of the latest job's count when a read was resumed. */
  pagesRead?: number;
  /** Whether setup may still start another job to continue a partial read. */
  canContinue?: boolean;
}): SiteReading {
  const { source, jobStatus, progress, website, pagesRead, canContinue } = input;
  // A chosen address with no source behind it means reading never started (bad address).
  if (!source) {
    return { state: { state: website ? "failed" : "none", website, discovered: 0, processed: 0 } };
  }

  const base = {
    sourceId: source.id,
    website,
    discovered: Math.max(progress?.discovered ?? 0, pagesRead ?? 0),
    processed: pagesRead ?? progress?.processed ?? 0,
    ...(typeof progress?.total === "number" ? { total: progress.total } : {}),
  };
  const syncedAt = source.lastSyncedAt?.toISOString();

  const running =
    (jobStatus !== undefined && ACTIVE_JOB_STATUSES.includes(jobStatus)) ||
    source.lastSyncStatus === DocumentSourceSyncStatus.RUNNING;
  // A source that was never read and has no job yet is about to start, not finished.
  const notStarted = !source.lastSyncedAt && jobStatus === undefined;
  if (running || notStarted) return { state: { ...base, state: "reading" }, syncedAt };

  // The last job hit its time limit with pages left. Still reading while we may continue it;
  // past the cap it is done for now, and says so instead of passing as a complete read.
  if (source.lastSyncStatus === DocumentSourceSyncStatus.PARTIAL) {
    return canContinue
      ? { state: { ...base, state: "reading" }, syncedAt }
      : { state: { ...base, state: "done", partial: true }, syncedAt };
  }

  if (
    source.lastSyncStatus === DocumentSourceSyncStatus.ERROR ||
    jobStatus === JobStatus.FAILED ||
    jobStatus === JobStatus.CANCELLED
  ) {
    return { state: { ...base, state: "failed" }, syncedAt };
  }
  return { state: { ...base, state: "done" }, syncedAt };
}

async function newestSyncJob(organizationId: string, sourceId: string): Promise<Job | null> {
  return AppDataSource.getRepository(Job)
    .createQueryBuilder("job")
    .where("job.organization_id = :organizationId", { organizationId })
    .andWhere("job.data ->> 'type' = :type", { type: "document_source_sync" })
    .andWhere("job.data ->> 'documentSourceId' = :sourceId", { sourceId })
    .orderBy("job.created_at", "DESC")
    .limit(1)
    .getOne();
}

/** The website source setup reads: the one for the chosen site, else any when none was chosen. */
export async function findSetupSource(
  organizationId: string,
  website?: string,
): Promise<DocumentSource | null> {
  if (website) {
    try {
      return await findWebsiteSource(organizationId, normalizeWebsiteUrl(website).origin);
    } catch {
      return null; // An unreadable address matches no source.
    }
  }
  const sources = await documentSourceRepository.findByOrganization(organizationId);
  return sources.find((s) => s.pluginId === WEBSITE_PLUGIN_ID) ?? null;
}

async function recentSyncJobCount(organizationId: string, sourceId: string): Promise<number> {
  return AppDataSource.getRepository(Job)
    .createQueryBuilder("job")
    .where("job.organization_id = :organizationId", { organizationId })
    .andWhere("job.data ->> 'type' = :type", { type: "document_source_sync" })
    .andWhere("job.data ->> 'documentSourceId' = :sourceId", { sourceId })
    .andWhere("job.created_at > :since", { since: new Date(Date.now() - SYNC_JOB_WINDOW_MS) })
    .getCount();
}

/**
 * The site as setup should show it. With `resume`, a partial read that is idle and still under
 * the job cap is continued (enqueueSync reuses a job already in flight, so this is idempotent).
 */
export async function readSiteState(
  organizationId: string,
  website?: string,
  options: { resume?: boolean } = {},
): Promise<SiteReading> {
  const source = await findSetupSource(organizationId, website);
  // Without a chosen address, show the address of the source we found (sign-up may have made it).
  const address =
    website ?? (typeof source?.config?.url === "string" ? source.config.url : undefined);
  if (!source) return resolveSiteState({ source: null, website });
  const job = await newestSyncJob(organizationId, source.id);
  const progress = (job?.data as { progress?: SyncProgress } | undefined)?.progress;

  const resumed =
    source.lastSyncStatus === DocumentSourceSyncStatus.PARTIAL || !!source.lastSyncCursor;
  const pagesRead = resumed
    ? await documentRepository.countByDocumentSourceId(source.id)
    : undefined;

  let canContinue = false;
  if (source.lastSyncStatus === DocumentSourceSyncStatus.PARTIAL) {
    canContinue = (await recentSyncJobCount(organizationId, source.id)) < MAX_SETUP_SYNC_JOBS;
    if (canContinue && options.resume) {
      try {
        await documentSourceSyncService.enqueueSync(source.id, { forceFullSweep: true });
      } catch (err) {
        logger.warn({ err, organizationId }, "Could not continue reading the website for setup");
      }
    }
  }
  return resolveSiteState({
    source,
    jobStatus: job?.status,
    progress,
    website: address,
    pagesRead,
    canContinue,
  });
}

/**
 * Starts reading the customer's site: reuses the org's website source for this address
 * (re-sweeping it if it is idle), otherwise creates one. Never throws; a bad address shows up
 * as `site.state === "failed"` on the board.
 */
export async function startSiteRead(
  organizationId: string,
  website: string | undefined,
): Promise<{ failed: boolean }> {
  if (!website) return { failed: false };
  try {
    const { origin } = normalizeWebsiteUrl(website);
    const key = `${organizationId}:${origin}`;
    // Blur and Continue can both ask within the same moment; creating a source has no duplicate
    // check, so overlapping calls for one address share a single attempt.
    const running = starting.get(key);
    if (running) return await running;
    const attempt = readOrCreate(organizationId, origin).finally(() => starting.delete(key));
    starting.set(key, attempt);
    return await attempt;
  } catch (err) {
    logger.warn({ err, organizationId }, "Could not start reading the website for setup");
    return { failed: true };
  }
}

const starting = new Map<string, Promise<{ failed: boolean }>>();

async function readOrCreate(organizationId: string, origin: string): Promise<{ failed: boolean }> {
  try {
    const existing = await findWebsiteSource(organizationId, origin);
    if (existing) {
      // A site that was read already is reused as is; only a never-read or failed one is retried.
      // enqueueSync reuses a sync that is already in flight.
      const readable =
        existing.lastSyncedAt && existing.lastSyncStatus !== DocumentSourceSyncStatus.ERROR;
      if (!readable) {
        await documentSourceSyncService.enqueueSync(existing.id, { forceFullSweep: true });
      }
      return { failed: false };
    }
    await createWebsiteSource(organizationId, origin);
    return { failed: false };
  } catch (err) {
    logger.warn({ err, organizationId }, "Could not start reading the website for setup");
    return { failed: true };
  }
}
