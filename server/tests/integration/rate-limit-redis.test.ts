import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { randomUUID } from "crypto";
import { redisService } from "@server/services/redis.service";
import { RateLimitService, rateLimitKey } from "@server/services/rate-limit.service";

describe("rate limit counters on real Redis", () => {
  const service = new RateLimitService();
  const concurrentKey = randomUUID();

  beforeAll(async () => {
    await redisService.initialize();
    await redisService.waitUntilReady(5000);
  });

  afterAll(async () => {
    await redisService.shutdown();
  });

  it("allows exactly the limit under concurrent requests", async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () => service.checkKeyRateLimit(concurrentKey, 10, 60)),
    );
    expect(results.filter((r) => !r.limited)).toHaveLength(10);
  });

  it("always leaves an expiry on the key, including one that had none", async () => {
    const client = redisService.getClient()!;
    const id = randomUUID();
    const key = rateLimitKey("key", id);

    await service.checkKeyRateLimit(id, 5, 60);
    expect(await client.ttl(key)).toBeGreaterThan(0);

    await client.persist(key);
    await client.set(key, "5");
    const result = await service.checkKeyRateLimit(id, 5, 60);
    expect(result.limited).toBe(true);
    expect(await client.ttl(key)).toBeGreaterThan(0);
    await client.del(key);
  });

  it("does not count refused requests and reports the real reset time", async () => {
    const id = randomUUID();
    await service.checkKeyRateLimit(id, 1, 30);
    const refused = await service.checkKeyRateLimit(id, 1, 30);

    expect(refused.limited).toBe(true);
    expect(refused.remaining).toBe(0);
    expect(refused.resetAt.getTime()).toBeLessThanOrEqual(Date.now() + 30_000);
    expect(await redisService.getClient()!.get(rateLimitKey("key", id))).toBe("1");
  });

  it("a login attempt limit is untouched by password reset requests", async () => {
    const email = `${randomUUID()}@example.com`;
    for (let i = 0; i < 5; i++) {
      await service.checkEmailRateLimit(email, 5, 60, { scope: "password-reset" });
    }
    const login = await service.checkEmailRateLimit(email, 5, 60, { scope: "login" });
    expect(login.limited).toBe(false);
    expect(login.remaining).toBe(4);
  });
});
