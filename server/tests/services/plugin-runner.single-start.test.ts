/**
 * Concurrent callers that reach a cold plugin share one worker start instead
 * of each spawning a worker (each worker re-runs the plugin's startup sync).
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

type Internals = {
  startNewWorker(orgId: string, pluginId: string, workerKey: string): Promise<WorkerInfo>;
};

describe("PluginRunnerService.startWorker", () => {
  it("runs one start for concurrent callers of the same org and plugin", async () => {
    const runner = new PluginRunnerService();
    const worker = { organizationId: "o", pluginId: "p" } as unknown as WorkerInfo;
    let finish!: (w: WorkerInfo) => void;
    const startNewWorker = jest
      .spyOn(runner as unknown as Internals, "startNewWorker")
      .mockImplementation(() => new Promise((resolve) => (finish = resolve)));

    const starts = Array.from({ length: 5 }, () => runner.startWorker("o", "p"));
    finish(worker);

    await expect(Promise.all(starts)).resolves.toEqual(Array(5).fill(worker));
    expect(startNewWorker).toHaveBeenCalledTimes(1);
  });

  it("lets a later start retry after a failed one", async () => {
    const runner = new PluginRunnerService();
    const startNewWorker = jest
      .spyOn(runner as unknown as Internals, "startNewWorker")
      .mockRejectedValueOnce(new Error("spawn failed"))
      .mockResolvedValueOnce({} as WorkerInfo);

    await expect(runner.startWorker("o", "p")).rejects.toThrow("spawn failed");
    await expect(runner.startWorker("o", "p")).resolves.toEqual({});
    expect(startNewWorker).toHaveBeenCalledTimes(2);
  });
});
