/**
 * Hay Plugin SDK - Dispute Source Runtime API
 *
 * HTTP client backing `HayStartContext.disputes`. Reports payment disputes to
 * core's plugin-api tRPC router (`pluginApi.disputes.report`) with the JWT
 * injected via HAY_API_TOKEN (capability-scoped to `disputes`).
 *
 * @module @hay/plugin-sdk/sdk/dispute-source-runtime
 */

import type { CanonicalDispute, HayDisputeSourceRuntimeAPI, HayLogger } from "../types/index.js";

/** Worker route core POSTs the evidence pack to ("Attach as draft"). Core-only. */
export const DISPUTE_EVIDENCE_ROUTE = "/disputes/evidence";

/**
 * Every evidence file core pushes is named `hay-chat-evidence-...`. A plugin
 * may replace a file whose name starts with this; any other file in a slot is
 * the merchant's and must be kept. (Core: server/services/disputes/copy.ts.)
 */
export const DISPUTE_EVIDENCE_FILE_PREFIX = "hay-chat-evidence";

export interface DisputeSourceRuntimeOptions {
  apiUrl: string;
  apiToken: string;
  logger: HayLogger;
  /** Override fetch for testing. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

export function createDisputeSourceRuntime(
  options: DisputeSourceRuntimeOptions,
): HayDisputeSourceRuntimeAPI {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as typeof fetch);
  const { apiUrl, apiToken, logger } = options;

  return {
    async report(dispute: CanonicalDispute): Promise<{ created: boolean }> {
      const url = `${apiUrl.replace(/\/$/, "")}/v1/pluginApi.disputes.report`;
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(dispute),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`disputes.report HTTP ${res.status}: ${text || res.statusText}`);
      }
      const json = (await res.json()) as { result?: { data?: { created?: boolean } } };
      const created = Boolean(json.result?.data?.created);
      logger.debug("Reported dispute to core", { externalId: dispute.externalId, created });
      return { created };
    },
  };
}
