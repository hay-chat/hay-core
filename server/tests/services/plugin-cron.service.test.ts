/**
 * Plugin crons declared without a retryPolicy (e.g. Shopify and Stripe
 * `sync_disputes`) must still register: the scheduler rejects maxRetries < 1.
 */
jest.mock("../../services/plugin-runner.service", () => ({ getPluginRunnerService: jest.fn() }));
jest.mock("@server/lib/worker-client", () => ({ workerFetch: jest.fn() }));
jest.mock("../../lib/config-resolver", () => ({ resolveConfigForWorker: jest.fn() }));
jest.mock("../../repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: {
    findByOrgAndPlugin: jest.fn(),
    findAll: jest.fn(),
    updateAuthState: jest.fn(),
  },
}));
jest.mock("../../services/scheduler.service", () => ({
  schedulerService: { registerJob: jest.fn(), unregisterJob: jest.fn() },
}));

import { PluginCronService } from "../../services/plugin-cron.service";
import { schedulerService } from "../../services/scheduler.service";
import { pluginInstanceRepository } from "../../repositories/plugin-instance.repository";
import { getPluginRunnerService } from "../../services/plugin-runner.service";
import { workerFetch } from "@server/lib/worker-client";

describe("PluginCronService.registerForInstance", () => {
  it("registers a cron without a retryPolicy and leaves maxRetries out", async () => {
    (pluginInstanceRepository.findByOrgAndPlugin as jest.Mock).mockResolvedValue({
      plugin: {
        metadata: {
          crons: [
            { name: "sync_disputes", schedule: "0 * * * *" },
            { name: "refresh", schedule: "0 */20 * * *", retryPolicy: { maxRetries: 3 } },
          ],
        },
      },
    });

    await new PluginCronService().registerForInstance("org-1", "shopify");

    const calls = (schedulerService.registerJob as jest.Mock).mock.calls.map(([c]) => c);
    expect(calls).toHaveLength(2);
    expect(calls[0]).not.toHaveProperty("maxRetries");
    expect(calls[0].retryOnFailure).toBe(false);
    expect(calls[1]).toMatchObject({ maxRetries: 3, retryOnFailure: true });
  });
});

describe("PluginCronService.reconcile", () => {
  const registerJob = schedulerService.registerJob as jest.Mock;
  const unregisterJob = schedulerService.unregisterJob as jest.Mock;
  const instance = (schedule: string) => ({
    organizationId: "org-1",
    plugin: { pluginId: "shopify", metadata: { crons: [{ name: "refresh", schedule }] } },
  });
  const serve = (instances: unknown[]) => {
    (pluginInstanceRepository.findAll as jest.Mock).mockResolvedValue(instances);
    (pluginInstanceRepository.findByOrgAndPlugin as jest.Mock).mockResolvedValue(instances[0]);
  };

  beforeEach(() => jest.clearAllMocks());

  it("picks up an instance enabled elsewhere, once", async () => {
    const service = new PluginCronService();
    serve([instance("0 * * * *")]);

    await service.reconcile();
    await service.reconcile();

    expect(registerJob).toHaveBeenCalledTimes(1);
    expect(unregisterJob).not.toHaveBeenCalled();
  });

  it("re-registers when the declared schedule changes", async () => {
    const service = new PluginCronService();
    serve([instance("0 * * * *")]);
    await service.reconcile();

    serve([instance("*/5 * * * *")]);
    await service.reconcile();

    expect(registerJob).toHaveBeenCalledTimes(2);
    expect(registerJob.mock.calls[1][0]).toMatchObject({ schedule: "*/5 * * * *" });
    expect(unregisterJob).toHaveBeenCalledTimes(1);
  });

  it("removes the job of an instance disabled elsewhere", async () => {
    const service = new PluginCronService();
    serve([instance("0 * * * *")]);
    await service.reconcile();

    serve([]);
    await service.reconcile();

    expect(unregisterJob).toHaveBeenCalledWith("plugin-cron:shopify:org-1:refresh");
  });
});

describe("PluginCronService credential updates", () => {
  it("keeps the stored refresh token when a cron stages new credentials", async () => {
    (pluginInstanceRepository.findByOrgAndPlugin as jest.Mock).mockResolvedValue({
      id: "inst-1",
      enabled: true,
      plugin: { metadata: { configSchema: {} } },
      authState: {
        methodId: "oauth",
        credentials: { accessToken: "old", refreshToken: "refresh-1", connectedAt: 5 },
      },
    });
    (getPluginRunnerService as jest.Mock).mockReturnValue({
      getWorker: () => ({ port: 4000 }),
      stopWorker: jest.fn(),
      startWorker: jest.fn(),
    });
    (workerFetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        credentialsUpdated: { methodId: "oauth", credentials: { accessToken: "new" } },
      }),
    });

    await (
      new PluginCronService() as unknown as {
        runCron(org: string, plugin: string, cron: string, signal: AbortSignal): Promise<void>;
      }
    ).runCron("org-1", "shopify", "refresh", new AbortController().signal);

    expect(pluginInstanceRepository.updateAuthState).toHaveBeenCalledWith("inst-1", "org-1", {
      methodId: "oauth",
      credentials: { accessToken: "new", refreshToken: "refresh-1", connectedAt: 5 },
    });
  });
});
