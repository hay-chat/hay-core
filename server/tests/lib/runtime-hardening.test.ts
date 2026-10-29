import { describe, it, expect, jest, beforeEach } from "@jest/globals";

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
const checkKeyRateLimit =
  jest.fn<
    (key: string, max: number, window: number) => Promise<{ limited: boolean; resetAt: Date }>
  >();
jest.mock("@server/services/rate-limit.service", () => ({
  rateLimitService: { checkKeyRateLimit },
  rateLimitKey: jest.requireActual<typeof import("@server/services/rate-limit.service")>(
    "@server/services/rate-limit.service",
  ).rateLimitKey,
}));

import { bodyLimitForPath, DEFAULT_BODY_LIMIT } from "@server/lib/body-limits";
import { httpIpRateLimit } from "@server/lib/http-rate-limit";
import { rateLimitKey } from "@server/services/rate-limit.service";
import { redisRetryDelay } from "@server/services/redis.service";

describe("bodyLimitForPath", () => {
  it("keeps ordinary routes at the 1 MB default", () => {
    expect(bodyLimitForPath("/v1/agents.update")).toBe(DEFAULT_BODY_LIMIT);
    expect(bodyLimitForPath("/v1/webhooks/email-events")).toBe(DEFAULT_BODY_LIMIT);
    expect(bodyLimitForPath("/v1/auth.updateProfile")).toBe(DEFAULT_BODY_LIMIT);
  });

  it("allows file uploads on the routes that carry base64 files", () => {
    expect(bodyLimitForPath("/v1/documents.create")).toBe("50mb");
    expect(bodyLimitForPath("/v1/conversations.uploadAttachment")).toBe("50mb");
    expect(bodyLimitForPath("/v1/organizations.uploadLogo")).toBe("50mb");
    expect(bodyLimitForPath("/v1/plugin-api/send-email")).toBe("50mb");
    // tRPC batch containing an upload procedure
    expect(bodyLimitForPath("/v1/agents.list,documents.update")).toBe("50mb");
  });

  it("gives the public widget and plugin routes intermediate limits", () => {
    expect(bodyLimitForPath("/v1/publicConversations.sendMessage")).toBe("15mb");
    expect(bodyLimitForPath("/plugins/webhooks/hay-plugin/events")).toBe("10mb");
    expect(bodyLimitForPath("/v1/plugins/hay-plugin/action")).toBe("10mb");
  });
});

describe("httpIpRateLimit", () => {
  function run(path: string, method = "POST") {
    const res = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      setHeader(name: string, value: string) {
        this.headers[name] = value;
      },
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json: jest.fn(),
    };
    const next = jest.fn();
    return httpIpRateLimit({ path, method, ip: "203.0.113.7" } as never, res as never, next).then(
      () => ({ res, next }),
    );
  }

  beforeEach(() => {
    checkKeyRateLimit.mockReset();
  });

  it("counts public widget requests per client IP", async () => {
    checkKeyRateLimit.mockResolvedValue({ limited: false, resetAt: new Date() });
    const { next } = await run("/v1/publicConversations.create");
    expect(next).toHaveBeenCalled();
    expect(checkKeyRateLimit.mock.calls[0][0]).toBe("http:public-conversations:ip:203.0.113.7");
  });

  it("answers 429 with Retry-After once the IP is over the limit", async () => {
    checkKeyRateLimit.mockResolvedValue({
      limited: true,
      resetAt: new Date(Date.now() + 30_000),
    });
    const { res, next } = await run("/plugins/webhooks/p/events");
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers["Retry-After"])).toBeGreaterThan(0);
  });

  it("leaves other routes and CORS preflights alone", async () => {
    expect((await run("/v1/agents.list")).next).toHaveBeenCalled();
    expect((await run("/v1/plugins/p/x", "OPTIONS")).next).toHaveBeenCalled();
    expect(checkKeyRateLimit).not.toHaveBeenCalled();
  });
});

describe("rateLimitKey", () => {
  it("never puts the raw identifier in the Redis key", () => {
    const key = rateLimitKey("email", "Jane.Doe@Example.com");
    expect(key).toMatch(/^rate_limit:email:[0-9a-f]{64}$/);
    expect(key).not.toContain("example.com");
    expect(rateLimitKey("email", "jane.doe@example.com")).toBe(key);
  });
});

describe("redisRetryDelay", () => {
  it("keeps retrying with a capped delay instead of giving up", () => {
    expect(redisRetryDelay(1)).toBe(1000);
    expect(redisRetryDelay(11)).toBe(11000);
    expect(redisRetryDelay(500)).toBe(30000);
  });
});
