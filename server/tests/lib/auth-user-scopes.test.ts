import { describe, it, expect } from "@jest/globals";
import { AuthUser } from "@server/lib/auth/AuthUser";
import { User } from "@server/entities/user.entity";
import { UserOrganization } from "@server/entities/user-organization.entity";
import { requireAdmin } from "@server/lib/auth/middleware";

const legacyOwner = () =>
  Object.assign(new User(), { id: "u1", email: "o@x.test", isActive: true, role: "owner" });

describe("AuthUser scopes", () => {
  it("has no scopes without an organization membership, whatever the legacy user role", () => {
    const user = new AuthUser(legacyOwner(), "jwt");
    expect(user.hasScope("*", "*")).toBe(false);
    expect(user.hasScope("conversations", "read")).toBe(false);
    expect(user.getRole()).toBeUndefined();
  });

  it("uses the membership role in the current organization", () => {
    const userOrganization = Object.assign(new UserOrganization(), {
      role: "viewer",
      isActive: true,
    });
    const user = new AuthUser(legacyOwner(), "jwt", { organizationId: "o1", userOrganization });
    expect(user.hasScope("conversations", "read")).toBe(true);
    expect(user.hasScope("*", "*")).toBe(false);
    expect(user.getRole()).toBe("viewer");
  });

  it("lets an API token write scope create and update, nothing more", () => {
    const user = new AuthUser(legacyOwner(), "apikey", {
      scopes: [{ resource: "customers", actions: ["write"] }],
    });
    expect(user.hasScope("customers", "create")).toBe(true);
    expect(user.hasScope("customers", "update")).toBe(true);
    expect(user.hasScope("customers", "delete")).toBe(false);
    expect(user.hasScope("conversations", "create")).toBe(false);
  });

  it("keeps full-access API tokens away from identity administration", () => {
    const token = new AuthUser(legacyOwner(), "apikey", {
      scopes: [{ resource: "*", actions: ["*"] }],
    });
    expect(token.hasScope("customers", "delete")).toBe(true);
    for (const resource of ["organization_members", "organization_invitations", "api_keys"]) {
      expect(token.hasScope(resource, "read")).toBe(false);
      expect(token.hasScope(resource, "manage")).toBe(false);
    }
    expect(token.hasScope("organizations", "delete")).toBe(false);
  });

  it("requires a signed-in owner or admin for admin endpoints", () => {
    const member = (role: string) =>
      new AuthUser(legacyOwner(), "jwt", {
        organizationId: "o1",
        userOrganization: Object.assign(new UserOrganization(), { role, isActive: true }),
      });
    expect(() => requireAdmin(member("owner"))).not.toThrow();
    expect(() => requireAdmin(member("admin"))).not.toThrow();
    expect(() => requireAdmin(member("agent"))).toThrow("Admin access required");
    expect(() =>
      requireAdmin(
        new AuthUser(legacyOwner(), "apikey", { scopes: [{ resource: "*", actions: ["*"] }] }),
      ),
    ).toThrow("Admin access required");
  });

  it("gives an API token without scopes no access", () => {
    expect(
      new AuthUser(legacyOwner(), "apikey", { scopes: [] }).hasScope("customers", "read"),
    ).toBe(false);
  });
});
