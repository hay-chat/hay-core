# Unified Cron Job System Design

## Overview

Currently, the application has multiple scattered `setInterval` calls across different services. This design proposes a unified cron job system to centralize scheduled task management.

## Current State Analysis

### Existing Scheduled Tasks

1. **Plugin Instance Cleanup** - `plugin-instance-manager.service.ts:29`
   - Interval: Every 5 minutes
   - Purpose: Clean up stale plugin instances

2. **Job Queue Processing** - `job-queue.service.ts:79`
   - Interval: Every 5 seconds
   - Purpose: Process pending jobs

3. **DPoP Token Cache Cleanup** - `dpop-cache.service.ts:15`
   - Interval: Every 60 seconds (1 minute)
   - Purpose: Remove expired DPoP tokens

4. **Plugin Route Health Check** - `plugin-route.service.ts:248`
   - Interval: Not specified in grep output
   - Purpose: Health checks for plugin routes

5. **Orchestrator Worker** - `orchestrator.worker.ts:41,48`
   - Two intervals: Worker processing and inactivity checks
   - Purpose: Conversation orchestration

### Problems with Current Approach

1. ❌ **No Central Management** - Jobs scattered across multiple files
2. ❌ **No Monitoring** - Can't see all scheduled tasks in one place
3. ❌ **No Error Handling** - If a job fails, no central error tracking
4. ❌ **No Job History** - Can't track when jobs last ran or their status
5. ❌ **Resource Intensive** - Multiple timers running independently
6. ❌ **No Graceful Shutdown** - Jobs may not stop cleanly on server shutdown
7. ❌ **Testing Difficulty** - Hard to test scheduled tasks

## Proposed Solution: Unified Scheduler Service

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SchedulerService                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │  Job Registry    │  │  Job Executor    │                │
│  │                  │  │                  │                │
│  │  - Job List      │  │  - Run Job       │                │
│  │  - Schedule Info │  │  - Error Handler │                │
│  │  - Metadata      │  │  - Timeout       │                │
│  └──────────────────┘  └──────────────────┘                │
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │  Job Monitor     │  │  Persistence     │                │
│  │                  │  │                  │                │
│  │  - Last Run      │  │  - Job History   │                │
│  │  - Status        │  │  - Audit Log     │                │
│  │  - Metrics       │  │  - Database      │                │
│  └──────────────────┘  └──────────────────┘                │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Core Features

#### 1. Job Registration API

```typescript
interface CronJobConfig {
  name: string;                    // Unique job identifier
  description: string;             // Human-readable description
  schedule: string | number;       // Cron expression or interval in ms
  handler: () => Promise<void>;    // Job handler function
  enabled?: boolean;               // Enable/disable job (default: true)
  timeout?: number;                // Max execution time in ms
  retryOnFailure?: boolean;        // Retry failed jobs
  maxRetries?: number;             // Max retry attempts
  runOnStartup?: boolean;          // Run immediately on service start
  singleton?: boolean;             // Prevent concurrent executions
}

// Usage
schedulerService.registerJob({
  name: 'cleanup-expired-exports',
  description: 'Delete GDPR export files older than 7 days',
  schedule: '0 2 * * *',  // 2 AM daily
  handler: async () => {
    await privacyService.cleanupExpiredExports();
  },
  timeout: 300000,  // 5 minutes
  retryOnFailure: true,
  maxRetries: 3
});
```

#### 2. Schedule Formats

Support both interval and cron expressions:

```typescript
// Interval (milliseconds)
schedule: 60000  // Every 60 seconds

// Cron expression (using node-cron)
schedule: '*/5 * * * *'  // Every 5 minutes
schedule: '0 2 * * *'    // Daily at 2 AM
schedule: '0 0 * * 0'    // Weekly on Sunday at midnight
schedule: '0 0 1 * *'    // Monthly on 1st at midnight
```

#### 3. Job Monitoring & Status

```typescript
interface JobStatus {
  name: string;
  lastRun?: Date;
  lastStatus: 'success' | 'failed' | 'timeout' | 'running';
  lastError?: string;
  lastDuration?: number;  // ms
  totalRuns: number;
  totalFailures: number;
  averageDuration: number;
  nextRun?: Date;
  enabled: boolean;
}

// Get all job statuses
const statuses = schedulerService.getJobStatuses();

// Get specific job status
const status = schedulerService.getJobStatus('cleanup-expired-exports');
```

#### 4. Manual Job Control

```typescript
// Run a job manually (ignore schedule)
await schedulerService.runJob('cleanup-expired-exports');

// Enable/disable jobs
schedulerService.enableJob('cleanup-expired-exports');
schedulerService.disableJob('cleanup-expired-exports');

// Unregister a job
schedulerService.unregisterJob('cleanup-expired-exports');
```

#### 5. Graceful Shutdown

