import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockConfig = {
  plugins: { allowCustomPlugins: true, maxUploadSizeMB: 5 },
  github: { appId: "1", appPrivateKey: "k", appName: "hay" },
};
jest.mock("@server/config/env", () => ({ config: mockConfig }));
jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const registryUpdate = jest.fn<(id: string, fields: unknown) => Promise<unknown>>();
jest.mock("@server/database/data-source", () => ({
  AppDataSource: { getRepository: () => ({ update: registryUpdate }) },
}));
jest.mock("@server/entities/plugin-registry.entity", () => ({ PluginRegistry: class {} }));

const findConnection = jest.fn<(id: string) => Promise<unknown>>();
jest.mock("@server/repositories/git-connection.repository", () => ({
  gitConnectionRepository: {
    findById: findConnection,
    findByIdAndOrganization: async (id: string, organizationId: string) => {
      const found = (await findConnection(id)) as { organizationId?: string } | null;
      return found && found.organizationId === organizationId ? found : null;
    },
  },
}));
const findByPluginId = jest.fn<(id: string) => Promise<unknown>>();
const findById = jest.fn<(id: string) => Promise<unknown>>();
const findAllGitPlugins = jest.fn<() => Promise<unknown[]>>();
jest.mock("@server/repositories/plugin-registry.repository", () => ({
  pluginRegistryRepository: { findByPluginId, findById, findAllGitPlugins },
}));
jest.mock("@server/services/oauth-state.service", () => ({ oauthStateService: {} }));

const getLatestCommit = jest.fn<(...args: unknown[]) => Promise<{ sha: string }>>();
const downloadArchive = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock("@server/lib/git/github-provider", () => ({
  GitHubProvider: class {
    getLatestCommit = getLatestCommit;
    downloadArchive = downloadArchive;
    listRepositories = async () => [];
  },
}));
const extractTarball = jest.fn<(...args: unknown[]) => Promise<void>>();
const validateTarball = jest.fn<(buffer: Buffer) => Promise<{ pluginId: string }>>();
jest.mock("@server/lib/git/tarball", () => ({ extractTarball, validateTarball }));

const uploadPluginZip = jest.fn<(opts: unknown) => Promise<unknown>>();
jest.mock("@server/services/storage.service", () => ({ storageService: { uploadPluginZip } }));
const registerPlugin = jest.fn<(...args: unknown[]) => Promise<void>>();
jest.mock("@server/services/plugin-manager.service", () => ({
  assertCustomPluginsAllowed: () => {
    if (!mockConfig.plugins.allowCustomPlugins) throw new Error("Custom plugins are disabled");
  },
  pluginManagerService: { registerPlugin },
}));

import { gitConnectionService } from "@server/services/git-connection.service";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const connection = (organizationId: string) => ({
  id: "conn-1",
  organizationId,
  provider: "github",
  installationId: "inst-1",
  status: "active",
});
const gitPlugin = {
  id: "row-git",
  pluginId: "tenant-git",
  sourceType: "git",
  organizationId: ORG_A,
  gitConnectionId: "conn-1",
  gitRepoFullName: "acme/plugin",
  gitBranch: "main",
  gitLastCommitSha: "old-sha",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.plugins.allowCustomPlugins = true;
  getLatestCommit.mockResolvedValue({ sha: "new-sha" });
  downloadArchive.mockResolvedValue({ buffer: Buffer.from("tgz"), commitSha: "new-sha" });
});

describe("installPluginFromRepo", () => {
  const install = () =>
    gitConnectionService.installPluginFromRepo({
      connectionId: "conn-1",
      organizationId: ORG_B,
      repoFullName: "acme/plugin",
      branch: "main",
      userId: "user-b",
    });

  it("rejects a repository whose package is named like a core plugin", async () => {
    findConnection.mockResolvedValue(connection(ORG_B));
    validateTarball.mockResolvedValue({ pluginId: "hay-plugin-stripe" });
    findByPluginId.mockResolvedValue({ pluginId: "hay-plugin-stripe", sourceType: "core" });

    await expect(install()).rejects.toThrow(/not available/);
    expect(uploadPluginZip).not.toHaveBeenCalled();
    expect(extractTarball).not.toHaveBeenCalled();
    expect(registerPlugin).not.toHaveBeenCalled();
  });

  it("downloads the archive at the resolved commit with a size cap", async () => {
    findConnection.mockResolvedValue(connection(ORG_B));
    validateTarball.mockResolvedValue({ pluginId: "taken" });
    findByPluginId.mockResolvedValue({ pluginId: "taken", sourceType: "custom" });

    await expect(install()).rejects.toThrow();
    expect(downloadArchive).toHaveBeenCalledWith(
      "inst-1",
      "acme/plugin",
      "new-sha",
      5 * 1024 * 1024,
    );
  });

  it("is refused when custom plugins are disabled", async () => {
    mockConfig.plugins.allowCustomPlugins = false;
    await expect(install()).rejects.toThrow(/disabled/);
    expect(downloadArchive).not.toHaveBeenCalled();
  });
});

describe("syncPlugin / checkForUpdates", () => {
  it("refuses another organization's git plugin", async () => {
    findById.mockResolvedValue(gitPlugin);
    findConnection.mockResolvedValue(connection(ORG_A));

    await expect(gitConnectionService.syncPlugin("row-git", ORG_B)).rejects.toThrow(
      /not a git-sourced plugin/,
    );
    await expect(gitConnectionService.checkForUpdates("row-git", ORG_B)).rejects.toThrow(
      /not a git-sourced plugin/,
    );
    expect(downloadArchive).not.toHaveBeenCalled();
  });

  it("rejects an update whose archive carries a different plugin id", async () => {
    findById.mockResolvedValue(gitPlugin);
    findConnection.mockResolvedValue(connection(ORG_A));
    validateTarball.mockResolvedValue({ pluginId: "hay-plugin-stripe" });

    await expect(gitConnectionService.syncPlugin("row-git", ORG_A)).rejects.toThrow(
      /expected tenant-git/,
    );
    expect(extractTarball).not.toHaveBeenCalled();
  });
});

describe("checkAllGitPluginsForUpdates", () => {
  it("flags available updates without downloading or installing code", async () => {
    findAllGitPlugins.mockResolvedValue([gitPlugin]);
    findById.mockResolvedValue(gitPlugin);
    findConnection.mockResolvedValue(connection(ORG_A));

    await gitConnectionService.checkAllGitPluginsForUpdates();

    expect(downloadArchive).not.toHaveBeenCalled();
    expect(registerPlugin).not.toHaveBeenCalled();
    expect(registryUpdate).toHaveBeenCalledWith(
      "row-git",
      expect.objectContaining({ gitAvailableCommitSha: "new-sha" }),
    );
  });
});
