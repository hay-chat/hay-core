import { AppDataSource } from "@server/database/data-source";
import { Job, JobStatus } from "@server/entities/job.entity";
import {
  DocumentSourceSyncStatus,
  type DocumentSource,
} from "@server/entities/document-source.entity";
import { documentSourceRepository } from "@server/repositories/document-source.repository";
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
}): SiteReading {
  const { source, jobStatus, progress, website } = input;
  // A chosen address with no source behind it means reading never started (bad address).
  if (!source) {
    return { state: { state: website ? "failed" : "none", website, discovered: 0, processed: 0 } };
  }

  const base = {
    sourceId: source.id,
    website,
    discovered: progress?.discovered ?? 0,
    processed: progress?.processed ?? 0,
    ...(typeof progress?.total === "number" ? { total: progress.total } : {}),
  };
  const syncedAt = source.lastSyncedAt?.toISOString();

  const running =
    (jobStatus !== undefined && ACTIVE_JOB_STATUSES.includes(jobStatus)) ||
    source.lastSyncStatus === DocumentSourceSyncStatus.RUNNING;
  // A source that was never read and has no job yet is about to start, not finished.
  const notStarted = !source.lastSyncedAt && jobStatus === undefined;
  if (running || notStarted) return { state: { ...base, state: "reading" }, syncedAt };

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

export async function readSiteState(
  organizationId: string,
  website?: string,
): Promise<SiteReading> {
  const source = await findSetupSource(organizationId, website);
  if (!source) return resolveSiteState({ source: null, website });
  const job = await newestSyncJob(organizationId, source.id);
  const progress = (job?.data as { progress?: SyncProgress } | undefined)?.progress;
  return resolveSiteState({ source, jobStatus: job?.status, progress, website });
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