```typescript
// On server shutdown
await schedulerService.shutdown({
  gracefulTimeout: 30000  // Wait up to 30s for jobs to finish
});
```

### Implementation Plan

#### Phase 1: Core Scheduler Service

1. **Create `SchedulerService` class**
   - Job registration system
   - Interval-based scheduling
   - Basic execution engine
   - Error handling

2. **File:** `server/services/scheduler.service.ts`

```typescript
export class SchedulerService {
  private jobs: Map<string, RegisteredJob> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private runningJobs: Set<string> = new Set();

  async initialize(): Promise<void> {
    console.log('[Scheduler] Initializing scheduler service');
    // Load job history from database
    // Start all enabled jobs
  }

  registerJob(config: CronJobConfig): void {
    // Validate config
    // Store job
    // Schedule job
  }

  private async executeJob(name: string): Promise<void> {
    // Check if already running (singleton)
    // Execute with timeout
    // Handle errors and retries
    // Record metrics
    // Publish events
  }

  async shutdown(options?: ShutdownOptions): Promise<void> {
    // Stop accepting new jobs
    // Wait for running jobs
    // Clear all timers
    // Save final status
  }
}
```

#### Phase 2: Cron Expression Support

1. **Add `node-cron` dependency**
   ```bash
   npm install node-cron
   npm install -D @types/node-cron
   ```

2. **Extend scheduler to support cron expressions**

#### Phase 3: Persistence & History

1. **Create `scheduled_jobs` table**

```typescript
// Migration: CreateScheduledJobsTable
export class ScheduledJob extends BaseEntity {
  @PrimaryColumn()
  name!: string;

  @Column()
  description!: string;

  @Column({ type: 'text' })
  schedule!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastRun?: Date;

  @Column({ type: 'varchar', nullable: true })
  lastStatus?: 'success' | 'failed' | 'timeout' | 'running';

  @Column({ type: 'text', nullable: true })
  lastError?: string;

  @Column({ type: 'int', default: 0 })
  totalRuns!: number;

  @Column({ type: 'int', default: 0 })
  totalFailures!: number;

  @Column({ type: 'int', default: 0 })
  averageDuration!: number;  // ms
}
```

2. **Create `scheduled_job_history` table**

```typescript
export class ScheduledJobHistory extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  jobName!: string;

  @Column({ type: 'timestamptz' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt?: Date;

  @Column({ type: 'varchar' })
  status!: 'success' | 'failed' | 'timeout';

  @Column({ type: 'int' })
  duration!: number;  // ms

  @Column({ type: 'text', nullable: true })
  error?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: any;
}
```

#### Phase 4: Monitoring & Admin UI

1. **Add tRPC endpoints** for job management
   - `scheduler.listJobs` - Get all registered jobs
   - `scheduler.getJobStatus` - Get job details
   - `scheduler.runJob` - Trigger manual run
   - `scheduler.toggleJob` - Enable/disable
   - `scheduler.getJobHistory` - Get execution history

2. **Create admin dashboard page**
   - `dashboard/pages/admin/scheduler.vue`
   - List all jobs with status
   - Manual trigger buttons
   - Enable/disable toggles
   - Execution history viewer

### Job Registration Strategy

**IMPORTANT: Centralized Registry Approach**

Instead of scattering job registrations across multiple service files, we'll use a **centralized registry** for better discoverability and maintenance.

#### Centralized Registry File

**File:** `server/services/scheduled-jobs.registry.ts`

