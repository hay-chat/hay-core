/**
 * A full sweep that resumes from a cursor only sees the pages after that cursor, so it must not
 * reconcile deletions: everything imported by earlier runs would look removed and get archived.
 */

const mockFindById = jest.fn();
const mockMarkRunning = jest.fn();
const mockRecordSyncResult = jest.fn();
const mockFindExternalIds = jest.fn();
const mockFindByExternalId = jest.fn();
const mockUpdateDocument = jest.fn();
const mockCreateDocument = jest.fn();
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
    findExternalIdsForSource: (...args: unknown[]) => mockFindExternalIds(...args),
    findByExternalId: (...args: unknown[]) => mockFindByExternalId(...args),
    update: (...args: unknown[]) => mockUpdateDocument(...args),
    create: (...args: unknown[]) => mockCreateDocument(...args),
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
  pluginManagerService: { ensurePluginRouterRegistered: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock("@server/services/plugin-router-registry.service", () => ({
  pluginRouterRegistry: {
    getRouter: () => ({
      createCaller: () => ({
        discover: (...args: unknown[]) => mockDiscover(...args),
        fetchPage: (...args: unknown[]) => mockFetchPage(...args),
      }),
    }),
  },
}));
jest.mock("@server/services/importers/website-importer", () => ({
  WebsiteImporter: jest.fn(),
  isWebsiteSource: () => false,
}));

import { DocumentationStatus } from "@server/entities/document.entity";
import type { Job } from "@server/entities/job.entity";
import { DocumentSourceSyncService } from "@server/services/document-source-sync.service";

const page = (id: string) => ({ externalId: id, title: id, externalUpdatedAt: "2026-01-01" });

function run(lastSyncCursor: string | null) {
  mockFindById.mockResolvedValue({
    id: "source-1",
    organizationId: "org-1",
    pluginId: "fake",
    enabled: true,
    externalRootId: "root",
    lastSyncCursor,
  });
  return new DocumentSourceSyncService().processSyncJob({
    id: "job-1",
    data: { documentSourceId: "source-1", forceFullSweep: true },
  } as unknown as Job);
}

const archivedIds = () =>
  mockUpdateDocument.mock.calls
    .filter(([, , patch]) => patch.status === DocumentationStatus.ARCHIVED)
    .map(([id]) => id);

describe("full sweep deletion reconciliation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMarkRunning.mockResolvedValue(true);
    mockDiscover.mockResolvedValue({ pages: [page("page-11")] });
    mockFindExternalIds.mockResolvedValue(["page-1", "page-11"]);
    // Every discovered page is already stored and current; "page-1" is only in the store.
    mockFindByExternalId.mockImplementation(async (_source: string, externalId: string) => ({
      id: externalId,
      externalUpdatedAt: new Date("2026-06-01"),
      status: DocumentationStatus.PUBLISHED,
    }));
  });

  it("keeps pages from earlier runs when the sweep resumed from a cursor", async () => {
    await run("10");

    expect(mockDiscover).toHaveBeenCalledWith(expect.objectContaining({ cursor: "10" }));
    expect(archivedIds()).toEqual([]);
    expect(mockRecordSyncResult).toHaveBeenCalledWith(
      "source-1",
      expect.objectContaining({ status: "success", cursor: null, isFullSweep: true }),
    );
  });

  it("still archives removed pages when the sweep ran from the start in one job", async () => {
    await run(null);

    expect(archivedIds()).toEqual(["page-1"]);
    expect(mockRecordSyncResult).toHaveBeenCalledWith(
      "source-1",
      expect.objectContaining({ status: "success", isFullSweep: true }),
    );
  });
});
