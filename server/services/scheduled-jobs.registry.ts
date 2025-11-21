import { schedulerService, CronJobConfig } from "./scheduler.service";
import { dpopCacheService } from "./dpop-cache.service";
import { jobQueueService } from "./job-queue.service";
import { privacyService } from "./privacy.service";
import { pluginInstanceManagerService } from "./plugin-instance-manager.service";
import { pluginRouteService } from "./plugin-route.service";
import { orchestratorWorker } from "@server/workers/orchestrator.worker";
import { refreshOAuthTokens } from "./oauth-token-refresh.job";

/**
 * Centralized Scheduled Jobs Registry
 *
 * All cron jobs and scheduled tasks are registered here.
 * This makes it easy to see all scheduled jobs at a glance.
 *
 * To add a new job:
 * 1. Ensure the service exposes a public async method for the task
 * 2. Add the job configuration to the jobRegistry array below
 * 3. Restart the server to activate the job
 */

const jobRegistry: CronJobConfig[] = [
  // ============================================================
  // CACHE & CLEANUP JOBS
  // ============================================================
  {
    name: "dpop-cache-cleanup",
    description: "Clean up expired DPoP tokens from cache",
    schedule: 60000, // Every 60 seconds
    handler: async () => dpopCacheService.cleanupExpired(),
    singleton: true,
    enabled: true,
    skipDatabaseLogging: true, // Don't log frequent cache cleanups
  },

  {
    name: "plugin-instance-cleanup",
    description: "Clean up stale plugin instances",
    schedule: 60000, // Every 60 seconds
    handler: async () => pluginInstanceManagerService.cleanupInactiveInstances(),
    singleton: true,
    enabled: true,
    skipDatabaseLogging: true, // Don't log frequent cleanups
  },

  {
    name: "plugin-rate-limit-cleanup",
    description: "Clear expired plugin route rate limit entries",
    schedule: 60000, // Every 60 seconds
    handler: async () => pluginRouteService.clearRateLimits(),
    singleton: true,
    enabled: true,
    skipDatabaseLogging: true, // Don't log frequent cleanups
  },

  // ============================================================
  // BACKGROUND PROCESSING JOBS
  // ============================================================
  {
    name: "job-queue-processing",
    description: "Process pending jobs from the queue",
    schedule: 5000, // Every 5 seconds
    handler: async () => jobQueueService.processNextJob(),
    singleton: true, // Prevent concurrent processing
    enabled: true,
    skipDatabaseLogging: true, // Don't log frequent checks
  },

  {
    name: "orchestrator-worker-tick",
    description: "Process orchestrator tick for active conversations",
    schedule: 1000, // Every 1 second
    handler: async () => orchestratorWorker.tick(),
    singleton: true, // Prevent concurrent ticks
    enabled: true,
    skipDatabaseLogging: true, // Don't log every tick to database
  },

  {
    name: "orchestrator-inactivity-check",
    description: "Check for inactive conversations",
    schedule: 300000, // Every 5 minutes
    handler: async () => orchestratorWorker.checkInactivity(),
    singleton: true,
    enabled: true,
    skipDatabaseLogging: true, // Don't log frequent checks
  },

  // ============================================================
  // PRIVACY & GDPR JOBS
  // ============================================================
  {
    name: "cleanup-expired-privacy-exports",
    description: "Delete GDPR export files older than 7 days",
    schedule: "0 2 * * *", // Daily at 2 AM
    handler: async () => privacyService.cleanupExpiredExports(),
    timeout: 600000, // 10 minutes max
    retryOnFailure: true,
    maxRetries: 3,
    enabled: true,
  },

  // ============================================================
  // OAUTH TOKEN MANAGEMENT
  // ============================================================
  {
    name: "oauth-token-refresh",
    description: "Refresh OAuth tokens expiring within 15 minutes",
    schedule: 600000, // Every 10 minutes
    handler: async () => refreshOAuthTokens(),
    singleton: true,
    enabled: true,
    skipDatabaseLogging: true, // Don't log frequent token refreshes
  },

  // ============================================================
  // FUTURE JOBS (Disabled for now)
  // ============================================================
  // {
  //   name: 'plugin-instance-cleanup',
  //   description: 'Clean up stale plugin instances',
  //   schedule: 300000,  // Every 5 minutes
  //   handler: async () => pluginInstanceManager.cleanup(),
  //   singleton: true,
  //   enabled: false,  // Enable when ready
  // },
  //
  // {
  //   name: 'plugin-health-check',
  //   description: 'Check health of plugin routes and instances',
  //   schedule: 60000,  // Every 60 seconds
  //   handler: async () => pluginRouteService.healthCheck(),
  //   timeout: 30000,
  //   enabled: false,  // Enable when ready
  // },
  //
  // {
  //   name: 'cleanup-old-audit-logs',
  //   description: 'Archive audit logs older than retention period',
  //   schedule: '0 4 * * 0',  // Weekly on Sunday at 4 AM
  //   handler: async () => auditLogService.cleanupOldLogs(),
  //   timeout: 1800000,  // 30 minutes
  //   enabled: false,  // Enable when ready
  // },
];

/**
 * Initialize all scheduled jobs
 * Call this during application startup
 */
export function registerAllScheduledJobs(): void {
  console.log("[Scheduler] Registering scheduled jobs...");

  let registered = 0;
  let skipped = 0;

  for (const job of jobRegistry) {
    try {
      schedulerService.registerJob(job);
      if (job.enabled !== false) {
        registered++;
        console.log(`[Scheduler] ✓ Registered: ${job.name}`);
      } else {
        skipped++;
        console.log(`[Scheduler] ⊘ Skipped (disabled): ${job.name}`);
      }
    } catch (error) {
      console.error(`[Scheduler] ✗ Failed to register: ${job.name}`, error);
    }
  }

  console.log(`[Scheduler] Registration complete: ${registered} active, ${skipped} disabled`);
}

/**
 * Get all job configurations
 * Useful for admin UI or debugging
 */
export function getAllJobConfigs(): CronJobConfig[] {
  return jobRegistry;
}

/**
 * Get job by name
 */
export function getJobConfig(name: string): CronJobConfig | undefined {
  return jobRegistry.find((job) => job.name === name);
}