```typescript
import { schedulerService, CronJobConfig } from './scheduler.service';
import { dpopCacheService } from './dpop-cache.service';
import { pluginInstanceManager } from './plugin-instance-manager.service';
import { privacyService } from './privacy.service';
// ... other service imports

/**
 * Centralized Scheduled Jobs Registry
 *
 * All cron jobs and scheduled tasks are registered here.
 * This makes it easy to see all scheduled jobs at a glance.
 */

const jobRegistry: CronJobConfig[] = [
  // ============================================================
  // CACHE & CLEANUP JOBS
  // ============================================================
  {
    name: 'dpop-cache-cleanup',
    description: 'Clean up expired DPoP tokens from cache',
    schedule: 60000,  // Every 60 seconds
    handler: async () => dpopCacheService.cleanupExpired(),
    singleton: true,
    enabled: true,
  },

  {
    name: 'plugin-instance-cleanup',
    description: 'Clean up stale plugin instances',
    schedule: 300000,  // Every 5 minutes
    handler: async () => pluginInstanceManager.cleanup(),
    singleton: true,
    enabled: true,
  },

  // ============================================================
  // PRIVACY & GDPR JOBS
  // ============================================================
  {
    name: 'cleanup-expired-privacy-exports',
    description: 'Delete GDPR export files older than 7 days',
    schedule: '0 2 * * *',  // Daily at 2 AM
    handler: async () => privacyService.cleanupExpiredExports(),
    timeout: 600000,  // 10 minutes max
    retryOnFailure: true,
    maxRetries: 3,
    enabled: true,
  },

  {
    name: 'cleanup-old-privacy-requests',
    description: 'Archive or delete old privacy requests (90+ days)',
    schedule: '0 3 * * 0',  // Weekly on Sunday at 3 AM
    handler: async () => privacyService.cleanupOldRequests(),
    timeout: 600000,
    enabled: true,
  },

  // ============================================================
  // AUDIT & COMPLIANCE JOBS
  // ============================================================
  {
    name: 'cleanup-old-audit-logs',
    description: 'Archive audit logs older than retention period',
    schedule: '0 4 * * 0',  // Weekly on Sunday at 4 AM
    handler: async () => auditLogService.cleanupOldLogs(),
    timeout: 1800000,  // 30 minutes
    enabled: true,
  },

  // ============================================================
  // BACKGROUND PROCESSING JOBS
  // ============================================================
  {
    name: 'job-queue-processing',
    description: 'Process pending jobs from the queue',
    schedule: 5000,  // Every 5 seconds
    handler: async () => jobQueueService.processQueue(),
    singleton: true,  // Prevent concurrent processing
    enabled: true,
  },

  {
    name: 'plugin-health-check',
    description: 'Check health of plugin routes and instances',
    schedule: 60000,  // Every 60 seconds
    handler: async () => pluginRouteService.healthCheck(),
    timeout: 30000,
    enabled: true,
  },

  // ============================================================
  // ANALYTICS & REPORTING (FUTURE)
  // ============================================================
  // {
  //   name: 'generate-daily-analytics',
  //   description: 'Generate daily analytics reports',
  //   schedule: '0 1 * * *',  // Daily at 1 AM
  //   handler: async () => analyticsService.generateDailyReport(),
  //   enabled: false,  // Not yet implemented
  // },
];

/**
 * Initialize all scheduled jobs
 * Call this during application startup
 */
export function registerAllScheduledJobs(): void {
  console.log('[Scheduler] Registering scheduled jobs...');

  let registered = 0;
  let skipped = 0;

  for (const job of jobRegistry) {
    try {
      schedulerService.registerJob(job);
      if (job.enabled) {
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
  return jobRegistry.find(job => job.name === name);
}
```

#### Service Layer Updates

Services should expose **public methods** for their scheduled tasks, but NOT register them directly:

**Before (BAD - scattered registration):**
```typescript
// dpop-cache.service.ts
class DPoPCacheService {
  initialize() {
    // BAD: Registering job in service
    schedulerService.registerJob({
      name: 'dpop-cache-cleanup',
      handler: async () => this.cleanupExpired(),
    });
  }
}
```

**After (GOOD - service exposes method, registry handles registration):**
```typescript
// dpop-cache.service.ts
class DPoPCacheService {
  /**
   * Clean up expired DPoP tokens
   * Called by scheduled job: 'dpop-cache-cleanup'
   */
  async cleanupExpired(): Promise<void> {
    // cleanup logic
    const expired = await this.findExpiredTokens();
    await this.deleteTokens(expired);
    console.log(`[DPoP] Cleaned up ${expired.length} expired tokens`);
  }

  // ... rest of service
}
```

#### Application Startup

**File:** `server/index.ts` (or wherever app initialization happens)

```typescript
import { schedulerService } from './services/scheduler.service';
import { registerAllScheduledJobs } from './services/scheduled-jobs.registry';

async function startServer() {
  // ... database initialization, etc.

  // Initialize scheduler service
  await schedulerService.initialize();

  // Register all scheduled jobs from centralized registry
  registerAllScheduledJobs();

  // ... start Express server, etc.
}
```

### Migration Strategy

#### Step 1: Implement Core Service
- Create `SchedulerService` with basic functionality
- Add database migrations
- Write unit tests

#### Step 2: Create Centralized Registry
- Create `server/services/scheduled-jobs.registry.ts`
- Add initial job configurations (can start empty or with a few jobs)
- Update `server/index.ts` to call `registerAllScheduledJobs()`

#### Step 3: Migrate Existing Jobs (One at a time)

For each existing `setInterval` call:

1. **Remove the interval from the service:**
   ```typescript
   // dpop-cache.service.ts - REMOVE THIS
   // this.cleanupInterval = setInterval(() => this.cleanupExpired(), 60000);
   ```

2. **Ensure the method is async and public:**
   ```typescript
   // dpop-cache.service.ts
   async cleanupExpired(): Promise<void> {
     // cleanup logic
   }
   ```

3. **Add to centralized registry:**
   ```typescript
   // scheduled-jobs.registry.ts
   {
     name: 'dpop-cache-cleanup',
     description: 'Clean up expired DPoP tokens from cache',
     schedule: 60000,
     handler: async () => dpopCacheService.cleanupExpired(),
     singleton: true,
   }
   ```

