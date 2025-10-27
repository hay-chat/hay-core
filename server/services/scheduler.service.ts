import { AppDataSource } from "@server/database/data-source";
import { ScheduledJob } from "@server/entities/scheduled-job.entity";
import { ScheduledJobHistory } from "@server/entities/scheduled-job-history.entity";
import { debugLog } from "@server/lib/debug-logger";
import * as cron from "node-cron";

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

  /**
   * Initialize the scheduler service
   * Loads job history from database
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.warn("[Scheduler] Already initialized");
      return;
    }

    debugLog("scheduler", "Initializing scheduler service");

    // Load job history from database to restore stats
    try {
      if (AppDataSource.isInitialized) {
        const scheduledJobRepo = AppDataSource.getRepository(ScheduledJob);
        const existingJobs = await scheduledJobRepo.find();

        debugLog("scheduler", `Loaded ${existingJobs.length} job records from database`);
      }
    } catch (error) {
      console.error("[Scheduler] Failed to load job history:", error);
      // Continue initialization even if database load fails
    }

    this.isInitialized = true;
    console.log("[Scheduler] ✓ Scheduler service initialized");
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

    debugLog("scheduler", `Registered job: ${config.name}`, {
      schedule: config.schedule,
      enabled: config.enabled !== false,
    });
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

    debugLog("scheduler", `Unregistered job: ${name}`);
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

    debugLog("scheduler", `Enabled job: ${name}`);
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

    debugLog("scheduler", `Disabled job: ${name}`);
  }

  /**
   * Manually run a job (ignores schedule)
   */
  async runJob(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) {
      throw new Error(`Job '${name}' not found`);
    }

    debugLog("scheduler", `Manually triggered job: ${name}`);
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

    console.log("[Scheduler] Shutting down scheduler service...");

    // Stop accepting new job executions
    const runningJobs = Array.from(this.jobs.entries())
      .filter(([_, job]) => job.isRunning)
      .map(([name]) => name);

    if (runningJobs.length > 0) {
      console.log(`[Scheduler] Waiting for ${runningJobs.length} running jobs to complete...`);
      console.log(`[Scheduler] Running jobs: ${runningJobs.join(", ")}`);

      // Wait for running jobs with timeout
      const waitStart = Date.now();
      while (runningJobs.some((name) => this.jobs.get(name)?.isRunning)) {
        if (Date.now() - waitStart > gracefulTimeout) {
          console.warn("[Scheduler] Graceful timeout exceeded, forcing shutdown");
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

    this.isInitialized = false;
    console.log("[Scheduler] ✓ Scheduler service shut down");
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

      debugLog("scheduler", `Scheduled interval job: ${name} (every ${schedule}ms)`);
    } else {
      // Cron-based scheduling
      try {
        job.cronTask = cron.schedule(schedule, () => {
          this.executeJob(name);
        });

        debugLog("scheduler", `Scheduled cron job: ${name} (${schedule})`);
      } catch (error) {
        console.error(`[Scheduler] Failed to schedule cron job '${name}':`, error);
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
   * Execute a job with error handling, timeout, and retries
   */
  private async executeJob(name: string, retryCount = 0): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) return;

    // Skip if shutting down
    if (this.isShuttingDown) {
      debugLog("scheduler", `Skipping job '${name}' - scheduler is shutting down`);
      return;
    }

    // Check singleton constraint
    if (job.config.singleton && job.isRunning) {
      debugLog("scheduler", `Skipping job '${name}' - already running (singleton)`);
      return;
    }

    // Mark as running
    job.isRunning = true;
    const startTime = Date.now();

    debugLog("scheduler", `Executing job: ${name}`);

    try {
      // Execute with optional timeout
      if (job.config.timeout) {
        await this.executeWithTimeout(job.config.handler, job.config.timeout);
      } else {
        await job.config.handler();
      }

      // Success
      const duration = Date.now() - startTime;
      job.lastRun = new Date();
      job.lastStatus = "success";
      job.lastError = undefined;
      job.lastDuration = duration;
      job.totalRuns++;
      job.totalDuration += duration;

      debugLog("scheduler", `Job completed: ${name} (${duration}ms)`);

      // Save to database (unless skipped)
      if (!job.config.skipDatabaseLogging) {
        await this.saveJobExecution(name, "success", duration);
      }
    } catch (error) {
      // Failure
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      job.lastRun = new Date();
      job.lastStatus = error instanceof Error && error.message.includes("timeout") ? "timeout" : "failed";
      job.lastError = errorMessage;
      job.lastDuration = duration;
      job.totalRuns++;
      job.totalFailures++;
      job.totalDuration += duration;

      console.error(`[Scheduler] Job failed: ${name}`, error);

      // Retry if configured
      if (
        job.config.retryOnFailure &&
        job.config.maxRetries &&
        retryCount < job.config.maxRetries
      ) {
        console.log(`[Scheduler] Retrying job '${name}' (attempt ${retryCount + 1}/${job.config.maxRetries})`);
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1s between retries
        return this.executeJob(name, retryCount + 1);
      }

      // Save to database (unless skipped)
      if (!job.config.skipDatabaseLogging) {
        await this.saveJobExecution(name, job.lastStatus, duration, errorMessage);
      }
    } finally {
      job.isRunning = false;
    }
  }

  /**
   * Execute a function with timeout
   */
  private async executeWithTimeout(
    fn: () => Promise<void>,
    timeout: number,
  ): Promise<void> {
    return Promise.race([
      fn(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error(`Job timeout after ${timeout}ms`)), timeout),
      ),
    ]);
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
      scheduledJob.averageDuration = job.totalRuns > 0 ? Math.round(job.totalDuration / job.totalRuns) : 0;

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
      console.error("[Scheduler] Failed to save job execution to database:", error);
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
