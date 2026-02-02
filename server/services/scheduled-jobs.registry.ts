import { schedulerService, CronJobConfig } from "./scheduler.service";
import { dpopCacheService } from "./dpop-cache.service";
import { jobQueueService } from "./job-queue.service";
import { privacyService } from "./privacy.service";
import { pluginInstanceManagerService } from "./plugin-instance-manager.service";
import { pluginRouteService } from "./plugin-route.service";
import { orchestratorWorker } from "@server/workers/orchestrator.worker";
import { refreshOAuthTokens } from "./oauth-token-refresh.job";
import { documentRetryService } from "./document-retry.service";

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

  {
    name: "plugin-worker-cleanup",
    description: "Clean up inactive plugin workers (TypeScript-based plugins)",
    schedule: 300000, // Every 5 minutes
    handler: async () => {
      const { pluginManagerService } = await import("./plugin-manager.service");
      await pluginManagerService.cleanupInactiveWorkers();
    },
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

  {
    name: "orchestrator-stale-message-check",
    description: "Detect and recover stale/lost messages",
    schedule: 60000, // Every 60 seconds (1 minute)
    handler: async () => {
      const { config } = await import("../config/env");
      if (config.staleMessageDetection?.enabled === false) {
        return; // Skip if disabled
      }

      const { staleMessageDetectorService } = await import("./stale-message-detector.service");
      const { messageRecoveryService } = await import("./message-recovery.service");
      const { debugLog } = await import("../lib/debug-logger");

      const staleConversations = await staleMessageDetectorService.detectStaleConversations();

      if (staleConversations.length === 0) {
        return; // Nothing to do
      }

      debugLog("stale-detector", `Found ${staleConversations.length} stale conversations`);

      // Recover each conversation
      for (const staleConv of staleConversations) {
        try {
          const result = await messageRecoveryService.recoverStaleConversation(staleConv, false);
          debugLog("stale-detector", "Recovery result", {
            conversationId: staleConv.conversationId,
            result,
          });
        } catch (error) {
          console.error("[Stale Detector] Recovery failed", {
            conversationId: staleConv.conversationId,
            error,
          });
        }
      }
    },
    singleton: true, // CRITICAL: Prevent concurrent runs
    enabled: true,
    timeout: 30000, // 30 seconds max
    retryOnFailure: true,
    maxRetries: 2,
    skipDatabaseLogging: true, // Don't log frequent checks
  },

  {
    name: "document-processing-retry",
    description: "Retry failed document processing with exponential backoff",
    schedule: 300000, // Every 5 minutes
    handler: async () => {
      await documentRetryService.processRetryQueue();
    },
    singleton: true, // CRITICAL: Prevents concurrent runs
    enabled: true,
    timeout: 600000, // 10 minutes max - ensures job completes before next run
    retryOnFailure: true,
    maxRetries: 2,
  },

  // ============================================================
  // PRIVACY & GDPR JOBS
  // ============================================================
  {
    name: "cleanup-expired-privacy-exports",
    description: "Delete GDPR export files older than 7 days",
    schedule: "0 2 * * *", // Daily at 2 AM
    handler: async () => privacyService.cleanupExpiredExports(),
    // NOTE: Retention period is 7 days (configurable via PRIVACY_EXPORT_RETENTION_DAYS)
    // Supports both legacy JSON and new ZIP export formats
    // Files are cleaned up after expiration OR after max download count reached
    timeout: 600000, // 10 minutes max
    retryOnFailure: true,
    maxRetries: 3,
    enabled: true,
  },

  {
    name: "conversation-retention-anonymize",
    description: "Anonymize expired conversations based on organization retention policies",
    schedule: "0 3 * * *", // Daily at 3 AM
    handler: async () => {
      const { dataRetentionService } = await import("./data-retention.service");
      await dataRetentionService.anonymizeExpiredConversations();
    },
    // NOTE: Respects organization.settings.retentionDays (null = disabled)
    // Preserves conversation metadata for analytics while removing PII
    // Conversations with legal_hold = true are exempt from anonymization
    timeout: 1800000, // 30 minutes max for large cleanups
    retryOnFailure: true,
    maxRetries: 3,
    singleton: true,
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
