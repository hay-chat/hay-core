import { describe, it, expect, beforeEach } from "@jest/globals";

jest.mock("@server/database/data-source", () => ({ AppDataSource: { query: jest.fn() } }));
jest.mock("@server/services/organization.service", () => ({
  organizationService: { findOne: jest.fn().mockResolvedValue({ defaultLanguage: "en" }) },
}));
jest.mock("@server/services/plugin-manager.service", () => ({
  pluginManagerService: {
    getAllPlugins: jest.fn(() => [
      {
        pluginId: "wa",
        name: "WhatsApp",
        manifest: { channel: "whatsapp" },
      },
    ]),
    findPluginIdByChannel: jest.fn().mockResolvedValue(null),
  },
  isPluginVisibleToOrganization: () => true,
}));
jest.mock("@server/services/setup/check", () => ({
  ...jest.requireActual("@server/services/setup/check"),
}));
jest.mock("@server/services/document-source-sync.service", () => ({
  documentSourceSyncService: {},
}));
jest.mock("@server/services/vector-store.service", () => ({ vectorStoreService: {} }));
jest.mock("@server/services/core/llm.service", () => ({ LLMService: class {} }));
jest.mock("@server/services/web-scraper.service", () => ({ WebScraperService: class {} }));
jest.mock("@server/repositories/document-source.repository", () => ({
  documentSourceRepository: {},
}));
jest.mock("@server/repositories/document.repository", () => ({ documentRepository: {} }));

const store = {
  current: { toolPluginIds: [], channels: [] as string[], questions: [] } as Record<
    string,
    unknown
  >,
};
jest.mock("@server/services/setup/store", () => ({
  readSetup: jest.fn(async () => store.current),
  updateSetup: jest.fn(async (_org: string, change: (c: unknown) => unknown) => {
    store.current = change(store.current) as typeof store.current;
    return store.current;
  }),
}));

const websiteSource = {
  find: jest.fn(),
  create: jest.fn(),
};
jest.mock("@server/services/website-source.service", () => ({
  ...jest.requireActual("@server/services/website-source.service"),
  findWebsiteSource: (...args: unknown[]) => websiteSource.find(...args),
  createWebsiteSource: (...args: unknown[]) => websiteSource.create(...args),
}));

const readSiteState = jest.fn();
const startSiteRead = jest.fn();
jest.mock("@server/services/setup/site", () => ({
  ...jest.requireActual("@server/services/setup/site"),
  readSiteState: (...args: unknown[]) => readSiteState(...args),
  startSiteRead: (...args: unknown[]) => startSiteRead(...args),
}));

import { startReading } from "../../services/setup/setup.service";
import { resolveSiteState } from "../../services/setup/site";
import { buildBoard } from "../../services/setup/board";
import { DocumentSourceSyncStatus } from "@server/entities/document-source.entity";
import { JobStatus } from "@server/entities/job.entity";
import { AppDataSource } from "@server/database/data-source";

const reading = { state: { state: "reading", discovered: 0, processed: 0 } };
const failed = { state: { state: "failed", discovered: 0, processed: 0 } };

beforeEach(() => {
  store.current = { toolPluginIds: [], channels: [], questions: [] };
  readSiteState.mockReset().mockResolvedValue(reading);
  startSiteRead.mockReset().mockResolvedValue({ failed: false });
  (AppDataSource.query as jest.Mock).mockResolvedValue([]);
});

describe("startReading", () => {
  it("saves the address with a scheme, starts the read and resumes a partial one", async () => {
    const board = await startReading("org", " alma.example ");
    expect(startSiteRead).toHaveBeenCalledWith("org", "https://alma.example");
    expect(store.current.website).toBe("https://alma.example");
    expect(readSiteState).toHaveBeenCalledWith("org", "https://alma.example", { resume: true });
    expect(board.site.state).toBe("reading");
  });

  it("is idempotent: a second call keeps the stored settings and reads through the same path", async () => {
    await startReading("org", "https://alma.example");
    const first = store.current;
    await startReading("org", "alma.example");
    expect(store.current).toBe(first);
    expect(startSiteRead).toHaveBeenCalledTimes(2); // site.ts shares the actual attempt per address
  });

  it("does not throw on a bad address and shows it through site.state", async () => {
    startSiteRead.mockResolvedValue({ failed: true });
    readSiteState.mockResolvedValue(failed);
    const board = await startReading("org", "not a url");
    expect(board.site.state).toBe("failed");
    expect(board.website).toBe("https://not a url");
  });
});

const source = (status: DocumentSourceSyncStatus) => ({
  id: "s1",
  lastSyncStatus: status,
  lastSyncedAt: new Date("2026-11-05T10:00:00Z"),
});

describe("partial website reads", () => {
  it("keeps reading while setup may continue, and counts the pages already stored", () => {
    const reading = resolveSiteState({
      source: source(DocumentSourceSyncStatus.PARTIAL),
      jobStatus: JobStatus.COMPLETED,
      progress: { processed: 12, discovered: 12, total: 900 },
      pagesRead: 140,
      canContinue: true,
    });
    expect(reading.state).toMatchObject({ state: "reading", processed: 140, total: 900 });
    expect(reading.state.partial).toBeUndefined();
  });

  it("past the cap it is done but partial, never passed off as a complete read", () => {
    const capped = resolveSiteState({
      source: source(DocumentSourceSyncStatus.PARTIAL),
      jobStatus: JobStatus.COMPLETED,
      pagesRead: 400,
      canContinue: false,
    });
    expect(capped.state).toMatchObject({ state: "done", partial: true, processed: 400 });
  });

  it("a complete read is not partial", () => {
    const done = resolveSiteState({
      source: source(DocumentSourceSyncStatus.SUCCESS),
      jobStatus: JobStatus.COMPLETED,
      progress: { processed: 42, discovered: 42 },
    });
    expect(done.state.state).toBe("done");
    expect(done.state.partial).toBeUndefined();
  });
});

describe("board contract", () => {
  it("carries plugin names and resolved channels", () => {
    const board = buildBoard({
      setup: { toolPluginIds: ["shop", "gone"], channels: ["webchat"], questions: [] },
      site: reading,
      plugins: [{ id: "shop", name: "Shopify", handles: [] }],
      playbooks: [],
      hasRealConversations: false,
      channels: [{ id: "webchat", name: "Website chat", connected: true }],
    } as never);
    expect(board.toolPlugins).toEqual([{ id: "shop", name: "Shopify" }]);
    expect(board.channelRefs).toHaveLength(1);
  });
});

describe("startSiteRead", () => {
  it("creates one source when blur and Continue ask for the same address at once", async () => {
    const { startSiteRead: actual } = jest.requireActual("../../services/setup/site");
    websiteSource.find.mockResolvedValue(null);
    websiteSource.create.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({}), 10)),
    );
    const [a, b] = await Promise.all([
      actual("org", "https://alma.example/shop"),
      actual("org", "https://alma.example"),
    ]);
    expect(websiteSource.create).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ failed: false });
    expect(b).toEqual({ failed: false });
  });

  it("reports a bad address instead of throwing", async () => {
    const { startSiteRead: actual } = jest.requireActual("../../services/setup/site");
    await expect(actual("org", "not a url")).resolves.toEqual({ failed: true });
  });
});
