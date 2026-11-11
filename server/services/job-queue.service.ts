import { redisService } from "./redis.service";
import { jobRepository } from "../repositories/job.repository";
import { Job, JobStatus } from "../entities/job.entity";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("job-queue");

/**
 * Job `data.type` values that are processed by the background queue worker.
 * Other types (web_import, page_discovery, ...) are dispatched inline by their
 * initiating route and must NOT be listed here, or the worker would race the
 * inline processor.
 */
const BACKGROUND_JOB_TYPES = [
  "document_source_sync",
  "organization_export",
  "privacy_export",
  "privacy_deletion",
];

/**
 * How long a job may sit in `processing` without an update before its server is
 * presumed dead. Privacy types are recovered by PrivacyService, because their
 * request row has to fail with the job.
 */
const STALE_PROCESSING_MS: Record<string, number> = {
  document_source_sync: 15 * 60 * 1000,
  organization_export: 2 * 60 * 60 * 1000,
};

/** How often a running job shows it is alive; well inside the shortest window above. */
const JOB_HEARTBEAT_MS = 5 * 60 * 1000;

/** A job that keeps losing its server this many times is failed instead of requeued. */
const MAX_JOB_ATTEMPTS = 3;

/** Partial job state changes published on the job-updates channel. */
interface JobUpdate {
  status?: JobStatus;
  progress?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
}

/** Full payload broadcast on the job-updates channel. */
interface JobUpdateEvent extends JobUpdate {
  jobId: string;
  organizationId: string;
  timestamp: string;
}

function isJobUpdateEvent(value: unknown): value is JobUpdateEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).jobId === "string"
  );
}

/**
 * Job Queue Service
 * Manages background jobs using Redis for persistence and pub/sub
 */
export class JobQueueService {
  private readonly JOB_CHANNEL = "job:updates";
  private readonly JOB_QUEUE_KEY = "jobs:queue";
  private isProcessing = false;
  private stopping = false;
  private inFlight: Promise<void> | null = null;

  /**
   * Initialize the job queue service
   */
  async initialize(): Promise<void> {
    // Ensure Redis is initialized
    if (!redisService.isConnected()) {
      await redisService.initialize();
    }

    // Subscribe to job updates channel
    await redisService.subscribe(this.JOB_CHANNEL, (event) => {
      this.handleJobUpdate(event);
    });

    // Start processing jobs
    this.startProcessing();

    logger.info("Job queue service initialized");
  }

