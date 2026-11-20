/**
 * A worker is replaced before its plugin API token (not renewed) expires.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock("@server/repositories/plugin-registry.repository", () => ({
  pluginRegistryRepository: {},
}));
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: {},
}));
const workers: unknown[] = [];
jest.mock("../../services/plugin-runner.service", () => ({
  getPluginRunnerService: () => ({ getAllWorkers: () => workers }),
}));

import { pluginManagerService } from "@server/services/plugin-manager.service";
import { TOKEN_LIFETIME_SECONDS } from "@server/lib/plugin-api-token";

const HOUR = 3_600_000;
const worker = (pluginId: string, startedHoursAgo: number, idleMinutes: number) => ({
  organizationId: "org",
  pluginId,
  startedAt: new Date(Date.now() - startedHoursAgo * HOUR),
  lastActivity: new Date(Date.now() - idleMinutes * 60_000),
});

describe("cleanupInactiveWorkers", () => {
  const stop = jest.spyOn(pluginManagerService, "stopPluginWorker").mockResolvedValue(undefined);
  beforeEach(() => {
    stop.mockReset();
    stop.mockResolvedValue(undefined);
    workers.length = 0;
  });
  const stopped = () => stop.mock.calls.map((call) => call[1]).sort();
  const seconds = (n: number) => n / 60;

  it("recycles an old worker once it is idle, not while it is serving a request", async () => {
    const limitHours = TOKEN_LIFETIME_SECONDS / 3600 / 2;
    workers.push(
      worker("old-idle", limitHours + 0.5, seconds(10)),
      worker("old-busy", limitHours + 0.5, 0),
      worker("young-busy", limitHours - 1, 0),
      worker("young-idle", 1, 10),
    );

    await pluginManagerService.cleanupInactiveWorkers();

    expect(stopped()).toEqual(["old-idle", "young-idle"]);
  });

  it("recycles a worker that is never idle once it passes the hard age cap", async () => {
    workers.push(worker("capped", 21, 0), worker("under-cap", 19, 0));

    await pluginManagerService.cleanupInactiveWorkers();

    expect(stopped()).toEqual(["capped"]);
  });

  it("keeps stopping the remaining workers when one stop fails", async () => {
    workers.push(worker("first", 1, 10), worker("second", 1, 10));
    stop.mockRejectedValueOnce(new Error("stop failed"));

    await pluginManagerService.cleanupInactiveWorkers();

    expect(stopped()).toEqual(["first", "second"]);
  });
});
