import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { SchedulerService } from "./scheduler.service";

describe("SchedulerService", () => {
  let scheduler: SchedulerService;

  beforeEach(async () => {
    scheduler = new SchedulerService();
    await scheduler.initialize();
  });

  afterEach(async () => {
    await scheduler.shutdown({ gracefulTimeout: 1000 });
  });

  describe("Job Registration", () => {
    it("should register a job with interval schedule", () => {
      const handler = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

      scheduler.registerJob({
        name: "test-interval-job",
        description: "Test interval job",
        schedule: 1000,
        handler,
      });

      const status = scheduler.getJobStatus("test-interval-job");
      expect(status).toBeDefined();
      expect(status?.name).toBe("test-interval-job");
      expect(status?.enabled).toBe(true);
    });

    it("should register a job with cron expression", () => {
      const handler = jest.fn().mockResolvedValue(undefined);

      scheduler.registerJob({
        name: "test-cron-job",
        description: "Test cron job",
        schedule: "*/5 * * * *", // Every 5 minutes
        handler,
      });

      const status = scheduler.getJobStatus("test-cron-job");
      expect(status).toBeDefined();
      expect(status?.schedule).toBe("*/5 * * * *");
    });

    it("should throw error for duplicate job names", () => {
      const handler = jest.fn().mockResolvedValue(undefined);

      scheduler.registerJob({
        name: "duplicate-job",
        description: "First job",
        schedule: 1000,
        handler,
      });

      expect(() => {
        scheduler.registerJob({
          name: "duplicate-job",
          description: "Second job",
          schedule: 2000,
          handler,
        });
      }).toThrow("already registered");
    });

    it("should validate job configuration", () => {
      const handler = jest.fn().mockResolvedValue(undefined);

      // Invalid: empty name
      expect(() => {
        scheduler.registerJob({
          name: "",
          description: "Test",
          schedule: 1000,
          handler,
        });
      }).toThrow("name is required");

      // Invalid: invalid cron expression
      expect(() => {
        scheduler.registerJob({
          name: "invalid-cron",
          description: "Test",
          schedule: "invalid cron",
          handler,
        });
      }).toThrow("Invalid cron expression");

      // Invalid: interval too short
      expect(() => {
        scheduler.registerJob({
          name: "too-fast",
          description: "Test",
          schedule: 500, // Less than 1000ms
          handler,
        });
      }).toThrow("at least 1000ms");
    });
  });

  describe("Job Execution", () => {
    it("should execute job on schedule", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);

      scheduler.registerJob({
        name: "test-execution",
        description: "Test execution",
        schedule: 1000, // 1000ms minimum
        handler,
      });

      // Wait for at least 2 executions
      await new Promise((resolve) => setTimeout(resolve, 2500));

      expect(handler).toHaveBeenCalled();
      expect(handler.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("should handle job errors gracefully", async () => {
      const handler = jest.fn().mockRejectedValue(new Error("Test error"));

      scheduler.registerJob({
        name: "failing-job",
        description: "Job that fails",
        schedule: 1000,
        handler,
      });

      await new Promise((resolve) => setTimeout(resolve, 1500));

      const status = scheduler.getJobStatus("failing-job");
      expect(status?.lastStatus).toBe("failed");
      expect(status?.lastError).toBe("Test error");
      expect(status?.totalFailures).toBeGreaterThan(0);
    });

    it("should retry failed jobs when configured", async () => {
      let attempts = 0;
      const handler = jest.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error("Temporary failure");
        }
        return undefined;
      });

      scheduler.registerJob({
        name: "retry-job",
        description: "Job with retries",
        schedule: 1000,
        handler,
        retryOnFailure: true,
        maxRetries: 3,
      });

      // Trigger manual execution to test retries
      await scheduler.runJob("retry-job");

      // Should have been called 3 times (initial + 2 retries)
      expect(handler).toHaveBeenCalledTimes(3);
    });

    it("should enforce timeout on jobs", async () => {
      const handler = jest.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 3000)); // Takes 3000ms
      });

      scheduler.registerJob({
        name: "timeout-job",
        description: "Job with timeout",
        schedule: 5000,
        handler,
        timeout: 1000, // Timeout after 1000ms
      });

      await scheduler.runJob("timeout-job");

      const status = scheduler.getJobStatus("timeout-job");
      expect(status?.lastStatus).toBe("timeout");
      expect(status?.lastError).toContain("timeout");
    });

    it("should enforce singleton constraint", async () => {
      let concurrentExecutions = 0;
      let maxConcurrent = 0;

      const handler = jest.fn().mockImplementation(async () => {
        concurrentExecutions++;
        maxConcurrent = Math.max(maxConcurrent, concurrentExecutions);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        concurrentExecutions--;
      });

      scheduler.registerJob({
        name: "singleton-job",
        description: "Singleton job",
        schedule: 1000, // Try to run every 1000ms
        handler,
        singleton: true,
      });

      // Wait for multiple potential executions
      await new Promise((resolve) => setTimeout(resolve, 4000));

      // Max concurrent should never exceed 1
      expect(maxConcurrent).toBe(1);
    });
  });

  describe("Job Control", () => {
    it("should enable and disable jobs", () => {
      const handler = jest.fn().mockResolvedValue(undefined);

      scheduler.registerJob({
        name: "toggle-job",
        description: "Job to toggle",
        schedule: 1000,
        handler,
        enabled: false,
      });

      let status = scheduler.getJobStatus("toggle-job");
      expect(status?.enabled).toBe(false);

      scheduler.enableJob("toggle-job");
      status = scheduler.getJobStatus("toggle-job");
      expect(status?.enabled).toBe(true);

      scheduler.disableJob("toggle-job");
      status = scheduler.getJobStatus("toggle-job");
      expect(status?.enabled).toBe(false);
    });

    it("should manually trigger jobs", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);

      scheduler.registerJob({
        name: "manual-job",
        description: "Manually triggered job",
        schedule: 10000, // Long interval
        handler,
        enabled: false, // Start disabled
      });

      await scheduler.runJob("manual-job");

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should unregister jobs", () => {
      const handler = jest.fn().mockResolvedValue(undefined);

      scheduler.registerJob({
        name: "temp-job",
        description: "Temporary job",
        schedule: 1000,
        handler,
      });

      expect(scheduler.getJobStatus("temp-job")).toBeDefined();

      scheduler.unregisterJob("temp-job");

      expect(scheduler.getJobStatus("temp-job")).toBeNull();
    });
  });

  describe("Job Status & Monitoring", () => {
    it("should track job execution statistics", async () => {
      // Add a small delay to ensure measurable duration
      const handler = jest.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      scheduler.registerJob({
        name: "stats-job",
        description: "Job for stats",
        schedule: 1000,
        handler,
      });

      await new Promise((resolve) => setTimeout(resolve, 3500));

      const status = scheduler.getJobStatus("stats-job");
      expect(status?.totalRuns).toBeGreaterThan(0);
      expect(status?.lastRun).toBeInstanceOf(Date);
      expect(status?.lastStatus).toBe("success");
      expect(status?.averageDuration).toBeGreaterThanOrEqual(0);
    });

    it("should return all job statuses", () => {
      const handler = jest.fn().mockResolvedValue(undefined);

      scheduler.registerJob({
        name: "job-1",
        description: "First job",
        schedule: 1000,
        handler,
      });

      scheduler.registerJob({
        name: "job-2",
        description: "Second job",
        schedule: 2000,
        handler,
      });

      const statuses = scheduler.getJobStatuses();
      expect(statuses).toHaveLength(2);
      expect(statuses.map((s) => s.name)).toContain("job-1");
      expect(statuses.map((s) => s.name)).toContain("job-2");
    });
  });

  describe("Graceful Shutdown", () => {
    it("should wait for running jobs to complete", async () => {
      let jobCompleted = false;
      const handler = jest.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        jobCompleted = true;
      });

      scheduler.registerJob({
        name: "long-job",
        description: "Long running job",
        schedule: 1000,
        handler,
      });

      // Trigger the job
      scheduler.runJob("long-job");

      // Wait a bit for job to start
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Shutdown with grace period
      await scheduler.shutdown({ gracefulTimeout: 500 });

      // Job should have completed
      expect(jobCompleted).toBe(true);
    });

    it("should force shutdown after timeout", async () => {
      const handler = jest.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000)); // Takes 5 seconds
      });

      scheduler.registerJob({
        name: "very-long-job",
        description: "Very long job",
        schedule: 1000,
        handler,
      });

      scheduler.runJob("very-long-job");

      await new Promise((resolve) => setTimeout(resolve, 50));

      const startTime = Date.now();
      await scheduler.shutdown({ gracefulTimeout: 200 }); // Only wait 200ms
      const duration = Date.now() - startTime;

      // Shutdown should not wait the full 5 seconds
      expect(duration).toBeLessThan(1000);
    });
  });

  describe("Run on Startup", () => {
    it("should run job immediately if runOnStartup is true", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);

      scheduler.registerJob({
        name: "startup-job",
        description: "Runs on startup",
        schedule: 10000,
        handler,
        runOnStartup: true,
      });

      // Should have run immediately
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handler).toHaveBeenCalled();
    });
  });
});
