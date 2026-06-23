/**
 * Hay Plugin SDK - Cron Runtime Auth API
 *
 * Builds the auth API handed to a cron handler. It extends the read-only runtime
 * auth API with `update()`, which buffers refreshed credentials so the worker can
 * return them to Hay Core after the handler completes (Core persists + restarts).
 *
 * @module @hay/plugin-sdk/sdk/cron-runtime
 */

import type { AuthState, HayCronAuthAPI, HayLogger } from "../types/index.js";
import { createAuthRuntimeAPI } from "./auth-runtime.js";

/**
 * Options for {@link createCronAuthAPI}.
 *
 * @internal
 */
export interface CronAuthAPIOptions {
  /** Current auth state for the org (null if none). */
  authState: AuthState | null;
  /** Logger. */
  logger: HayLogger;
}

/**
 * Create a cron auth API plus an accessor for any buffered credential update.
 *
 * @param options - Cron auth API options
 * @returns The API and a getter that returns the pending {@link AuthState} (or null)
 *
 * @internal
 */
export function createCronAuthAPI(options: CronAuthAPIOptions): {
  api: HayCronAuthAPI;
  getPendingUpdate: () => AuthState | null;
} {
  const { authState, logger } = options;
  const readOnly = createAuthRuntimeAPI({ authState, logger });

  let pending: AuthState | null = null;

  const api: HayCronAuthAPI = {
    get: readOnly.get,
    update(credentials: Record<string, unknown>, methodId?: string): void {
      if (!credentials || typeof credentials !== "object") {
        throw new Error("auth.update(): credentials must be an object");
      }

      const resolvedMethodId = methodId ?? authState?.methodId ?? "oauth";
      pending = {
        methodId: resolvedMethodId,
        credentials: { ...credentials },
      };

      logger.info("Cron handler staged a credential update", { methodId: resolvedMethodId });
    },
  };

  return { api, getPendingUpdate: () => pending };
}
