import { schedulerService, CronJobConfig } from "./scheduler.service";
import { dpopCacheService } from "./dpop-cache.service";
import { jobQueueService } from "./job-queue.service";
import { privacyService } from "./privacy.service";
import { pluginInstanceManagerService } from "./plugin-instance-manager.service";
import { orchestratorWorker } from "@server/workers/orchestrator.worker";
import { refreshOAuthTokens } from "./oauth-token-refresh.job";
import { documentRetryService } from "./document-retry.service";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("scheduled-jobs");

/**
 * Centralized Scheduled Jobs Registry
 *
 * All cron jobs and scheduled tasks are registered here.
 * This makes it easy to see all scheduled jobs at a glance.
 *
 * Jobs run on one server instance at a time (Postgres advisory lock) unless
 * marked `perInstance`, for work on in-memory state or local plugin workers.
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
    perInstance: true,
    enabled: true,
    skipDatabaseLogging: true, // Don't log frequent cache cleanups
  },

  {
    name: "plugin-instance-cleanup",
    description: "Clean up stale plugin instances",
    schedule: 60000, // Every 60 seconds
    handler: async () => pluginInstanceManagerService.cleanupInactiveInstances(),
    singleton: true,
    perInstance: true,
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
    perInstance: true,
    enabled: true,
    skipDatabaseLogging: true, // Don't log frequent cleanups
  },

  {
    name: "auth-session-cleanup",
    description: "Delete login sessions that expired or were revoked over 30 days ago",
    schedule: "30 3 * * *", // Daily at 3:30 AM
    handler: async () => {
      const { authSessionService } = await import("./auth-session.service");
      await authSessionService.cleanupEndedSessions();
    },
    singleton: true,
    enabled: true,
  },

  {
    name: "help-center-domain-recheck",
    description: "Confirm verified help center custom domains still point at this server",
    schedule: "45 4 * * *", // Daily at 4:45 AM
    handler: async () => {
      const { helpCenterService } = await import("./help-center/help-center.service");
      await helpCenterService.recheckCustomDomains();
    },
    singleton: true,
    enabled: true,
  },

  {
    name: "site-index-sync",
    description:
      "Re-read each organization's sitemap into the site page index (find_page_url, link check)",
    schedule: "15 4 * * *", // Daily at 4:15 AM
    handler: async () => {
      const { siteIndexService } = await import("./site-index.service");
      await siteIndexService.syncAll();
    },
    singleton: true,
    enabled: true,
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
    perInstance: true,
    enabled: true,
    skipDatabaseLogging: true, // Don't log frequent checks
  },

  {
    name: "close-classification",
    description:
      "Classify closed conversations: billing outcome + Insights QA event (one LLM call each)",
    schedule: 10000, // Every 10 seconds, up to 5 closes per run
    handler: async () => {
      const { closeClassifierService } =
        await import("./close-classification/close-classifier.service");
      await closeClassifierService.processPending(5);
    },
    singleton: true,
    enabled: true,
    skipDatabaseLogging: true,
  },

  {
    name: "operator-event-retry",
    description:
      "Retry operator events (e.g. organization.deleted) whose delivery failed, with backoff",
    schedule: 60000, // Every minute, up to 10 due events per run
    handler: async () => {
      const { retryOperatorEvents } = await import("./operator-events.service");
      await retryOperatorEvents(10);
    },
    singleton: true,
    enabled: true,
    skipDatabaseLogging: true,
  },

  {
    name: "insight-feedback-enrichment",
    description:
      "Explain staff ratings of AI replies as Insights QA events (one easy-tier LLM call each)",
    schedule: 10000, // Every 10 seconds, up to 5 ratings per run
    handler: async () => {
      const { feedbackInsightService } = await import("./insights/feedback-insight.service");
      await feedbackInsightService.enrichPending(5);
    },
    singleton: true,
    enabled: true,
    skipDatabaseLogging: true,
  },

  {
    name: "insight-embeddings",
    description: "Embed enriched insight issues for clustering (pgvector, one row per issue)",
    schedule: 60000, // Every 60 seconds, up to 50 issues per run
    handler: async () => {
      const { insightEmbeddingService } = await import("./insights/insight-embedding.service");
      await insightEmbeddingService.embedPending(50);
    },
    singleton: true,
    enabled: true,
    skipDatabaseLogging: true,
  },

  {
    name: "insight-clustering",
    description:
      "Nightly incremental clustering of insight issues: join/create, merge, promotion gate, recurrence (D3-12)",
    schedule: "15 4 * * *", // Daily at 4:15 AM, after retention
    handler: async () => {
      const { insightClusteringService } = await import("./insights/insight-clustering.service");
      await insightClusteringService.runAll();
    },
    singleton: true,
    enabled: true,
    timeout: 1800000, // 30 minutes max
  },

  {
    name: "insight-weekly-digest",
    description: "Weekly Insights digest email to owners and admins",
    schedule: "0 8 * * 1", // Mondays at 8:00 AM, after the docs audit
    handler: async () => {
      const { insightDigestService } = await import("./insights/insight-digest.service");
      await insightDigestService.runAll();
    },
    singleton: true,
    enabled: true,
    timeout: 1800000, // 30 minutes max
  },

  {
    name: "dispute-evidence-reminder",
    description:
      "Remind owners and admins once when a payment dispute's evidence is due within 48h and nothing is attached (D2-7)",
    schedule: "15 * * * *", // Hourly
    handler: async () => {
      const { disputesService } = await import("./disputes/disputes.service");
      await disputesService.sendReminders();
    },
    singleton: true,
    enabled: true,
    timeout: 300000, // 5 minutes max
  },

  {
    name: "insight-backfill",
    description:
      "Insights-only review of the last 30 days of closed conversations when Insights is enabled (D3-18)",
    schedule: 120000, // Every 2 minutes, 10 conversations per org per run
    handler: async () => {
      const { insightBackfillService } = await import("./insights/insight-backfill.service");
      await insightBackfillService.processPending(10);
    },
    singleton: true,
    enabled: true,
    skipDatabaseLogging: true,
    timeout: 600000, // 10 minutes max
  },

  {
    name: "insight-docs-audit",
    description: "Weekly docs audit and broken playbook action check as an Insights input (D3-15)",
    schedule: "0 5 * * 1", // Mondays at 5:00 AM
    handler: async () => {
      const { docsAuditInsightService } = await import("./insights/docs-audit-insight.service");
      await docsAuditInsightService.runAll();
    },
    singleton: true,
    enabled: true,
    timeout: 3600000, // 1 hour max
  },

  {
    name: "pending-action-expiry",
    description:
      "Expire AI actions that got no approval in time and hand the conversation to the team",
    schedule: 60000, // Every 60 seconds
    handler: async () => {
      const { actionDecisionService } = await import("./action-decision.service");
      await actionDecisionService.expireDue();
    },
    singleton: true,
    enabled: true,
    skipDatabaseLogging: true,
  },

  {
    name: "orchestrator-worker-tick",
    description:
      "Process orchestrator tick for active conversations (replaced by RabbitMQ consumer)",
    schedule: 1000,
    handler: async () => orchestratorWorker.tick(),
    singleton: true,
    perInstance: true,
    enabled: false, // Disabled: RabbitMQ consumer handles processing now
    skipDatabaseLogging: true,
  },

  {
    name: "orchestrator-sweep",
    description: "Safety net: re-enqueue conversations stuck with needs_processing=true",
    schedule: 30000, // Every 30 seconds
    handler: async () => {
      const { ConversationRepository } = await import("../repositories/conversation.repository");
      const { orchestratorQueueService } = await import("./orchestrator-queue.service");
      const { rabbitmqService } = await import("./rabbitmq.service");
      const sweepLogger = createLogger("orchestrator-sweep");

      const repo = new ConversationRepository();
      const staleConversations = await repo.getStaleUnprocessed(30000); // 30s threshold

      if (staleConversations.length === 0) return;

      if (!rabbitmqService.isConnected()) {
        sweepLogger.error(
          { count: staleConversations.length },
          "RabbitMQ not connected, processing pending conversations directly",
        );
        await orchestratorWorker.processDirectly(staleConversations.map((conv) => conv.id));
        return;
      }

      sweepLogger.debug(`Found ${staleConversations.length} stale conversations, re-enqueuing`);

      for (const conv of staleConversations) {
        await orchestratorQueueService.enqueue(conv.id, conv.organization_id, "sweep");
      }
    },
    singleton: true,
    enabled: true,
    skipDatabaseLogging: true,
  },

  {
    name: "channel-delivery-sweep",
    description: "Publish outbound deliveries the queue never received and close abandoned ones",
    schedule: 15000, // Every 15 seconds
    handler: async (signal) => {
      const { channelDeliveryService } = await import("./channel-delivery.service");
      await channelDeliveryService.sweep(signal);
    },
    singleton: true,
    enabled: true,
    skipDatabaseLogging: true,
  },

  {
    name: "cleanup-message-deliveries",
    description: "Delete settled outbound delivery records older than 30 days",
    schedule: "45 3 * * *", // Daily at 3:45 AM
    handler: async () => {
      const { messageDeliveryRepository } =
        await import("../repositories/message-delivery.repository");
      await messageDeliveryRepository.deleteSettledOlderThan(30);
    },
    singleton: true,
    enabled: true,
  },

  {
    name: "simulation-sweep",
    description: "Fail simulated conversations stuck past their timeout and move their runs on",
    schedule: 60000, // Every 60 seconds
    handler: async () => {
      const { simulationHarnessService } = await import("./simulation/simulation-harness.service");
      await simulationHarnessService.sweepStaleItems();
    },
    singleton: true,
    enabled: true,
    skipDatabaseLogging: true,
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
    name: "conversation-alert-escalation",
    description:
      "Re-push, then email, Available members about conversations waiting 10+ min for a human, and alert on held conversations unanswered for 10 min",
    schedule: 60000, // Every 60 seconds
    handler: async () => {
      const { conversationAlertService } = await import("./conversation-alert.service");
      await conversationAlertService.runEscalationSweep();
    },
    singleton: true,
    enabled: true,
    skipDatabaseLogging: true,
  },

  {
    name: "team-question-timers",
    description:
      "Quick check with the team (D19): send the 'still checking' update and end the wait (team queue) when no teammate answered in time",
    schedule: 60000, // Every 60 seconds
    handler: async () => {
      const { teamQuestionService } = await import("./team-questions/team-question.service");
      await teamQuestionService.runSweep();
    },
    singleton: true,
    enabled: true,
    skipDatabaseLogging: true,
  },

  {
    name: "orchestrator-stale-message-check",
    description: "Detect and recover stale/lost messages",
    schedule: 60000, // Every 60 seconds (1 minute)
    handler: async (signal) => {
      const { config } = await import("../config/env");
      if (config.staleMessageDetection?.enabled === false) {
        return; // Skip if disabled
      }

      const { staleMessageDetectorService } = await import("./stale-message-detector.service");
      const { messageRecoveryService } = await import("./message-recovery.service");

      const staleConversations = await staleMessageDetectorService.detectStaleConversations();

      if (staleConversations.length === 0) {
        return; // Nothing to do
      }

      logger.debug({ count: staleConversations.length }, "Found stale conversations");

      // Recover each conversation
      for (const staleConv of staleConversations) {
        if (signal.aborted) return; // The rest are picked up by the next run.
        try {
          const result = await messageRecoveryService.recoverStaleConversation(staleConv, false);
          logger.debug({ conversationId: staleConv.conversationId, result }, "Recovery result");
        } catch (error) {
          logger.error({ err: error, conversationId: staleConv.conversationId }, "Recovery failed");
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

  {
    name: "document-source-sync-dispatcher",
    description: "Dispatch document source syncs that are due",
    schedule: 60000, // Every 60 seconds
    handler: async () => {
      const { documentSourceRepository } =
        await import("../repositories/document-source.repository");
      const { documentSourceSyncService } = await import("./document-source-sync.service");

      try {
        const due = await documentSourceRepository.findDueForSync();
        if (due.length === 0) return;
        logger.info({ count: due.length }, "Dispatching document source syncs");
        for (const source of due) {
          try {
            await documentSourceSyncService.enqueueSync(source.id);
          } catch (err) {
            logger.error({ err, sourceId: source.id }, "Failed to enqueue document source sync");
          }
        }
      } catch (err) {
        logger.error({ err }, "document-source-sync-dispatcher tick failed");
      }
    },
    singleton: true,
    enabled: true,
    skipDatabaseLogging: true,
  },

  // ============================================================
  // PRIVACY & GDPR JOBS
  // ============================================================
  {
    name: "cleanup-expired-privacy-exports",
    description: "Delete DSAR export ZIPs past their expiry (PRIVACY_EXPORT_RETENTION_DAYS)",
    schedule: "0 2 * * *", // Daily at 2 AM
    handler: async () => {
      await privacyService.cleanupExpiredExports();
      // Requests older than a year keep no contact details.
      await privacyService.anonymizeExpiredRequests();
    },
    timeout: 600000, // 10 minutes max
    retryOnFailure: true,
    maxRetries: 3,
    enabled: true,
  },

  {
    name: "plugin-cron-reconcile",
    description: "Keep this process's plugin cron jobs in line with enabled plugin instances",
    schedule: 60000, // Every 60 seconds
    handler: async () => {
      const { pluginCronService } = await import("./plugin-cron.service");
      await pluginCronService.reconcile();
    },
    perInstance: true, // Cron registrations live in each process's scheduler.
    enabled: true,
    skipDatabaseLogging: true,
  },

  {
    name: "requeue-stale-background-jobs",
    description: "Queue again background jobs whose server stopped mid-run",
    schedule: "*/5 * * * *", // Every 5 minutes
    handler: async () => {
      await privacyService.requeueStaleJobs();
      await jobQueueService.requeueStaleJobs();
    },
    singleton: true,
    enabled: true,
    skipDatabaseLogging: true,
  },

  {
    name: "cleanup-expired-organization-exports",
    description: "Delete full organization export ZIPs past their 7-day retention (D15-6)",
    schedule: "30 2 * * *", // Daily at 2:30 AM
    handler: async () => {
      const { organizationExportService } = await import("./organization-export.service");
      await organizationExportService.cleanupExpired();
    },
    timeout: 600000,
    enabled: true,
  },

  {
    name: "conversation-retention-anonymize",
    description: "Anonymize expired conversations based on organization retention policies",
    schedule: "0 3 * * *", // Daily at 3 AM
    handler: async () => {
      const { dataRetentionService } = await import("./data-retention.service");
      await dataRetentionService.anonymizeExpiredConversations();
      // Customers left with no live conversation, same retention setting.
      await dataRetentionService.sweepExpiredCustomers();
      await dataRetentionService.expireInsightText();
      // Imported test transcripts (D7-8) follow the same retention setting.
      const { testTranscriptService } = await import("./test-transcript.service");
      await testTranscriptService.deleteExpired();
      // So do saved test cases (D7-12).
      const { testCaseService } = await import("./simulation/test-case.service");
      await testCaseService.deleteExpired();
      // And simulation run items (seed turns, judge verdicts).
      const { simulationHarnessService } = await import("./simulation/simulation-harness.service");
      await simulationHarnessService.scrubExpired();
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

  {
    name: "storage-purge-drain",
    description: "Delete stored files queued by bulk deletions (organization deletion)",
    schedule: "20 * * * *", // Hourly
    handler: async () => {
      const { drainStoragePurgeQueue } = await import("./storage-purge.service");
      await drainStoragePurgeQueue();
    },
    timeout: 1800000,
    retryOnFailure: true,
    maxRetries: 3,
    singleton: true,
    enabled: true,
  },

  {
    name: "document-files-orphan-sweep",
    description: "Delete document files and editor images no document names any more",
    schedule: "0 4 * * *", // Daily at 4 AM
    handler: async () => {
      const { sweepOrphanDocumentFiles } = await import("./storage-purge.service");
      await sweepOrphanDocumentFiles();
    },
    timeout: 1800000,
    retryOnFailure: true,
    maxRetries: 3,
    singleton: true,
    enabled: true,
  },

  {
    name: "cleanup-old-audit-logs",
    description: "Clear personal fields from audit logs after 90 days and delete them after 365",
    schedule: "45 3 * * *", // Daily at 3:45 AM
    handler: async () => {
      const { auditLogService } = await import("./audit-log.service");
      const deleted = await auditLogService.cleanup();
      logger.info({ deleted }, "Audit log retention cleanup finished");
    },
    timeout: 1800000,
    singleton: true,
    enabled: true,
  },

  {
    name: "ship-audit-log-outbox",
    description: "Copy new audit log rows to the external append-only sink",
    schedule: 30000, // Every 30 seconds
    handler: async () => {
      const { auditSinkService } = await import("./audit-sink.service");
      await auditSinkService.shipPending();
    },
    timeout: 1800000,
    singleton: true,
    enabled: true,
    skipDatabaseLogging: true,
  },

  {
    name: "verify-audit-log-chain",
    description: "Recompute the audit log hash chains and report any mismatch",
    schedule: "30 4 * * 0", // Weekly, Sunday at 4:30 AM
    handler: async () => {
      const { auditLogService } = await import("./audit-log.service");
      const problems = await auditLogService.verifyChain();
      if (problems.length > 0) {
        logger.error(
          { count: problems.length, sample: problems.slice(0, 20) },
          "Audit log hash chain verification found problems",
        );
      }
    },
    timeout: 1800000,
    singleton: true,
    enabled: true,
  },

  {
    name: "conversation-media-sweep",
    description:
      "Delete conversation media past its retention (retentionDays, or 180 days when unset) and orphaned uploads",
    schedule: "30 3 * * *", // Daily at 3:30 AM, after conversation retention
    handler: async () => {
      const { sweepConversationMedia } = await import("./conversation-media.service");
      await sweepConversationMedia();
    },
    // NOTE: media in conversations on legal hold is kept; orphans are uploads
    // no message used for 24 h (see conversation-media.service)
    timeout: 1800000,
    retryOnFailure: true,
    maxRetries: 3,
    singleton: true,
    enabled: true,
  },

  // ============================================================
  // GIT PLUGIN SYNC
  // ============================================================
  {
    name: "git-plugin-update-check",
    description: "Flag git-sourced plugins whose branch has a newer commit (applied by an admin)",
    schedule: 900000, // Every 15 minutes
    handler: async () => {
      const { gitConnectionService } = await import("./git-connection.service");
      await gitConnectionService.checkAllGitPluginsForUpdates();
    },
    singleton: true,
    perInstance: true,
    enabled: true,
    timeout: 600000, // 10 minutes max
    retryOnFailure: true,
    maxRetries: 2,
    skipDatabaseLogging: true,
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
  // PRODUCT SOURCE SYNC
  // ============================================================
  {
    name: "product-source-sync",
    description: "Keep product-source plugin workers alive so they re-sync catalogs",
    schedule: 900000, // Every 15 minutes
    handler: async () => {
      const { productSourceCoordinator } = await import("./product-source-coordinator.service");
      await productSourceCoordinator.syncAllOrgs();
    },
    singleton: true,
    perInstance: true,
    enabled: true,
    timeout: 600000, // 10 minutes max
    retryOnFailure: true,
    maxRetries: 2,
    skipDatabaseLogging: true,
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
];

/**
 * Initialize all scheduled jobs
 * Call this during application startup
 */
export function registerAllScheduledJobs(): void {
  logger.info("Registering scheduled jobs...");

  let registered = 0;
  let skipped = 0;

  for (const job of jobRegistry) {
    try {
      schedulerService.registerJob(job);
      if (job.enabled !== false) {
        registered++;
        logger.info({ jobName: job.name }, "Registered job");
      } else {
        skipped++;
        logger.info({ jobName: job.name }, "Skipped disabled job");
      }
    } catch (error) {
      logger.error({ err: error, jobName: job.name }, "Failed to register job");
    }
  }

  logger.info({ registered, skipped }, "Registration complete");
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
