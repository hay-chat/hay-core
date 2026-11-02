import { describe, it, expect } from "@jest/globals";
import { assertCanGrantMembership } from "@server/lib/auth/membership-grants";
import type { AuthUser } from "@server/lib/auth/AuthUser";

const caller = (role: string, scopes: string[]) =>
  ({
    getRole: () => role,
    hasScope: (resource: string, action: string) =>
      scopes.includes(`${resource}:${action}`) || scopes.includes("*:*"),
  }) as unknown as AuthUser;

describe("assertCanGrantMembership", () => {
  it("lets only owners grant, change or remove the owner role", () => {
    const admin = caller("admin", ["*:*"]);
    expect(() => assertCanGrantMembership(admin, { role: "owner" })).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    expect(() => assertCanGrantMembership(admin, { role: "member", currentRole: "owner" })).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    expect(() =>
      assertCanGrantMembership(admin, { role: "admin", currentRole: "member" }),
    ).not.toThrow();
    expect(() =>
      assertCanGrantMembership(caller("owner", ["*:*"]), { role: "owner" }),
    ).not.toThrow();
  });

  it("refuses permissions the caller does not hold", () => {
    const manager = caller("member", ["organization_members:manage", "documents:read"]);
    expect(() =>
      assertCanGrantMembership(manager, { role: "member", permissions: ["documents:read"] }),
    ).not.toThrow();
    expect(() =>
      assertCanGrantMembership(manager, { role: "member", permissions: ["api_keys:create"] }),
    ).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(() =>
      assertCanGrantMembership(manager, { role: "member", permissions: ["documents:*"] }),
    ).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });

  it("refuses malformed permissions", () => {
    expect(() =>
      assertCanGrantMembership(caller("owner", ["*:*"]), { role: "member", permissions: ["all"] }),
    ).toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
  });
});
