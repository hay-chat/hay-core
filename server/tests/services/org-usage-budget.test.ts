import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/** Daily AI token budget per organization, counted from the LLM usage sink. */

const mockStore = new Map<string, number>();
let mockConnected = true;
const mockClient = {
  multi() {
    const ops: Array<() => void> = [];
    const chain = {
      incrby(key: string, by: number) {
        ops.push(() => mockStore.set(key, (mockStore.get(key) ?? 0) + by));
        return chain;
      },
      expire: () => chain,
      exec: async () => ops.forEach((op) => op()),
    };
    return chain;
  },
  get: jest.fn(async (key: string) => mockStore.get(key)?.toString() ?? null),
};

jest.mock("@server/services/redis.service", () => ({
  redisService: { getClient: () => mockClient, isConnected: () => mockConnected },
}));
jest.mock("@server/config/env", () => ({
  config: { llm: { orgDailyTokenBudget: 1000 } },
}));
jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ warn: jest.fn() }),
}));

import { config } from "@server/config/env";
import { isOrgOverBudget, recordOrgUsage } from "@server/services/llm/org-usage-budget";
import type { UsageEvent } from "@server/services/llm/usage-sink";

const budgetConfig = config.llm as { orgDailyTokenBudget: number };
const usage = (organizationId: string | undefined, totalTokens: number) =>
  ({
    kind: "chat",
    model: "m",
    provider: "p",
    organizationId,
    usage: { totalTokens },
  }) as UsageEvent;
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("org usage budget", () => {
  beforeEach(() => {
    mockStore.clear();
    mockConnected = true;
    budgetConfig.orgDailyTokenBudget = 1000;
  });

  it("goes over budget once the organization's own usage reaches it", async () => {
    recordOrgUsage(usage("org-1", 999));
    await flush();
    expect(await isOrgOverBudget("org-1")).toBe(false);

    recordOrgUsage(usage("org-1", 1));
    await flush();
    expect(await isOrgOverBudget("org-1")).toBe(true);
    expect(await isOrgOverBudget("org-2")).toBe(false);
  });

  it("ignores events with no organization or no tokens", async () => {
    recordOrgUsage(usage(undefined, 5000));
    recordOrgUsage(usage("org-1", 0));
    await flush();
    expect(mockStore.size).toBe(0);
  });

  it("is off at 0 and lets calls through while Redis is down", async () => {
    recordOrgUsage(usage("org-1", 5000));
    await flush();

    budgetConfig.orgDailyTokenBudget = 0;
    expect(await isOrgOverBudget("org-1")).toBe(false);

    budgetConfig.orgDailyTokenBudget = 1000;
    mockConnected = false;
    expect(await isOrgOverBudget("org-1")).toBe(false);

    mockConnected = true;
    mockClient.get.mockRejectedValueOnce(new Error("down"));
    expect(await isOrgOverBudget("org-1")).toBe(false);
  });
});
