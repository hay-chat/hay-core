/**
 * Each plugin's worker pool stays within its configured size: starting one
 * more worker stops the least recently active one first.
 */
jest.mock("@server/database/data-source", () => ({ AppDataSource: { getRepository: jest.fn() } }));
jest.mock("@server/services/port-allocator.service", () => ({
  getPortAllocator: () => ({ allocate: jest.fn(), release: jest.fn() }),
}));
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: {},
}));
jest.mock("@server/services/plugin-tools.service", () => ({ fetchAndStoreTools: jest.fn() }));
jest.mock("@server/services/oauth.service", () => ({ oauthService: {} }));

import { PluginRunnerService } from "@server/services/plugin-runner.service";
import type { WorkerInfo } from "@server/types/plugin-sdk.types";

type PoolInternals = {
  workers: Map<string, WorkerInfo>;
  pendingStarts: Set<string>;
  makeRoomInPool(pluginId: string, maxWorkers: number): Promise<void>;
};

function fakeWorker(orgId: string, pluginId: string, lastActivity: number): WorkerInfo {
  return {
    organizationId: orgId,
    pluginId,
    lastActivity: new Date(lastActivity),
  } as unknown as WorkerInfo;
}

describe("PluginRunnerService worker pool", () => {
  let runner: PluginRunnerService;
  let internals: PoolInternals;
  let stopWorker: jest.SpyInstance;

  beforeEach(() => {
    runner = new PluginRunnerService();
    internals = runner as unknown as PoolInternals;
    stopWorker = jest.spyOn(runner, "stopWorker").mockImplementation(async (orgId, pluginId) => {
      internals.workers.delete(`${orgId}:${pluginId}`);
    });
  });

  it("does nothing while the pool has room", async () => {
    internals.workers.set("a:p", fakeWorker("a", "p", 1));
    await internals.makeRoomInPool("p", 2);
    expect(stopWorker).not.toHaveBeenCalled();
  });

  it("stops the least recently active worker of that plugin when full", async () => {
    internals.workers.set("a:p", fakeWorker("a", "p", 300));
    internals.workers.set("b:p", fakeWorker("b", "p", 100));
    internals.workers.set("c:other", fakeWorker("c", "other", 1));

    await internals.makeRoomInPool("p", 2);

    expect(stopWorker).toHaveBeenCalledTimes(1);
    expect(stopWorker).toHaveBeenCalledWith("b", "p");
  });

  it("counts workers that are still starting", async () => {
    internals.workers.set("a:p", fakeWorker("a", "p", 100));
    internals.pendingStarts.add("b:p");

    await internals.makeRoomInPool("p", 2);
    expect(stopWorker).toHaveBeenCalledWith("a", "p");
  });

  it("refuses to start when the pool is full of starting workers", async () => {
    internals.pendingStarts.add("a:p");
    internals.pendingStarts.add("b:p");

    await expect(internals.makeRoomInPool("p", 2)).rejects.toThrow(/pool .* is full/);
    expect(stopWorker).not.toHaveBeenCalled();
  });
});
