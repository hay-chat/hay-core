import { AppDataSource } from "@server/database/data-source";
import { ScheduledJob } from "@server/entities/scheduled-job.entity";
import { ScheduledJobHistory } from "@server/entities/scheduled-job-history.entity";
import { createLogger } from "@server/lib/logger";
import * as cron from "node-cron";
import type { QueryRunner } from "typeorm";

const logger = createLogger("scheduler");

/** Namespace for the scheduler's advisory lock keys. */
const CLUSTER_LOCK_PREFIX = "scheduler:";

class JobTimeoutError extends Error {
  constructor(timeout: number) {
    super(`Job timeout after ${timeout}ms`);
  }
}

export type CronJobConfig = {
  name: string; // Unique job identifier
  description: string; // Human-readable description
  schedule: string | number; // Cron expression or interval in ms
  handler: () => Promise<void>; // Job handler function
  enabled?: boolean; // Enable/disable job (default: true)
  timeout?: number; // Max execution time in ms
  retryOnFailure?: boolean; // Retry failed jobs
  maxRetries?: number; // Max retry attempts
  runOnStartup?: boolean; // Run immediately on service start
  singleton?: boolean; // Prevent concurrent executions
  // Run on every server instance (in-memory or local-process work). Default:
  // one instance at a time cluster-wide, via a Postgres advisory lock.
  perInstance?: boolean;
  skipDatabaseLogging?: boolean; // Skip saving execution history to database (default: false)
};

type RegisteredJob = {
  config: CronJobConfig;
  timer?: NodeJS.Timeout; // For interval-based jobs
  cronTask?: cron.ScheduledTask; // For cron-based jobs
  isRunning: boolean;
  lastRun?: Date;
  lastStatus?: "success" | "failed" | "timeout";
  lastError?: string;
  lastDuration?: number;
  totalRuns: number;
  totalFailures: number;
  totalDuration: number; // For calculating average
};

export type JobStatus = {
  name: string;
  description: string;
  schedule: string | number;
  enabled: boolean;
  isRunning: boolean;
  lastRun?: Date;
  lastStatus?: "success" | "failed" | "timeout";
  lastError?: string;
  lastDuration?: number;
  totalRuns: number;
  totalFailures: number;
  averageDuration: number;
  nextRun?: Date;
};

export type ShutdownOptions = {
  gracefulTimeout?: number; // Wait time for running jobs to finish
};

/**
 * Scheduler Service
 * Centralized management of scheduled tasks and cron jobs
 */
export class SchedulerService {
  private jobs: Map<string, RegisteredJob> = new Map();
  private isInitialized = false;
  private isShuttingDown = false;
  private lockRunner: QueryRunner | null = null;

  /**
   * Initialize the scheduler service
   * Loads job history from database
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn("Already initialized");
      return;
    }

    logger.debug("Initializing scheduler service");

    // Load job history from database to restore stats
    try {
      if (AppDataSource.isInitialized) {
        const scheduledJobRepo = AppDataSource.getRepository(ScheduledJob);
        const existingJobs = await scheduledJobRepo.find();

        logger.debug({ count: existingJobs.length }, "Loaded job records from database");
      }
    } catch (error) {
      logger.error({ err: error }, "Failed to load job history");
      // Continue initialization even if database load fails
    }

    this.isInitialized = true;
    logger.info("Scheduler service initialized");
  }

  /**
   * Register a new scheduled job
   */
  registerJob(config: CronJobConfig): void {
    if (!this.isInitialized) {
      throw new Error("Scheduler service not initialized. Call initialize() first.");
    }

    if (this.jobs.has(config.name)) {
      throw new Error(`Job '${config.name}' is already registered`);
    }

    // Validate config
    this.validateJobConfig(config);

    // Create registered job
    const registeredJob: RegisteredJob = {
      config,
      isRunning: false,
      totalRuns: 0,
      totalFailures: 0,
      totalDuration: 0,
    };

    // Store job
    this.jobs.set(config.name, registeredJob);

    // Schedule job if enabled
    if (config.enabled !== false) {
      this.scheduleJob(config.name);

      // Run immediately if requested
      if (config.runOnStartup) {
        setImmediate(() => this.executeJob(config.name));
      }
    }

    logger.debug(
      { jobName: config.name, schedule: config.schedule, enabled: config.enabled !== false },
      "Registered job",
    );
  }

