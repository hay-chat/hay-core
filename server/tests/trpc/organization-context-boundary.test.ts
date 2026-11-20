import { describe, it, expect, jest } from "@jest/globals";

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock("@server/services/mfa.service", () => ({
  mfaService: { assertEnrolledIfRequired: jest.fn(async () => undefined) },
}));

import { t } from "@server/trpc/init";
import { isAuthed } from "@server/trpc/middleware/auth";
import { getDatabaseContext } from "@server/database/organization-context";

const router = t.router({
  seen: t.procedure.use(isAuthed).query(() => getDatabaseContext()),
});

describe("authenticated organization boundary", () => {
  it("declares the request's organization to database work without opening a transaction", async () => {
    const ctx = { user: { id: "u1" }, organizationId: "org-1", req: { headers: {} } } as never;
    await expect(t.createCallerFactory(router)(ctx).seen()).resolves.toEqual({
      kind: "organization",
      organizationId: "org-1",
    });
    expect(getDatabaseContext()).toBeUndefined();
  });
});
