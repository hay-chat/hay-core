import { describe, it, expect, jest, beforeEach } from "@jest/globals";

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

/** The small part of Redis the service uses, shared by every service instance. */
const store = new Map<string, string>();
const fakeRedis = {
  set: jest.fn(async (key: string, value: string, ...flags: unknown[]) => {
    if (flags.includes("NX") && store.has(key)) return null;
    store.set(key, value);
    return "OK";
  }),
  eval: jest.fn(async (_script: string, _keys: number, key: string, ...args: unknown[]) => {
    if (store.get(key) !== args[0]) return 0;
    store.set(key, String(args[1]));
    return 1;
  }),
};
const mockIsConnected = jest.fn(() => true);
jest.mock("@server/services/redis.service", () => ({
  redisService: { isConnected: () => mockIsConnected(), getClient: () => fakeRedis },
}));

import { DPoPCacheService } from "@server/services/dpop-cache.service";

describe("DPoPCacheService", () => {
  beforeEach(() => {
    store.clear();
    jest.clearAllMocks();
    mockIsConnected.mockReturnValue(true);
  });

  it("accepts a jti once across instances", async () => {
    expect(await new DPoPCacheService().checkAndStoreJTI("a")).toBe(true);
    expect(await new DPoPCacheService().checkAndStoreJTI("a")).toBe(false);
    expect(fakeRedis.set).toHaveBeenCalledWith("dpop:jti:a", "1", "EX", 600, "NX");
  });

  it("rotates a nonce issued by another instance and refuses the old one", async () => {
    const nonce = await new DPoPCacheService().generateNonce("conv");
    const other = new DPoPCacheService();

    const rotated = await other.verifyAndRotateNonce("conv", nonce);

    expect(rotated).toEqual(expect.any(String));
    expect(await other.verifyAndRotateNonce("conv", nonce)).toBeNull();
    expect(await new DPoPCacheService().verifyAndRotateNonce("conv", rotated!)).toEqual(
      expect.any(String),
    );
  });

  it("uses this instance's memory while Redis is disconnected", async () => {
    mockIsConnected.mockReturnValue(false);
    const service = new DPoPCacheService();

    expect(await service.checkAndStoreJTI("a")).toBe(true);
    expect(await service.checkAndStoreJTI("a")).toBe(false);
    const nonce = await service.generateNonce("conv");
    expect(await service.verifyAndRotateNonce("conv", nonce)).toEqual(expect.any(String));
    expect(await service.verifyAndRotateNonce("conv", nonce)).toBeNull();
    expect(fakeRedis.set).not.toHaveBeenCalled();
  });

  it("uses this instance's memory when a Redis call fails", async () => {
    fakeRedis.set.mockRejectedValueOnce(new Error("connection lost"));
    expect(await new DPoPCacheService().checkAndStoreJTI("b")).toBe(true);
  });
});