  /**
   * Unregister a job
   */
  unregisterJob(name: string): void {
    const job = this.jobs.get(name);
    if (!job) {
      throw new Error(`Job '${name}' not found`);
    }

    // Stop the job
    this.stopJob(name);

    // Remove from registry
    this.jobs.delete(name);

    logger.debug({ jobName: name }, "Unregistered job");
  }

  /**
   * Enable a job
   */
  enableJob(name: string): void {
    const job = this.jobs.get(name);
    if (!job) {
      throw new Error(`Job '${name}' not found`);
    }

    job.config.enabled = true;
    this.scheduleJob(name);

    logger.debug({ jobName: name }, "Enabled job");
  }

  /**
   * Disable a job
   */
  disableJob(name: string): void {
    const job = this.jobs.get(name);
    if (!job) {
      throw new Error(`Job '${name}' not found`);
    }

    job.config.enabled = false;
    this.stopJob(name);

    logger.debug({ jobName: name }, "Disabled job");
  }

  /**
   * Manually run a job (ignores schedule)
   */
  async runJob(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) {
      throw new Error(`Job '${name}' not found`);
    }

    logger.debug({ jobName: name }, "Manually triggered job");
    await this.executeJob(name);
  }

  /**
   * Get status of a specific job
   */
  getJobStatus(name: string): JobStatus | null {
    const job = this.jobs.get(name);
    if (!job) {
      return null;
    }

    return {
      name: job.config.name,
      description: job.config.description,
      schedule: job.config.schedule,
      enabled: job.config.enabled !== false,
      isRunning: job.isRunning,
      lastRun: job.lastRun,
      lastStatus: job.lastStatus,
      lastError: job.lastError,
      lastDuration: job.lastDuration,
      totalRuns: job.totalRuns,
      totalFailures: job.totalFailures,
      averageDuration: job.totalRuns > 0 ? job.totalDuration / job.totalRuns : 0,
      nextRun: this.getNextRunTime(name),
    };
  }

  /**
   * Get status of all jobs
   */
  getJobStatuses(): JobStatus[] {
    return Array.from(this.jobs.keys()).map((name) => this.getJobStatus(name)!);
  }

  /**
   * Gracefully shutdown the scheduler
   */
  async shutdown(options?: ShutdownOptions): Promise<void> {
    this.isShuttingDown = true;
    const gracefulTimeout = options?.gracefulTimeout || 30000;

    logger.info("Shutting down scheduler service...");

    // Stop accepting new job executions
    const runningJobs = Array.from(this.jobs.entries())
      .filter(([_, job]) => job.isRunning)
      .map(([name]) => name);

    if (runningJobs.length > 0) {
      logger.info(
        { count: runningJobs.length, jobs: runningJobs },
        "Waiting for running jobs to complete",
      );

      // Wait for running jobs with timeout
      const waitStart = Date.now();
      while (runningJobs.some((name) => this.jobs.get(name)?.isRunning)) {
        if (Date.now() - waitStart > gracefulTimeout) {
          logger.warn("Graceful timeout exceeded, forcing shutdown");
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // Stop all jobs
    for (const name of this.jobs.keys()) {
      this.stopJob(name);
    }

    // Clear all jobs
    this.jobs.clear();
    await this.closeLockRunner();

    this.isInitialized = false;
    logger.info("Scheduler service shut down");
  }

  /**
   * Schedule a job based on its configuration
   */
  private scheduleJob(name: string): void {
    const job = this.jobs.get(name);
    if (!job) return;

    // Clear existing schedule
    this.stopJob(name);

    const { schedule } = job.config;

    if (typeof schedule === "number") {
      // Interval-based scheduling
      job.timer = setInterval(() => {
        this.executeJob(name);
      }, schedule);

      logger.debug({ jobName: name, intervalMs: schedule }, "Scheduled interval job");
    } else {
      // Cron-based scheduling
      try {
        job.cronTask = cron.schedule(schedule, () => {
          this.executeJob(name);
        });

        logger.debug({ jobName: name, schedule }, "Scheduled cron job");
      } catch (error) {
        logger.error({ err: error, jobName: name }, "Failed to schedule cron job");
        throw error;
      }
    }
  }

  /**
   * Stop a job's schedule (doesn't unregister it)
   */
  private stopJob(name: string): void {
    const job = this.jobs.get(name);
    if (!job) return;

    // Clear interval timer
    if (job.timer) {
      clearInterval(job.timer);
      job.timer = undefined;
    }

    // Stop cron task
    if (job.cronTask) {
      job.cronTask.stop();
      job.cronTask = undefined;
    }
  }

  /**
   * Execute a job with error handling, timeout, and retries.
   *
   * Unless the job is `perInstance`, a Postgres advisory lock makes sure only
   * one server instance runs it at a time; an instance that cannot take the
   * lock skips the run.
   */
  private async executeJob(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) return;

    // Skip if shutting down
    if (this.isShuttingDown) {
      logger.debug({ jobName: name }, "Skipping job - scheduler is shutting down");
      return;
    }

    // Check singleton constraint
    if (job.config.singleton && job.isRunning) {
      logger.debug({ jobName: name }, "Skipping job - already running (singleton)");
      return;
    }

    // Mark as running
    job.isRunning = true;
    let locked = false;

    try {
      if (!job.config.perInstance) {
        locked = await this.tryAcquireClusterLock(name);
        if (!locked) {
          logger.debug({ jobName: name }, "Skipping job - running on another instance");
          return;
        }
      }

      const maxRetries = job.config.retryOnFailure ? (job.config.maxRetries ?? 0) : 0;
      for (let retryCount = 0; ; retryCount++) {
        const outcome = await this.runOnce(job, name);
        const canRetry =
          outcome.status === "failed" && retryCount < maxRetries && !this.isShuttingDown;

        if (canRetry) {
          logger.info({ jobName: name, attempt: retryCount + 1, maxRetries }, "Retrying job");
          await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1s between retries
          continue;
        }

        // Save to database (unless skipped)
        if (!job.config.skipDatabaseLogging) {
          await this.saveJobExecution(name, outcome.status, outcome.duration, outcome.error);
        }
        return;
      }
    } finally {
      if (locked) {
        await this.releaseClusterLock(name);
      }
      job.isRunning = false;
    }
  }

  /**
   * Run the handler once and record the outcome on the job. When the timeout
   * fires the run is reported as timed out, but this still waits for the
   * handler to settle so the job is never marked idle (or unlocked) while
   * its handler is still running.
   */
  private async runOnce(
    job: RegisteredJob,
    name: string,
  ): Promise<{ status: "success" | "failed" | "timeout"; duration: number; error?: string }> {
    const startTime = Date.now();
    const run = Promise.resolve().then(() => job.config.handler());

    let status: "success" | "failed" | "timeout" = "success";
    let errorMessage: string | undefined;
    try {
      if (job.config.timeout) {
        await this.waitWithTimeout(run, job.config.timeout);
      } else {
        await run;
      }
    } catch (error) {
      status = error instanceof JobTimeoutError ? "timeout" : "failed";
      errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ err: error, jobName: name }, "Job failed");
    }

    const duration = Date.now() - startTime;
    job.lastRun = new Date();
    job.lastStatus = status;
    job.lastError = errorMessage;
    job.lastDuration = duration;
    job.totalRuns++;
    job.totalDuration += duration;
    if (status !== "success") {
      job.totalFailures++;
    }

    if (status === "timeout") {
      await run.catch(() => undefined);
      logger.warn(
        { jobName: name, durationMs: Date.now() - startTime },
        "Timed-out job handler finished",
      );
    }

    return { status, duration, error: errorMessage };
  }

  /**
   * Wait for a run, rejecting with JobTimeoutError after `timeout` ms. The
   * run itself is not cancelled.
   */
  private async waitWithTimeout(run: Promise<void>, timeout: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        run,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new JobTimeoutError(timeout)), timeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Take the cluster-wide lock for a job on the scheduler's dedicated
   * connection (session-level advisory locks belong to one connection).
   * Without a database there is nothing to coordinate with, so the job runs.
   */
  private async tryAcquireClusterLock(name: string): Promise<boolean> {
    if (!AppDataSource.isInitialized) {
      return true;
    }
    try {
      const runner = await this.getLockRunner();
      const [row] = await runner.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [
        `${CLUSTER_LOCK_PREFIX}${name}`,
      ]);
      return row?.locked === true;
    } catch (error) {
      logger.error({ err: error, jobName: name }, "Could not take job lock, skipping run");
      await this.closeLockRunner();
      return false;
    }
  }

  private async releaseClusterLock(name: string): Promise<void> {
    try {
      await this.lockRunner?.query("SELECT pg_advisory_unlock(hashtext($1))", [
        `${CLUSTER_LOCK_PREFIX}${name}`,
      ]);
    } catch (error) {
      // A lost connection releases its session locks on the server side.
      logger.warn({ err: error, jobName: name }, "Could not release job lock");
      await this.closeLockRunner();
    }
  }

  private async getLockRunner(): Promise<QueryRunner> {
    if (!this.lockRunner || this.lockRunner.isReleased) {
      this.lockRunner = AppDataSource.createQueryRunner();
      await this.lockRunner.connect();
    }
    return this.lockRunner;
  }

  private async closeLockRunner(): Promise<void> {
    const runner = this.lockRunner;
    this.lockRunner = null;
    try {
      await runner?.release();
    } catch {
      // Connection already gone
    }
  }

  /**
   * Save job execution to database
   */
  private async saveJobExecution(
    jobName: string,
    status: "success" | "failed" | "timeout",
    duration: number,
    error?: string,
  ): Promise<void> {
    try {
      if (!AppDataSource.isInitialized) return;

      const scheduledJobRepo = AppDataSource.getRepository(ScheduledJob);
      const historyRepo = AppDataSource.getRepository(ScheduledJobHistory);

      const job = this.jobs.get(jobName);
      if (!job) return;

      // Update or create scheduled job record
      let scheduledJob = await scheduledJobRepo.findOne({ where: { name: jobName } });

      if (!scheduledJob) {
        scheduledJob = scheduledJobRepo.create({
          name: jobName,
          description: job.config.description,
          schedule: String(job.config.schedule),
          enabled: job.config.enabled !== false,
        });
      }

      scheduledJob.lastRun = new Date();
      scheduledJob.lastStatus = status;
      scheduledJob.lastError = error;
      scheduledJob.totalRuns = job.totalRuns;
      scheduledJob.totalFailures = job.totalFailures;
      scheduledJob.averageDuration =
        job.totalRuns > 0 ? Math.round(job.totalDuration / job.totalRuns) : 0;

      await scheduledJobRepo.save(scheduledJob);

      // Create history record
      const history = historyRepo.create({
        jobName,
        startedAt: new Date(Date.now() - duration),
        completedAt: new Date(),
        status,
        duration,
        error,
      });

      await historyRepo.save(history);
    } catch (error) {
      logger.error({ err: error }, "Failed to save job execution to database");
      // Don't throw - database errors shouldn't stop job execution
    }
  }

  /**
   * Get next run time for a job (best effort)
   */
  private getNextRunTime(name: string): Date | undefined {
    const job = this.jobs.get(name);
    if (!job || job.config.enabled === false) return undefined;

    if (typeof job.config.schedule === "number") {
      // For interval jobs, next run is lastRun + interval
      if (job.lastRun) {
        return new Date(job.lastRun.getTime() + job.config.schedule);
      }
      // If never run, next run is now + interval
      return new Date(Date.now() + job.config.schedule);
    }

    // For cron jobs, we can't easily calculate next run without parsing the cron expression
    // This would require additional library support
    return undefined;
  }

  /**
   * Validate job configuration
   */
  private validateJobConfig(config: CronJobConfig): void {
    if (!config.name || config.name.trim() === "") {
      throw new Error("Job name is required");
    }

    if (!config.description || config.description.trim() === "") {
      throw new Error("Job description is required");
    }

    if (!config.handler || typeof config.handler !== "function") {
      throw new Error("Job handler must be a function");
    }

    // Validate schedule
    if (typeof config.schedule === "number") {
      if (config.schedule < 1000) {
        throw new Error("Interval must be at least 1000ms (1 second)");
      }
    } else if (typeof config.schedule === "string") {
      // Validate cron expression
      if (!cron.validate(config.schedule)) {
        throw new Error(`Invalid cron expression: ${config.schedule}`);
      }
    } else {
      throw new Error("Schedule must be a number (ms) or cron expression string");
    }

    // Validate timeout
    if (config.timeout !== undefined && config.timeout < 1000) {
      throw new Error("Timeout must be at least 1000ms (1 second)");
    }

    // Validate retries
    if (config.maxRetries !== undefined && config.maxRetries < 1) {
      throw new Error("maxRetries must be at least 1");
    }
  }
}

// Export singleton instance
export const schedulerService = new SchedulerService();
