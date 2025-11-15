import { redisService } from "./redis.service";
import { jobRepository } from "../repositories/job.repository";
import { Job, JobStatus } from "../entities/job.entity";
import { debugLog } from "@server/lib/debug-logger";

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

    debugLog("job-queue", "Job queue service initialized");
  }

  /**
   * Publish a job update event to Redis
   */
  async publishJobUpdate(
    jobId: string,
    organizationId: string,
    update: {
      status?: JobStatus;
      progress?: Record<string, unknown>;
      result?: Record<string, unknown>;
      error?: string;
    },
  ): Promise<void> {
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
  private handleJobUpdate(event: any): void {
    debugLog("job-queue", "Job update received", {
      jobId: event.jobId,
      status: event.status,
      hasProgress: !!event.progress,
    });
  }

  /**
   * Start the job processing loop
   * NOTE: Job processing is now handled by the scheduler service
   * See: server/services/scheduled-jobs.registry.ts -> 'job-queue-processing'
   */
  private startProcessing(): void {
    // No-op: Processing is now handled by scheduler
    debugLog("job-queue", "Job processing handled by scheduler service");
  }

  /**
   * Stop the job processing loop
   * NOTE: Job processing is now handled by the scheduler service
   */
  private stopProcessing(): void {
    // No-op: Processing is now handled by scheduler
    debugLog("job-queue", "Job processing handled by scheduler service");
  }

  /**
   * Process the next available job
   * Called by the scheduler service for background job processing
   */
  async processNextJob(): Promise<void> {
    // This is a placeholder for future job processing
    // Jobs are currently processed inline in the import functions
    // In the future, we can move job processing here for true background processing
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
      console.error(`[JobQueue] Failed to update job ${jobId}`);
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
      console.error(`[JobQueue] Job ${jobId} not found or unauthorized`);
      return null;
    }

    // Only cancel jobs that are not already completed or failed
    if (job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED) {
      debugLog("job-queue", `Cannot cancel job ${jobId} - already ${job.status}`);
      return job;
    }

    debugLog("job-queue", `Cancelling job ${jobId}`);

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
    debugLog("job-queue", "Job queue service shut down");
  }
}

// Export singleton instance
export const jobQueueService = new JobQueueService();
