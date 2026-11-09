import { describe, expect, it } from "vitest";
import { hasRouteAccess } from "./route-access";

describe("hasRouteAccess", () => {
  it.each([
    ["/settings/usage", "member", false],
    ["/settings/usage", "admin", true],
    ["/setup", "agent", false],
    ["/setup", "owner", true],
    ["/channels", "contributor", false],
    ["/insights", "agent", false],
    ["/insights", "viewer", true],
    ["/playbooks/new", "member", false],
    ["/documents/import", "viewer", false],
  ])("%s for %s: %s", (path, role, allowed) => {
    expect(hasRouteAccess(path, role)).toBe(allowed);
  });

  it("covers routes nested under a protected route", () => {
    expect(hasRouteAccess("/integrations/plugins/hay-plugin-x", "member")).toBe(false);
    expect(hasRouteAccess("/settings/users/", "member")).toBe(false);
  });

  it("does not treat a shared prefix as nesting", () => {
    expect(hasRouteAccess("/plugins-guide", "member")).toBe(true);
  });

  it("leaves unlisted routes open and refuses when the role is unknown", () => {
    expect(hasRouteAccess("/conversations", "viewer")).toBe(true);
    expect(hasRouteAccess("/conversations", undefined)).toBe(false);
  });
});
