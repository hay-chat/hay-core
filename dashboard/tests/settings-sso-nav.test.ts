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

describe("channels and workspace settings", () => {
  const tabs = (id: string) =>
    visibleSettingsTabs(
      SETTINGS_NAV.find((section) => section.id === id)!,
      true,
      true,
    ).map((tab) => tab.path);

  it("keeps only the channel list under Channels; Webchat has its own page", () => {
    expect(tabs("channels")).toEqual(["/channels"]);
    expect(SETTINGS_NAV.flatMap((s) => s.tabs).map((t) => t.path)).not.toContain(
      "/settings/webchat",
    );
  });

  it("lists business hours under Workspace", () => {
    expect(tabs("workspace")).toContain("/settings/business-hours");
  });
});
