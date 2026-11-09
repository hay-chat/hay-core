import { TRPCError } from "@trpc/server";
import { withLogContext } from "@server/lib/logger";
import { metrics } from "@server/lib/metrics";
import { redisService } from "@server/services/redis.service";
import { RateLimitService } from "@server/services/rate-limit.service";
import { auditLogService } from "@server/services/audit-log.service";
import { Repository } from "typeorm";
import { claimWebhookDelivery } from "@server/lib/webhook-replay";
import { t } from "@server/trpc/init";

describe("observability counters", () => {
  afterEach(() => jest.restoreAllMocks());

  function redisDown(): void {
    jest.spyOn(redisService, "isConnected").mockReturnValue(false);
    jest.spyOn(redisService, "initialize").mockResolvedValue(undefined);
    jest.spyOn(redisService, "waitUntilReady").mockResolvedValue(undefined);
  }

  it("counts rate-limit checks that fall back to per-process counting", async () => {
    redisDown();
    const labels = { surface: "rate_limit", action: "per_process" };
    const before = metrics.redisUnavailable.value(labels);

    await new RateLimitService().checkKeyRateLimit("metric-test", 5, 60);

    expect(metrics.redisUnavailable.value(labels)).toBe(before + 1);
  });

  it("counts rate-limit checks rejected while Redis is down", async () => {
    redisDown();
    const labels = { surface: "rate_limit", action: "rejected" };
    const before = metrics.redisUnavailable.value(labels);

    await expect(
      new RateLimitService().checkKeyRateLimit("metric-test", 5, 60, true),
    ).rejects.toThrow();

    expect(metrics.redisUnavailable.value(labels)).toBe(before + 1);
  });

  it("counts webhook deliveries refused while Redis is down", async () => {
    redisDown();
    const labels = { surface: "webhook_replay", action: "rejected" };
    const before = metrics.redisUnavailable.value(labels);

    await expect(claimWebhookDelivery("test", "delivery-1")).rejects.toThrow();

    expect(metrics.redisUnavailable.value(labels)).toBe(before + 1);
  });

  it("counts audit entries that fail to save", async () => {
    jest.spyOn(Repository.prototype, "save").mockRejectedValue(new Error("db down"));
    const before = metrics.auditWriteFailures.value();

    await auditLogService.record({
      organizationId: "00000000-0000-0000-0000-000000000000",
      action: "profile.update",
      resource: "user",
    });

    expect(metrics.auditWriteFailures.value()).toBe(before + 1);
  });

  it("puts the request id in tRPC error payloads", () => {
    const format = t._config.errorFormatter as (opts: unknown) => { data: { requestId?: string } };
    const shape = withLogContext({ requestId: "req-42" }, () =>
      format({
        shape: { message: "x", code: -32603, data: {} },
        error: new TRPCError({ code: "INTERNAL_SERVER_ERROR" }),
        type: "query",
        path: "x",
        input: undefined,
        ctx: undefined,
      }),
    );

    expect(shape.data.requestId).toBe("req-42");
  });
});