4. **Test the migration:**
   - Verify the job runs on schedule
   - Check logs for execution
   - Monitor for errors

#### Step 3: Add New Jobs

**Privacy Export Cleanup** (the one you requested):

```typescript
// privacy.service.ts
class PrivacyService {
  registerScheduledJobs() {
    schedulerService.registerJob({
      name: 'cleanup-expired-privacy-exports',
      description: 'Delete GDPR export files older than 7 days',
      schedule: '0 2 * * *',  // Daily at 2 AM
      handler: async () => this.cleanupExpiredExports(),
      timeout: 600000,  // 10 minutes max
      retryOnFailure: true,
      maxRetries: 3
    });
  }

  async cleanupExpiredExports(): Promise<void> {
    const exportsDir = path.join(__dirname, '../../exports');
    const files = await fs.readdir(exportsDir);
    let deletedCount = 0;

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = path.join(exportsDir, file);
      const stats = await fs.stat(filePath);
      const ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);

      if (ageInDays > 7) {
        await fs.unlink(filePath);
        deletedCount++;
        console.log(`[Privacy] Deleted expired export: ${file}`);
      }
    }

    console.log(`[Privacy] Cleanup complete: ${deletedCount} files deleted`);
  }
}
```

### Jobs to Register

Based on current usage and your needs:

1. **dpop-cache-cleanup** - Every 60 seconds
2. **job-queue-processing** - Every 5 seconds
3. **plugin-instance-cleanup** - Every 5 minutes
4. **plugin-health-check** - Every 60 seconds
5. **cleanup-expired-privacy-exports** - Daily at 2 AM (NEW)
6. **cleanup-expired-privacy-requests** - Daily at 3 AM (FUTURE)
7. **cleanup-old-audit-logs** - Weekly (FUTURE)
8. **generate-analytics-reports** - Daily (FUTURE)

### Configuration

Add to `server/config/env.ts`:

```typescript
export const schedulerConfig = {
  enabled: process.env.SCHEDULER_ENABLED !== 'false',  // Default: enabled
  timezone: process.env.SCHEDULER_TIMEZONE || 'UTC',
  jobHistoryRetentionDays: parseInt(process.env.SCHEDULER_HISTORY_RETENTION || '30'),
  maxConcurrentJobs: parseInt(process.env.SCHEDULER_MAX_CONCURRENT || '10'),
};
```

### Benefits

1. ✅ **Centralized Management** - All jobs in one place
2. ✅ **Better Monitoring** - See all job statuses, history, metrics
3. ✅ **Error Handling** - Centralized error tracking and retry logic
4. ✅ **Testability** - Easy to test scheduled jobs
5. ✅ **Graceful Shutdown** - Proper cleanup on server stop
6. ✅ **Scalability** - Easy to add new jobs
7. ✅ **Observability** - Job execution history and metrics
8. ✅ **Control** - Enable/disable/trigger jobs via API or UI

### Testing Strategy

```typescript
// scheduler.service.test.ts
describe('SchedulerService', () => {
  it('should register and execute a job', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);

    schedulerService.registerJob({
      name: 'test-job',
      schedule: 1000,
      handler
    });

    await sleep(1100);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should handle job failures with retry', async () => {
    const handler = jest.fn()
      .mockRejectedValueOnce(new Error('First failure'))
      .mockResolvedValueOnce(undefined);

    schedulerService.registerJob({
      name: 'test-job',
      schedule: 1000,
      handler,
      retryOnFailure: true,
      maxRetries: 3
    });

    await sleep(2100);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
```

### Timeline

- **Week 1**: Core `SchedulerService` implementation + tests
- **Week 2**: Database migrations + persistence layer
- **Week 3**: Migrate existing jobs one by one
- **Week 4**: Admin UI + monitoring dashboard
- **Week 5**: Add new jobs (privacy cleanup, etc.)

### Open Questions

1. **Distributed Systems**: If we scale to multiple servers, should jobs run on all or just one?
   - **Recommendation**: Use Redis-based leader election or distributed lock

2. **Job Parameters**: Should jobs support dynamic parameters?
   - **Recommendation**: Yes, add `parameters` field to job config

3. **Job Dependencies**: Should jobs support dependencies (Job B runs after Job A)?
   - **Recommendation**: Phase 2 feature, not MVP

4. **Job Notifications**: Alert on job failures?
   - **Recommendation**: Yes, integrate with email/Slack notifications

## Decision

**Status**: Proposal - Awaiting Review

**Recommended Approach**: Implement in phases starting with Phase 1 (Core Service) and Phase 2 (Cron Support), then gradually migrate existing jobs.

This provides immediate value while minimizing risk.
