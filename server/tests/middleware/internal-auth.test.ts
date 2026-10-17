import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Shared-secret auth for the operator-only `internal.*` procedures.
 */

const mockConfig = { internal: { apiSecret: "" } };
jest.mock("@server/config/env", () => ({ config: mockConfig }));

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

import { t } from "@server/trpc/init";
import {
  INTERNAL_SECRET_HEADER,
  internalProcedure,
  isValidInternalSecret,
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
    mockConfig.internal.apiSecret = "";
    jest.clearAllMocks();
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
