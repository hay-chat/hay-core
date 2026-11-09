import { describe, expect, it } from "vitest";
import { SETTINGS_NAV, visibleSettingsTabs } from "@/composables/useSettingsNav";
import { roleProtectedRoutes } from "@/utils/route-access";

const workspace = SETTINGS_NAV.find((section) => section.id === "workspace")!;
const paths = (isAdmin: boolean, isOwner: boolean) =>
  visibleSettingsTabs(workspace, isAdmin, isOwner).map((tab) => tab.path);

describe("single sign-on settings", () => {
  it("shows the tab to owners only", () => {
    expect(paths(true, true)).toContain("/settings/sso");
    expect(paths(true, false)).not.toContain("/settings/sso");
    expect(paths(false, false)).not.toContain("/settings/sso");
  });

  it("keeps the page itself closed to everyone but owners", () => {
    expect(roleProtectedRoutes["/settings/sso"]).toEqual(["owner"]);
  });
});
