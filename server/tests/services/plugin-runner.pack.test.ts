/**
 * An organization-supplied plugin starts only as the pack it was installed
 * from; core plugins are not subject to the check.
 */
import { promises as fs } from "fs";
import os from "os";
import path from "path";

const spawn = jest.fn();
jest.mock("child_process", () => ({ spawn }));
const repository = { update: jest.fn().mockResolvedValue(undefined) };
jest.mock("@server/database/data-source", () => ({
  AppDataSource: { getRepository: () => repository },
}));
jest.mock("@server/services/port-allocator.service", () => ({
  getPortAllocator: () => ({ allocate: jest.fn().mockResolvedValue(4001), release: jest.fn() }),
}));
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: { updateHealthCheck: jest.fn() },
}));
jest.mock("@server/services/plugin-tools.service", () => ({ fetchAndStoreTools: jest.fn() }));
jest.mock("@server/services/oauth.service", () => ({ oauthService: {} }));

import { PluginRunnerService } from "@server/services/plugin-runner.service";
import { PACK_MANIFEST_FILE, sha256Hex } from "@server/lib/plugin-pack";

type Spawnable = {
  spawnWorker(
    orgId: string,
    pluginId: string,
    plugin: unknown,
    instance: unknown,
  ): Promise<unknown>;
};

let pluginDir: string;
const start = (sourceType: "core" | "custom") =>
  (new PluginRunnerService() as unknown as Spawnable).spawnWorker(
    "org-1",
    "tenant-plugin",
    { sourceType, pluginPath: pluginDir, manifest: { capabilities: [] }, metadata: {} },
    { id: "instance-1", config: {}, authState: null },
  );

async function writePack() {
  const content = "module.exports = {};";
  await fs.writeFile(path.join(pluginDir, "index.js"), content);
  await fs.writeFile(
    path.join(pluginDir, PACK_MANIFEST_FILE),
    JSON.stringify({
      format: 1,
      name: "tenant-plugin",
      version: "1.0.0",
      files: { "index.js": { sha256: sha256Hex(content), size: content.length } },
    }),
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  spawn.mockImplementation(() => {
    throw new Error("spawn reached");
  });
  pluginDir = await fs.mkdtemp(path.join(os.tmpdir(), "runner-pack-"));
});
afterEach(() => fs.rm(pluginDir, { recursive: true, force: true }));

describe("starting an organization-supplied plugin", () => {
  it("starts a plugin whose files match its pack", async () => {
    await writePack();
    await expect(start("custom")).rejects.toThrow("spawn reached");
  });

  it("refuses a plugin that was never packed", async () => {
    await fs.writeFile(path.join(pluginDir, "index.js"), "module.exports = {};");
    await expect(start("custom")).rejects.toThrow(/hay plugin pack/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("refuses a plugin whose files changed since it was installed", async () => {
    await writePack();
    await fs.writeFile(path.join(pluginDir, "index.js"), "require('child_process');");
    await expect(start("custom")).rejects.toThrow(/does not match its checksum/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("refuses a plugin with a file the pack does not list", async () => {
    await writePack();
    await fs.writeFile(path.join(pluginDir, "extra.js"), "");
    await expect(start("custom")).rejects.toThrow(/not listed/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("does not hold core plugins to a pack", async () => {
    await fs.writeFile(path.join(pluginDir, "index.js"), "module.exports = {};");
    await expect(start("core")).rejects.toThrow("spawn reached");
  });
});
