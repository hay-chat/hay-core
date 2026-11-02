import { describe, it, expect, jest, beforeEach } from "@jest/globals";

jest.mock("@server/database/data-source", () => ({ AppDataSource: {} }));

import {
  PluginIdConflictError,
  PluginRegistryRepository,
} from "@server/repositories/plugin-registry.repository";
import type { PluginRegistry } from "@server/entities/plugin-registry.entity";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const findOne = jest.fn<(opts: unknown) => Promise<PluginRegistry | null>>();
const update = jest.fn<(id: string, fields: unknown) => Promise<unknown>>();
const save = jest.fn<(entity: unknown) => Promise<unknown>>();

const repository = new PluginRegistryRepository();
jest
  .spyOn(repository as unknown as { getRepository: () => unknown }, "getRepository")
  .mockReturnValue({ findOne, update, save, create: (e: unknown) => e });

const row = (fields: Partial<PluginRegistry>): PluginRegistry =>
  ({ id: "row-1", pluginId: "hay-plugin-stripe", checksum: "c1", ...fields }) as PluginRegistry;

describe("PluginRegistryRepository.upsertPlugin ownership", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("refuses to let an organization's custom plugin take over a core row", async () => {
    findOne.mockResolvedValue(row({ sourceType: "core", pluginPath: "core/stripe" }));

    await expect(
      repository.upsertPlugin({
        pluginId: "hay-plugin-stripe",
        pluginPath: `custom/${ORG_B}/hay-plugin-stripe`,
        sourceType: "custom",
        organizationId: ORG_B,
        checksum: "evil",
      }),
    ).rejects.toBeInstanceOf(PluginIdConflictError);
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses to move another organization's custom plugin", async () => {
    findOne.mockResolvedValue(row({ sourceType: "custom", organizationId: ORG_A }));

    await expect(
      repository.upsertPlugin({
        pluginId: "hay-plugin-stripe",
        sourceType: "git",
        organizationId: ORG_B,
      }),
    ).rejects.toBeInstanceOf(PluginIdConflictError);
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses to turn a custom row into a core row", async () => {
    findOne.mockResolvedValue(row({ sourceType: "custom", organizationId: ORG_A }));

    await expect(
      repository.upsertPlugin({ pluginId: "hay-plugin-stripe", sourceType: "core" }),
    ).rejects.toBeInstanceOf(PluginIdConflictError);
    expect(update).not.toHaveBeenCalled();
  });

  it("refreshes the owner's own row and keeps a git plugin's source type", async () => {
    findOne.mockResolvedValue(
      row({ sourceType: "git", organizationId: ORG_A, gitConnectionId: "conn-1" }),
    );

    await repository.upsertPlugin({
      pluginId: "hay-plugin-stripe",
      sourceType: "custom", // filesystem re-discovery reports git plugins as custom
      organizationId: ORG_A,
      checksum: "c2",
    });

    expect(update).toHaveBeenCalledWith(
      "row-1",
      expect.objectContaining({ sourceType: "git", organizationId: ORG_A, built: false }),
    );
  });

  it("refreshes a core row from core discovery", async () => {
    findOne.mockResolvedValue(row({ sourceType: "core" }));

    await repository.upsertPlugin({ pluginId: "hay-plugin-stripe", sourceType: "core" });

    expect(update).toHaveBeenCalledWith("row-1", expect.objectContaining({ sourceType: "core" }));
  });
});
