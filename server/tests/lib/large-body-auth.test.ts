import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import type { Request } from "express";

const mockAuthenticate = jest.fn<() => Promise<unknown>>();
jest.mock("@server/lib/auth/middleware", () => ({ authenticate: mockAuthenticate }));
const mockVerify = jest.fn<(token: string) => unknown>();
jest.mock("@server/lib/plugin-api-token", () => ({ verifyPluginApiToken: mockVerify }));

import { mayParseLargeBody } from "@server/lib/large-body-auth";

const request = (headers: Record<string, string>) => ({ headers }) as unknown as Request;
const LARGE = String(5 * 1024 * 1024);

describe("mayParseLargeBody", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockVerify.mockImplementation(() => {
      throw new Error("not a plugin token");
    });
  });

  it("does not check credentials for small bodies", async () => {
    expect(await mayParseLargeBody(request({ "content-length": "100" }))).toBe(true);
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it("refuses large and unknown-length bodies without credentials", async () => {
    expect(await mayParseLargeBody(request({ "content-length": LARGE }))).toBe(false);
    expect(await mayParseLargeBody(request({ "transfer-encoding": "chunked" }))).toBe(false);
  });

  it("refuses invalid credentials", async () => {
    mockAuthenticate.mockRejectedValueOnce(new Error("Invalid token"));
    const headers = { "content-length": LARGE, authorization: "Bearer nope" };
    expect(await mayParseLargeBody(request(headers))).toBe(false);
  });

  it("allows a signed-in user or a plugin token", async () => {
    mockAuthenticate.mockResolvedValueOnce({ id: "u1" });
    const headers = { "content-length": LARGE, authorization: "Bearer jwt" };
    expect(await mayParseLargeBody(request(headers))).toBe(true);

    mockVerify.mockReturnValueOnce({});
    expect(await mayParseLargeBody(request(headers))).toBe(true);
  });
});
