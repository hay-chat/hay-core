import { describe, it, expect } from "@jest/globals";
import { TRPCError } from "@trpc/server";
import { t } from "@server/trpc/init";
import {
  assertOrganizationNotSuspended,
  isSuspensionExempt,
  ORGANIZATION_SUSPENDED_ERROR_TYPE,
} from "@server/trpc/middleware/suspension";

const suspended = {
  suspendedAt: new Date("2026-10-01T00:00:00Z"),
  suspensionReason: "trial_expired" as const,
};
const active = { suspendedAt: null, suspensionReason: null };

describe("isSuspensionExempt", () => {
  it("exempts the procedures the lock page needs", () => {
    for (const path of [
      "auth.me",
      "auth.generateAuthCode",
      "auth.logout",
      "internal.organizations.setAccessState",
      "organizations.switchOrganization",
      "organizations.getSettings",
      "organizations.delete",
      "plugins.getMenuItems",
    ]) {
      expect(isSuspensionExempt(path)).toBe(true);
    }
  });

  it("does not exempt regular org-scoped procedures", () => {
    for (const path of [
      "agents.list",
      "conversations.list",
      "organizations.updateSettings",
      "plugins.list",
    ]) {
      expect(isSuspensionExempt(path)).toBe(false);
    }
  });
});

describe("assertOrganizationNotSuspended", () => {
  it("passes for active organizations and missing context", () => {
    expect(() => assertOrganizationNotSuspended(active, "agents.list")).not.toThrow();
    expect(() => assertOrganizationNotSuspended(undefined, "agents.list")).not.toThrow();
    expect(() => assertOrganizationNotSuspended(null, "agents.list")).not.toThrow();
  });

  it("throws FORBIDDEN with a structured cause for suspended organizations", () => {
    let error: unknown;
    try {
      assertOrganizationNotSuspended(suspended, "agents.list");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(TRPCError);
    const trpcError = error as TRPCError;
    expect(trpcError.code).toBe("FORBIDDEN");
    expect(trpcError.message.toLowerCase()).not.toContain("unauthorized");
    // TRPCError wraps a plain-object cause in an Error but keeps its fields.
    expect(trpcError.cause).toMatchObject({
      type: ORGANIZATION_SUSPENDED_ERROR_TYPE,
      reason: "trial_expired",
    });
  });

  it("lets exempt procedures through while suspended", () => {
    expect(() => assertOrganizationNotSuspended(suspended, "auth.me")).not.toThrow();
    expect(() =>
      assertOrganizationNotSuspended(suspended, "organizations.switchOrganization"),
    ).not.toThrow();
  });
});

describe("errorFormatter", () => {
  it("lifts cause.type and cause.reason into the serialized error data", () => {
    let error: TRPCError | undefined;
    try {
      assertOrganizationNotSuspended(suspended, "agents.list");
    } catch (e) {
      error = e as TRPCError;
    }

    const shape = t._config.errorFormatter({
      error: error!,
      type: "query",
      path: "agents.list",
      input: undefined,
      ctx: undefined,
      shape: {
        message: error!.message,
        code: -32003,
        data: { code: "FORBIDDEN", httpStatus: 403, path: "agents.list" },
      },
    });

    expect(shape.data).toMatchObject({
      code: "FORBIDDEN",
      type: ORGANIZATION_SUSPENDED_ERROR_TYPE,
      reason: "trial_expired",
    });
  });
});
