/**
 * Website sources: pages are fetched in parallel, and a run that hits the time
 * budget after making progress asks to be continued right away.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

const mockFindById = jest.fn();
const mockMarkRunning = jest.fn();
const mockRecordSyncResult = jest.fn();
const mockFindByExternalId = jest.fn();
const mockCreateDocument = jest.fn();
const mockUpdateDocument = jest.fn();
const mockFindExternalIds = jest.fn();
const mockDiscover = jest.fn();
const mockFetchPage = jest.fn();

jest.mock("@server/repositories/document-source.repository", () => ({
  documentSourceRepository: {
    findByIdInternal: (...args: unknown[]) => mockFindById(...args),
    markRunning: (...args: unknown[]) => mockMarkRunning(...args),
    recordSyncResult: (...args: unknown[]) => mockRecordSyncResult(...args),
  },
}));
jest.mock("@server/repositories/document.repository", () => ({
  documentRepository: {
    findByExternalId: (...args: unknown[]) => mockFindByExternalId(...args),
    create: (...args: unknown[]) => mockCreateDocument(...args),
    update: (...args: unknown[]) => mockUpdateDocument(...args),
    findExternalIdsForSource: (...args: unknown[]) => mockFindExternalIds(...args),
  },
}));
jest.mock("@server/repositories/job.repository", () => ({
  jobRepository: { update: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock("@server/services/vector-store.service", () => ({
  vectorStoreService: {
    initialized: true,
    deleteByDocumentId: jest.fn().mockResolvedValue(undefined),
    addChunks: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock("@server/services/plugin-manager.service", () => ({
  pluginManagerService: { ensurePluginRouterRegistered: jest.fn() },
}));
jest.mock("@server/services/plugin-router-registry.service", () => ({
  pluginRouterRegistry: { getRouter: () => undefined },
}));
jest.mock("@server/services/importers/website-importer", () => ({
  WebsiteImporter: jest.fn().mockImplementation(() => ({
    discover: (...args: unknown[]) => mockDiscover(...args),
    fetchPage: (...args: unknown[]) => mockFetchPage(...args),
  })),
  isWebsiteSource: () => true,
}));

import type { Job } from "@server/entities/job.entity";
import { DocumentSourceSyncService } from "@server/services/document-source-sync.service";

const pages = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    externalId: `https://docs.test/p${i}`,
    title: `p${i}`,
    externalUrl: `https://docs.test/p${i}`,
    externalUpdatedAt: "2026-01-01T00:00:00.000Z",
  }));

const job = {
  id: "job-1",
  data: { documentSourceId: "src-1", forceFullSweep: true },
} as unknown as Job;

/** Fake clock: `ms` is what the sync service reads as elapsed time. */
let ms = 0;
let running = 0;
let maxRunning = 0;

function service(): DocumentSourceSyncService {
  const s = new DocumentSourceSyncService();
  s.setClock(() => ms);
  return s;
}

beforeEach(() => {
  jest.clearAllMocks();
  ms = 0;
  running = 0;
  maxRunning = 0;
  mockFindById.mockResolvedValue({
    id: "src-1",
    organizationId: "org-1",
    pluginId: "core:website",
    enabled: true,
    externalRootId: "https://docs.test",
    lastSyncCursor: null,
  });
  mockMarkRunning.mockResolvedValue(true);
  mockFindByExternalId.mockResolvedValue(null);
  mockFindExternalIds.mockResolvedValue([]);
  mockCreateDocument.mockImplementation(async (d: { externalId: string }) => ({
    id: d.externalId,
    title: d.externalId,
  }));
  mockUpdateDocument.mockResolvedValue(null);
  mockFetchPage.mockImplementation(async ({ externalId }: { externalId: string }) => {
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    await new Promise((resolve) => setTimeout(resolve, 2));
    running -= 1;
    return { externalId, title: externalId, markdown: "hello world" };
  });
});

describe("website source sync", () => {
  it("fetches pages 4 at a time and finishes without asking to continue", async () => {
    mockDiscover.mockResolvedValue({ pages: pages(10), total: 10 });

    const outcome = await service().processSyncJob(job);

    expect(mockFetchPage).toHaveBeenCalledTimes(10);
    expect(maxRunning).toBe(4);
    expect(mockRecordSyncResult).toHaveBeenCalledWith(
      "src-1",
      expect.objectContaining({ status: "success" }),
    );
    expect(outcome).toEqual({ continueNow: false });
  });

  it("stores each page's address as its public sourceUrl", async () => {
    mockDiscover.mockResolvedValue({ pages: pages(1), total: 1 });

    await service().processSyncJob(job);

    expect(mockCreateDocument).toHaveBeenCalledWith(
      expect.objectContaining({ sourceUrl: "https://docs.test/p0" }),
    );
    expect(mockUpdateDocument).toHaveBeenCalledWith(
      "https://docs.test/p0",
      "org-1",
      expect.objectContaining({ sourceUrl: "https://docs.test/p0" }),
    );
  });

  it("asks to continue now when the budget runs out after some progress", async () => {
    mockDiscover.mockResolvedValue({ pages: pages(20), nextCursor: "20", total: 40 });
    // Each fetched page costs 20 s of budget: the run stops after the first wave.
    const fetchPage = mockFetchPage.getMockImplementation()!;
    mockFetchPage.mockImplementation(async (input: { externalId: string }) => {
      const result = await fetchPage(input);
      ms += 20_000;
      return result;
    });

    const outcome = await service().processSyncJob(job);

    expect(mockFetchPage.mock.calls.length).toBeLessThan(20);
    expect(mockRecordSyncResult).toHaveBeenCalledWith(
      "src-1",
      // The batch was cut short, so the cursor stays at its start for the next run.
      expect.objectContaining({ status: "partial", cursor: null }),
    );
    expect(outcome).toEqual({ continueNow: true });
  });

  it("does not ask to continue when a partial run made no progress", async () => {
    mockDiscover.mockImplementation(async () => {
      ms = 60_000; // budget gone before any page is handled
      return { pages: pages(5), nextCursor: "5" };
    });

    const outcome = await service().processSyncJob(job);

    expect(mockFetchPage).not.toHaveBeenCalled();
    expect(mockRecordSyncResult).toHaveBeenCalledWith(
      "src-1",
      expect.objectContaining({ status: "partial" }),
    );
    expect(outcome).toEqual({ continueNow: false });
  });
});
