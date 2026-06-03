import { redisService } from "./redis.service";
import { jobRepository } from "../repositories/job.repository";
import { Job, JobStatus } from "../entities/job.entity";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("job-queue");

/**
 * Job `data.type` values that are processed by the background queue worker.
 * Other types (web_import, page_discovery, privacy export, ...) are dispatched
 * inline by their initiating route and must NOT be listed here, or the worker
 * would race the inline processor.
 */
const BACKGROUND_JOB_TYPES = ["document_source_sync"];

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
   * Stop the job processing loop
   * NOTE: Job processing is now handled by the scheduler service
   */
  private stopProcessing(): void {
    // No-op: Processing is now handled by scheduler
    logger.debug("Job processing handled by scheduler service");
  }

  /**
   * Process the next available job
   * Called by the scheduler service for background job processing
   */
  async processNextJob(): Promise<void> {
    // Most job types are processed inline by their initiating route (web import,
    // page discovery, privacy export). Background-dispatched types claim a row
    // here and route to their handler service.
    if (this.isProcessing) {
      return;
    }
    this.isProcessing = true;
    try {
      const claimed = await this.claimNextBackgroundJob();
      if (!claimed) {
        return;
      }
      await this.dispatchBackgroundJob(claimed);
    } catch (err) {
      logger.error({ err }, "Background job processing error");
    } finally {
      this.isProcessing = false;
    }
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
    const rows: Array<{ id: string }> = await AppDataSource.query(
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
    if (rows.length === 0) {
      return null;
    }
    return jobRepository.findById(rows[0].id);
  }

  /**
   * Route a claimed background job to its handler by `data.type`.
   */
  private async dispatchBackgroundJob(job: Job): Promise<void> {
    const type = (job.data?.type as string | undefined) ?? "";
    try {
      switch (type) {
        case "document_source_sync": {
          const { documentSourceSyncService } = await import("./document-source-sync.service");
          await documentSourceSyncService.processSyncJob(job);
          // processSyncJob is responsible for setting the terminal status
          // (success/partial/failed) via the document-source repository. We
          // mark the Job row complete here so the queue doesn't re-claim it.
          await this.completeJob(job.id, job.organizationId, { ok: true });
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
    }
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
    const job = await jobRepository.findById(jobId);
    if (!job || job.organizationId !== organizationId) {
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
    const job = await jobRepository.findById(jobId);

    if (!job || job.organizationId !== organizationId) {
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
   * Gracefully shutdown the job queue service
   */
  async shutdown(): Promise<void> {
    this.stopProcessing();
    logger.info("Job queue service shut down");
  }
}

// Export singleton instance
export const jobQueueService = new JobQueueService();
