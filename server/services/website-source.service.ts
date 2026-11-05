import { TRPCError } from "@trpc/server";
import { documentSourceRepository } from "@server/repositories/document-source.repository";
import { documentSourceSyncService } from "@server/services/document-source-sync.service";
import {
  WEBSITE_PLUGIN_ID,
  WEBSITE_SOURCE_TYPE,
} from "@server/services/importers/website-importer";
import { validateUrlForSSRF } from "@server/utils/ssrf";
import type { DocumentSource } from "@server/entities/document-source.entity";

export const WEBSITE_DEFAULT_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Normalizes a website to its origin, so the same site isn't connected twice under trivially
 * different paths or queries. Throws BAD_REQUEST for anything that isn't an http(s) URL.
 */
export function normalizeWebsiteUrl(input: string): { origin: string; hostname: string } {
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("scheme");
    return { origin: parsed.origin, hostname: parsed.hostname };
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid website URL" });
  }
}

/** The org's website source for this origin, if one exists. */
export async function findWebsiteSource(
  organizationId: string,
  origin: string,
): Promise<DocumentSource | null> {
  const sources = await documentSourceRepository.findByOrganization(organizationId);
  return (
    sources.find(
      (s) => s.pluginId === WEBSITE_PLUGIN_ID && (s.config?.url ?? s.externalRootId) === origin,
    ) ?? null
  );
}

/**
 * Creates a website source and starts its first full sweep. SSRF-validates the URL first.
 * Shared by `documentSources.createWebsite` and in-app setup.
 */
export async function createWebsiteSource(
  organizationId: string,
  url: string,
  options: { displayName?: string; syncIntervalMs?: number | null } = {},
): Promise<{ source: DocumentSource; jobId: string }> {
  // Block SSRF (internal IPs, link-local, etc.) before we ever store or fetch.
  await validateUrlForSSRF(url);
  const { origin, hostname } = normalizeWebsiteUrl(url);

  const source = await documentSourceRepository.create({
    organizationId,
    pluginId: WEBSITE_PLUGIN_ID,
    displayName: options.displayName?.trim() || hostname,
    sourceType: WEBSITE_SOURCE_TYPE,
    externalRootId: origin,
    externalRootLabel: hostname,
    config: { url: origin },
    syncIntervalMs:
      options.syncIntervalMs === undefined
        ? WEBSITE_DEFAULT_SYNC_INTERVAL_MS
        : (options.syncIntervalMs ?? undefined),
  });

  // Start the sweep right away so the source isn't empty while the user waits for the scheduler.
  const { jobId } = await documentSourceSyncService.enqueueSync(source.id, {
    forceFullSweep: true,
  });
  return { source, jobId };
}
