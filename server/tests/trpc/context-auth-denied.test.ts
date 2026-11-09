import { describe, it, expect, jest } from "@jest/globals";
import { TRPCError } from "@trpc/server";

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const mockAuthenticate = jest.fn<() => Promise<unknown>>();
jest.mock("@server/lib/auth/middleware", () => ({ authenticate: mockAuthenticate }));

import { t } from "@server/trpc/init";
import { createContext } from "@server/trpc/context";
import { isAuthed } from "@server/trpc/middleware/auth";

const router = t.router({
  ping: t.procedure.use(isAuthed).query(() => "pong"),
});

const contextFor = () =>
  createContext({
    req: { headers: {}, socket: {} },
    res: {},
  } as never);

describe("createContext", () => {
  it("reports a wrong-organization denial as FORBIDDEN, not as signed out", async () => {
    mockAuthenticate.mockRejectedValue(
      new TRPCError({
        code: "FORBIDDEN",
        message: "User does not belong to the specified organization",
      }),
    );
    const ctx = await contextFor();

    expect(ctx.user).toBeNull();
    await expect(router.createCaller(ctx).ping()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps other authentication failures as UNAUTHORIZED", async () => {
    mockAuthenticate.mockRejectedValue(new Error("Invalid API key"));
    const ctx = await contextFor();

    await expect(router.createCaller(ctx).ping()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
