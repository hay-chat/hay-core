// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountSupportWidget, supportWidgetConfig } from "../utils/support-widget";

describe("support widget", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    delete window.HayChat;
  });

  it("is off without an organization id or API address", () => {
    expect(supportWidgetConfig("", "https://api.test")).toBeNull();
    expect(supportWidgetConfig("  ", "https://api.test")).toBeNull();
    expect(supportWidgetConfig("org-1", "")).toBeNull();
    expect(mountSupportWidget("", "https://api.test", vi.fn())).toBe(false);
    expect(document.querySelector("script")).toBeNull();
  });

  it("loads widget.js from the API once and passes the config", () => {
    const onLoad = vi.fn();
    expect(mountSupportWidget("org-1", "https://api.test", onLoad)).toBe(true);
    const script = document.querySelector("script");
    expect(script?.getAttribute("src")).toBe("https://api.test/v1/webchat/widget.js");
    expect(window.HayChat?.config).toMatchObject({
      organizationId: "org-1",
      baseUrl: "https://api.test",
      context: { surface: "hay-dashboard" },
    });
    script?.dispatchEvent(new Event("load"));
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(mountSupportWidget("org-1", "https://api.test", onLoad)).toBe(false);
    expect(document.querySelectorAll("script")).toHaveLength(1);
  });
});