  /**
   * Publish a job update event to Redis
   */
  async publishJobUpdate(jobId: string, organizationId: string, update: JobUpdate): Promise<void> {
    await redisService.publish(this.JOB_CHANNEL, {
      jobId,
      organizationId,
      ...update,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle incoming job update from Redis
   */
  private handleJobUpdate(event: unknown): void {
    if (!isJobUpdateEvent(event)) {
      logger.warn({ event }, "Ignoring malformed job update event");
      return;
    }

    logger.debug(
      {
        jobId: event.jobId,
        status: event.status,
        hasProgress: !!event.progress,
      },
      "Job update received",
    );
  }

  /**
   * Start the job processing loop
   * NOTE: Job processing is now handled by the scheduler service
   * See: server/services/scheduled-jobs.registry.ts -> 'job-queue-processing'
   */
  private startProcessing(): void {
    // No-op: Processing is now handled by scheduler
    logger.debug("Job processing handled by scheduler service");
  }

  /**
   * Process the next available job
   * Called by the scheduler service for background job processing
   */
  async processNextJob(): Promise<void> {
    // Most job types are processed inline by their initiating route (web import,
    // page discovery). Background-dispatched types claim a row
    // here and route to their handler service.
    if (this.isProcessing || this.stopping) {
      return;
    }
    this.isProcessing = true;
    this.inFlight = this.runNextJob().finally(() => {
      this.isProcessing = false;
      this.inFlight = null;
    });
    await this.inFlight;
  }

  private async runNextJob(): Promise<void> {
    try {
      const claimed = await this.claimNextBackgroundJob();
      if (!claimed) {
        return;
      }
      await this.dispatchBackgroundJob(claimed);
    } catch (err) {
      logger.error({ err }, "Background job processing error");
    }
  }

  /**
   * Requeue background jobs whose server died mid-run; a job that has done so
   * MAX_JOB_ATTEMPTS times is failed instead.
   */
  async requeueStaleJobs(now = new Date()): Promise<{ requeued: number; failed: number }> {
    const { AppDataSource } = await import("../database/data-source");
    const result = { requeued: 0, failed: 0 };

    for (const [type, staleAfterMs] of Object.entries(STALE_PROCESSING_MS)) {
      const [rows]: [Array<{ status: string }>, number] = await AppDataSource.query(
        `UPDATE jobs
         SET status = CASE WHEN COALESCE((data->>'attempts')::int, 0) + 1 >= $3
                           THEN 'failed'::jobs_status_enum ELSE 'queued'::jobs_status_enum END,
             data = jsonb_set(data, '{attempts}', to_jsonb(COALESCE((data->>'attempts')::int, 0) + 1)),
             updated_at = now()
         WHERE status = 'processing' AND data->>'type' = $1 AND updated_at < $2
         RETURNING status`,
        [type, new Date(now.getTime() - staleAfterMs), MAX_JOB_ATTEMPTS],
      );
      const failed = rows.filter((row) => row.status === "failed").length;
      result.failed += failed;
      result.requeued += rows.length - failed;
    }

    if (result.requeued + result.failed > 0) {
      logger.warn(result, "Stale background jobs handled");
    }
    return result;
  }

  /**
   * Atomically claim the next QUEUED background job. Returns null when nothing
   * is eligible. Only job types listed in BACKGROUND_JOB_TYPES are claimed here;
   * inline-processed jobs are left alone.
   */
  private async claimNextBackgroundJob(): Promise<Job | null> {
    const { AppDataSource } = await import("../database/data-source");
    if (!AppDataSource.isInitialized) {
      return null;
    }
    // TypeORM's postgres driver returns `[rows, affectedCount]` for
    // UPDATE ... RETURNING, not a flat rows array. Destructure the rows half;
    // treating the whole tuple as the rows array makes `.length` always 2 and
    // `rows[0].id` undefined, which then claims an arbitrary job via findById.
    const [claimedRows]: [Array<{ id: string }>, number] = await AppDataSource.query(
      `UPDATE jobs
       SET status = 'processing', updated_at = now()
       WHERE id = (
         SELECT id FROM jobs
         WHERE status = 'queued'
           AND data->>'type' = ANY($1::text[])
         ORDER BY priority DESC, created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id`,
      [BACKGROUND_JOB_TYPES],
    );
    if (!claimedRows || claimedRows.length === 0) {
      return null;
    }
    return jobRepository.findById(claimedRows[0].id);
  }

  /**
   * Route a claimed background job to its handler by `data.type`.
   */
  private async dispatchBackgroundJob(job: Job): Promise<void> {
    const type = (job.data?.type as string | undefined) ?? "";
    const heartbeat =
      type in STALE_PROCESSING_MS
        ? setInterval(() => {
            this.touchRunningJob(job.id).catch((err) =>
              logger.warn({ err, jobId: job.id }, "Job heartbeat failed"),
            );
          }, JOB_HEARTBEAT_MS)
        : undefined;
    heartbeat?.unref();
    try {
      switch (type) {
        case "document_source_sync": {
          const { documentSourceSyncService } = await import("./document-source-sync.service");
          const { continueNow } = await documentSourceSyncService.processSyncJob(job);
          // processSyncJob is responsible for setting the terminal status
          // (success/partial/failed) via the document-source repository. We
          // mark the Job row complete here so the queue doesn't re-claim it.
          await this.completeJob(job.id, job.organizationId, { ok: true });
          // A run that hit its time budget with work left continues right away
          // (picked up on the next queue tick, ~5 s) instead of waiting up to
          // 60 s for the dispatcher. Once complete, the job is no longer "in
          // flight", so enqueueSync creates the follow-up instead of reusing it.
          const documentSourceId = job.data?.documentSourceId as string | undefined;
          if (continueNow && documentSourceId) {
            await documentSourceSyncService
              .enqueueSync(documentSourceId)
              .catch((err) =>
                logger.error({ err, documentSourceId }, "Failed to queue sync continuation"),
              );
          }
          return;
        }
        case "organization_export": {
          const { organizationExportService } = await import("./organization-export.service");
          const result = await organizationExportService.processJob(job);
          await this.completeJob(job.id, job.organizationId, result);
          return;
        }
        case "privacy_export":
        case "privacy_deletion": {
          const { privacyService } = await import("./privacy.service");
          const result = await privacyService.processJob(job);
          await this.completeJob(job.id, job.organizationId, result);
          return;
        }
        default:
          logger.warn({ jobId: job.id, type }, "No background handler for job type");
          await this.failJob(job.id, job.organizationId, `No handler for job type: ${type}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, jobId: job.id, type }, "Background job handler failed");
      await this.failJob(job.id, job.organizationId, message);
    } finally {
      clearInterval(heartbeat);
    }
  }

  /** Keeps a job this server is still working on out of `requeueStaleJobs`. */
  async touchRunningJob(jobId: string): Promise<void> {
    const { AppDataSource } = await import("../database/data-source");
    await AppDataSource.query(
      `UPDATE jobs SET updated_at = now() WHERE id = $1 AND status = 'processing'`,
      [jobId],
    );
  }

  /**
   * Update job status and publish to Redis
   */
  async updateJobStatus(
    jobId: string,
    organizationId: string,
    update: {
      status?: JobStatus;
      data?: Record<string, unknown>;
      result?: Record<string, unknown>;
    },
  ): Promise<Job | null> {
    // Update job in database
    const job = await jobRepository.update(jobId, organizationId, update);

    if (!job) {
      logger.error({ jobId }, "Failed to update job");
      return null;
    }

    // Publish update to Redis for WebSocket broadcasting
    await this.publishJobUpdate(jobId, organizationId, {
      status: job.status,
      progress: job.data?.progress as Record<string, unknown>,
      result: job.result,
    });

    return job;
  }

  /**
   * Update job progress and publish to Redis
   */
  async updateJobProgress(
    jobId: string,
    organizationId: string,
    progress: Record<string, unknown>,
  ): Promise<Job | null> {
    // Get current job data
    const job = await jobRepository.findByIdAndOrganization(jobId, organizationId);
    if (!job) {
      return null;
    }

    // Merge progress with existing data
    const updatedData = {
      ...job.data,
      progress: {
        ...((job.data?.progress as Record<string, unknown>) || {}),
        ...progress,
      },
    };

    // Update job with new progress
    return this.updateJobStatus(jobId, organizationId, {
      data: updatedData,
    });
  }

  /**
   * Mark job as failed
   */
  async failJob(jobId: string, organizationId: string, error: string): Promise<Job | null> {
    return this.updateJobStatus(jobId, organizationId, {
      status: JobStatus.FAILED,
      result: { error },
    });
  }

  /**
   * Mark job as completed
   */
  async completeJob(
    jobId: string,
    organizationId: string,
    result: Record<string, unknown>,
  ): Promise<Job | null> {
    return this.updateJobStatus(jobId, organizationId, {
      status: JobStatus.COMPLETED,
      result,
    });
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId: string, organizationId: string): Promise<Job | null> {
    const job = await jobRepository.findByIdAndOrganization(jobId, organizationId);

    if (!job) {
      logger.error({ jobId }, "Job not found or unauthorized");
      return null;
    }

    // Only cancel jobs that are not already completed or failed
    if (job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED) {
      logger.debug({ jobId, status: job.status }, "Cannot cancel job - already terminal");
      return job;
    }

    logger.debug({ jobId }, "Cancelling job");

    return this.updateJobStatus(jobId, organizationId, {
      status: JobStatus.CANCELLED,
      result: {
        message: "Job cancelled by user",
        cancelledAt: new Date().toISOString(),
      },
    });
  }

  /**
   * Stop claiming jobs and wait, up to timeoutMs, for the one in progress.
   */
  async shutdown(timeoutMs = 15000): Promise<void> {
    this.stopping = true;
    if (this.inFlight) {
      let timer: NodeJS.Timeout | undefined;
      const finished = await Promise.race([
        this.inFlight.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
      clearTimeout(timer);
      if (!finished) {
        logger.warn({ timeoutMs }, "Background job still running at shutdown");
      }
    }
    logger.info("Job queue service shut down");
  }
}

// Export singleton instance
export const jobQueueService = new JobQueueService();
