import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockState = { connected: false };
const mockEval = jest.fn<(...args: unknown[]) => Promise<[number, number, number]>>();
const mockDel = jest.fn<(key: string) => Promise<number>>();

jest.mock("@server/services/redis.service", () => ({
  redisService: {
    initialize: async () => undefined,
    waitUntilReady: async () => undefined,
    isConnected: () => mockState.connected,
    getClient: () => ({ eval: mockEval, del: mockDel }),
  },
}));

import {
  RateLimitService,
  RateLimitUnavailableError,
  rateLimitKey,
} from "@server/services/rate-limit.service";

describe("RateLimitService", () => {
  let service: RateLimitService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockState.connected = false;
    service = new RateLimitService();
  });

  describe("while Redis is unavailable", () => {
    it("rejects fail-closed limits with SERVICE_UNAVAILABLE and never touches the client", async () => {
      await expect(service.checkKeyRateLimit("k", 5, 60, true)).rejects.toBeInstanceOf(
        RateLimitUnavailableError,
      );
      await expect(service.checkKeyRateLimit("k", 5, 60, true)).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
      });
      expect(mockEval).not.toHaveBeenCalled();
    });

    it("still enforces other limits per process", async () => {
      const results = [];
      for (let i = 0; i < 3; i++) {
        results.push((await service.checkKeyRateLimit("k", 2, 60)).limited);
      }
      expect(results).toEqual([false, false, true]);
    });

    it("keeps the per-process counters separate by key", async () => {
      await service.checkKeyRateLimit("a", 1, 60);
      expect((await service.checkKeyRateLimit("a", 1, 60)).limited).toBe(true);
      expect((await service.checkKeyRateLimit("b", 1, 60)).limited).toBe(false);
    });
  });

  it("falls back the same way when a Redis command fails", async () => {
    mockState.connected = true;
    mockEval.mockRejectedValue(new Error("boom"));

    await expect(service.checkKeyRateLimit("k", 5, 60, true)).rejects.toBeInstanceOf(
      RateLimitUnavailableError,
    );
    await expect(service.checkKeyRateLimit("k", 5, 60)).resolves.toMatchObject({ limited: false });
  });

  it("keeps each flow's per-email and per-IP counters apart", async () => {
    mockState.connected = true;
    mockEval.mockResolvedValue([0, 1, 60]);

    await service.checkEmailRateLimit("A@x.io", 5, 60, { scope: "login" });
    await service.checkEmailRateLimit("a@x.io", 5, 60, { scope: "password-reset" });
    await service.checkIpRateLimit("203.0.113.7", 5, 60, { scope: "login" });
    await service.checkIpRateLimit("203.0.113.7", 5, 60, { scope: "privacy-request" });

    const keys = mockEval.mock.calls.map((call) => call[2]);
    expect(new Set(keys).size).toBe(4);
    expect(keys[0]).toBe(rateLimitKey("email:login", "a@x.io"));
  });

  it("resets only the counter of the named flow", async () => {
    mockState.connected = true;
    mockDel.mockResolvedValue(1);

    await service.resetRateLimit("a@x.io", "email", "login");

    expect(mockDel).toHaveBeenCalledTimes(1);
    expect(mockDel).toHaveBeenCalledWith(rateLimitKey("email:login", "a@x.io"));
  });

  it("does not fail the caller when a reset cannot reach Redis", async () => {
    mockState.connected = true;
    mockDel.mockRejectedValue(new Error("boom"));

    await expect(service.resetRateLimit("a@x.io", "email", "login")).resolves.toBeUndefined();
  });
});
