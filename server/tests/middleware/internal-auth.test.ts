import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Shared-secret auth for the operator-only `internal.*` procedures.
 */

const mockConfig = {
  internal: {
    apiSecret: "",
    previousApiSecret: "",
    requireSignature: false,
    allowedIps: [] as string[],
  },
};
jest.mock("@server/config/env", () => ({ config: mockConfig }));

const mockRecord = jest.fn<(entry: Record<string, unknown>) => Promise<void>>();
jest.mock("@server/services/audit-log.service", () => ({
  auditLogService: { record: mockRecord },
}));
const mockIpLimit = jest.fn<() => Promise<{ limited: boolean }>>();
const spentKeys = new Set<string>();
jest.mock("@server/services/rate-limit.service", () => ({
  rateLimitService: {
    checkIpRateLimit: mockIpLimit,
    checkKeyRateLimit: async (key: string) => {
      const limited = spentKeys.has(key);
      spentKeys.add(key);
      return { limited };
    },
  },
}));

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

import { t } from "@server/trpc/init";
import {
  INTERNAL_SECRET_HEADER,
  INTERNAL_SIGNATURE_HEADER,
  INTERNAL_TIMESTAMP_HEADER,
  internalProcedure,
  isValidInternalSecret,
  signInternalRequest,
} from "@server/trpc/middleware/internal";
import type { Context } from "@server/trpc/context";

const testRouter = t.router({ ping: internalProcedure.query(() => "ok") });

const contextWithSecret = (secret?: string): Context =>
  ({
    user: null,
    organizationId: null,
    req: { headers: secret === undefined ? {} : { [INTERNAL_SECRET_HEADER]: secret } },
    res: {},
    ipAddress: "127.0.0.1",
  }) as unknown as Context;

describe("isValidInternalSecret", () => {
  it("rejects when no secret is configured", () => {
    expect(isValidInternalSecret("anything", "")).toBe(false);
  });

  it("rejects missing, empty, non-string and wrong secrets without throwing", () => {
    expect(isValidInternalSecret(undefined, "s3cret")).toBe(false);
    expect(isValidInternalSecret("", "s3cret")).toBe(false);
    expect(isValidInternalSecret(["s3cret"], "s3cret")).toBe(false);
    expect(isValidInternalSecret("wrong", "s3cret")).toBe(false);
    expect(isValidInternalSecret("much-longer-than-the-real-one", "s3cret")).toBe(false);
  });

  it("accepts the configured secret", () => {
    expect(isValidInternalSecret("s3cret", "s3cret")).toBe(true);
  });
});

describe("internalProcedure", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    spentKeys.clear();
    mockIpLimit.mockResolvedValue({ limited: false });
    Object.assign(mockConfig.internal, {
      apiSecret: "",
      previousApiSecret: "",
      requireSignature: false,
      allowedIps: [],
    });
  });

  const URL_PATH = "/v1/internal.ping";
  const BODY = '{"a":1}';
  const signedContext = (
    secret: string,
    {
      timestamp = String(Math.floor(Date.now() / 1000)),
      body = BODY,
      signedBody = body,
    }: { timestamp?: string; body?: string; signedBody?: string } = {},
  ): Context =>
    ({
      user: null,
      organizationId: null,
      req: {
        headers: {
          [INTERNAL_TIMESTAMP_HEADER]: timestamp,
          [INTERNAL_SIGNATURE_HEADER]: signInternalRequest(secret, timestamp, URL_PATH, signedBody),
        },
        rawBody: body,
        originalUrl: URL_PATH,
      },
      res: {},
      ipAddress: "127.0.0.1",
    }) as unknown as Context;
  const ping = (ctx: Context) => testRouter.createCaller(ctx).ping();

  describe("signed requests", () => {
    beforeEach(() => {
      mockConfig.internal.apiSecret = "s3cret";
    });

    it("accepts a signed request without the secret header", async () => {
      await expect(ping(signedContext("s3cret"))).resolves.toBe("ok");
    });

    it("refuses a signature used twice", async () => {
      const ctx = signedContext("s3cret");
      await ping(ctx);
      await expect(ping(ctx)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("refuses a changed body, a stale timestamp and the wrong key", async () => {
      const stale = String(Math.floor(Date.now() / 1000) - 3600);
      for (const ctx of [
        signedContext("s3cret", { signedBody: '{"a":2}' }),
        signedContext("s3cret", { timestamp: stale }),
        signedContext("other"),
      ]) {
        await expect(ping(ctx)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      }
    });

    it("only accepts signatures once signing is required", async () => {
      mockConfig.internal.requireSignature = true;
      await expect(ping(contextWithSecret("s3cret"))).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      await expect(ping(signedContext("s3cret"))).resolves.toBe("ok");
    });
  });

  it("accepts the previous secret during a rotation", async () => {
    mockConfig.internal.apiSecret = "new-secret";
    mockConfig.internal.previousApiSecret = "old-secret";
    await expect(ping(contextWithSecret("old-secret"))).resolves.toBe("ok");
    await expect(ping(signedContext("old-secret"))).resolves.toBe("ok");
  });

  it("refuses addresses outside a configured allowlist", async () => {
    mockConfig.internal.apiSecret = "s3cret";
    mockConfig.internal.allowedIps = ["10.1.1.1"];
    await expect(ping(contextWithSecret("s3cret"))).rejects.toMatchObject({ code: "FORBIDDEN" });

    mockConfig.internal.allowedIps = ["127.0.0.1"];
    await expect(ping(contextWithSecret("s3cret"))).resolves.toBe("ok");
  });

  it("rate limits by address", async () => {
    mockConfig.internal.apiSecret = "s3cret";
    mockIpLimit.mockResolvedValue({ limited: true });
    await expect(ping(contextWithSecret("s3cret"))).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
  });

  it("audits each accepted call", async () => {
    mockConfig.internal.apiSecret = "s3cret";
    await ping(contextWithSecret("s3cret"));
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "internal.call",
        changes: expect.objectContaining({ procedure: "ping", ok: true }),
      }),
    );
  });

  it("is disabled (FORBIDDEN) when INTERNAL_API_SECRET is empty", async () => {
    const caller = testRouter.createCaller(contextWithSecret("whatever"));
    await expect(caller.ping()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a wrong or missing header with UNAUTHORIZED", async () => {
    mockConfig.internal.apiSecret = "s3cret";
    await expect(testRouter.createCaller(contextWithSecret()).ping()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(testRouter.createCaller(contextWithSecret("nope")).ping()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("lets a correct secret through", async () => {
    mockConfig.internal.apiSecret = "s3cret";
    await expect(testRouter.createCaller(contextWithSecret("s3cret")).ping()).resolves.toBe("ok");
  });
});
