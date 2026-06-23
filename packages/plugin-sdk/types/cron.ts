/**
 * Hay Plugin SDK - Cron Job Types
 *
 * Types for plugin-registered background cron jobs.
 *
 * Plugins declare cron jobs in `onInitialize` via `register.cron(...)`. The jobs
 * are NOT scheduled inside the (idle-killed) worker — Hay Core owns the schedule
 * and, when a job fires, wakes the org's worker and invokes the handler over HTTP
 * with a fresh org-scoped context. This keeps "one worker per org per plugin"
 * isolation while surviving worker restarts.
 *
 * @module @hay/plugin-sdk/types/cron
 */

import type { HayOrg } from "./org";
import type { HayConfigRuntimeAPI } from "./config";
import type { AuthState, HayAuthRuntimeAPI } from "./auth";
import type { HayLogger } from "./logger";

/**
 * Retry policy for a cron job.
 *
 * @remarks
 * `backoff` is advisory for now — Hay Core maps `maxRetries` onto the platform
 * scheduler's retry machinery. Exponential backoff is the default behaviour.
 */
export interface CronRetryPolicy {
  /** Maximum retry attempts after a failed run. Default: 0 (no retry). */
  maxRetries?: number;
  /** Backoff strategy between retries. Default: "exponential". */
  backoff?: "fixed" | "exponential";
}

/**
 * Auth API available inside a cron handler.
 *
 * Extends the read-only runtime auth API with `update()`, which lets a job
 * persist refreshed credentials (e.g. a rotated access token). The update is
 * buffered and handed back to Hay Core when the handler returns; Core persists
 * it (encrypted) and restarts the worker so the running MCP server picks up the
 * new credentials.
 */
export interface HayCronAuthAPI extends HayAuthRuntimeAPI {
  /**
   * Persist new credentials for this org+plugin.
   *
   * @param credentials - New credential values (e.g. `{ accessToken, expiresAt }`)
   * @param methodId - Optional auth method id; defaults to the current method.
   */
  update(credentials: Record<string, unknown>, methodId?: string): void;
}

/**
 * Context passed to a cron job handler.
 *
 * Org-scoped, mirrors {@link HayStartContext} minus the MCP runtime (a cron job
 * orchestrates data/credentials, it does not start MCP servers).
 */
export interface HayCronContext {
  /** Organization this run belongs to. */
  org: HayOrg;
  /** Read org config values (secrets resolved + decrypted). */
  config: HayConfigRuntimeAPI;
  /** Read auth state and persist refreshed credentials. */
  auth: HayCronAuthAPI;
  /** Logger tagged with org + plugin + job context. */
  logger: HayLogger;
}

/**
 * Cron job handler function.
 */
export type CronJobHandler = (ctx: HayCronContext) => Promise<void> | void;

/**
 * Options accepted by `register.cron()`.
 */
export interface CronJobOptions {
  /**
   * Unique job name within the plugin.
   *
   * @remarks Used to build the platform job id. Must match `[a-z0-9_-]+`.
   */
  name: string;

  /**
   * Cron expression (5-field), e.g. `"0 *​/20 * * *"` for every 20 hours.
   */
  schedule: string;

  /** Handler invoked when the job fires. */
  handler: CronJobHandler;

  /** Optional retry policy. */
  retryPolicy?: CronRetryPolicy;
}

/**
 * Serialisable cron descriptor exposed via the `/metadata` endpoint (no handler).
 *
 * Hay Core reads this to register the schedule per enabled org.
 */
export interface CronJobDescriptor {
  name: string;
  schedule: string;
  retryPolicy?: CronRetryPolicy;
}

/**
 * Result returned by a cron handler invocation (worker → core).
 *
 * @internal
 */
export interface CronInvocationResult {
  success: boolean;
  /** Present when the handler called `ctx.auth.update()`. */
  credentialsUpdated?: AuthState;
  error?: string;
}
