/**
 * Plugin crons declared without a retryPolicy (e.g. Shopify and Stripe
 * `sync_disputes`) must still register: the scheduler rejects maxRetries < 1.
 */
jest.mock("../../services/plugin-runner.service", () => ({ getPluginRunnerService: jest.fn() }));
jest.mock("../../lib/config-resolver", () => ({ resolveConfigForWorker: jest.fn() }));
jest.mock("../../repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: { findByOrgAndPlugin: jest.fn() },
}));
jest.mock("../../services/scheduler.service", () => ({
  schedulerService: { registerJob: jest.fn(), unregisterJob: jest.fn() },
}));

import { PluginCronService } from "../../services/plugin-cron.service";
import { schedulerService } from "../../services/scheduler.service";
import { pluginInstanceRepository } from "../../repositories/plugin-instance.repository";

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
