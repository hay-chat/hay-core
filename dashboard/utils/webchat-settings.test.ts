import { describe, expect, it } from "vitest";
import {
  buildPreviewSrcdoc,
  formatSince,
  normalizeHex,
  parseWebchatTab,
  webchatInstallStatus,
  webchatLandingTab,
  websiteHost,
  websiteUrl,
  type WebchatPreviewConfig,
} from "./webchat-settings";

describe("webchat install status", () => {
  it("is live once seen, not installed before, off when switched off", () => {
    expect(webchatInstallStatus(true, "2026-11-12T10:00:00Z")).toBe("live");
    expect(webchatInstallStatus(true, null)).toBe("notInstalled");
    expect(webchatInstallStatus(false, "2026-11-12T10:00:00Z")).toBe("off");
  });

  it("opens Install until the widget has been seen, Appearance after", () => {
    expect(webchatLandingTab(null)).toBe("install");
    expect(webchatLandingTab("2026-11-12T10:00:00Z")).toBe("appearance");
  });

  it("falls back to Appearance for an unknown tab", () => {
    expect(parseWebchatTab("security")).toBe("security");
    expect(parseWebchatTab("nope")).toBe("appearance");
    expect(parseWebchatTab(undefined)).toBe("appearance");
  });
});

describe("websiteHost / websiteUrl", () => {
  it("reads hosts from urls, origins and bare hosts", () => {
    expect(websiteHost("https://www.acme.com/shop?x=1")).toBe("www.acme.com");
    expect(websiteHost("acme.com")).toBe("acme.com");
    expect(websiteHost("  ")).toBeNull();
    expect(websiteHost(null)).toBeNull();
  });

  it("keeps http for an http origin and defaults to https", () => {
    expect(websiteUrl("http://localhost:5173")).toBe("http://localhost:5173");
    expect(websiteUrl("acme.com")).toBe("https://acme.com");
  });
});

describe("normalizeHex", () => {
  it("accepts six and three digit colours with or without #", () => {
    expect(normalizeHex("#14532D")).toBe("#14532d");
    expect(normalizeHex("14532d")).toBe("#14532d");
    expect(normalizeHex("#1a3")).toBe("#11aa33");
  });

  it("rejects anything else", () => {
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex(undefined)).toBeNull();
  });
});

describe("formatSince", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  it("says how long ago in the given language", () => {
    expect(formatSince("2026-11-12T11:58:00Z", "en", now)).toBe("2 minutes ago");
    expect(formatSince("2026-11-11T12:00:00Z", "en", now)).toBe("yesterday");
    expect(formatSince("2026-11-12T11:59:50Z", "en", now)).toBe("now");
    expect(formatSince("2026-11-12T09:00:00Z", "nl", now)).toBe("3 uur geleden");
  });
});

describe("buildPreviewSrcdoc", () => {
  const config: WebchatPreviewConfig = {
    organizationId: "org-1",
    baseUrl: "https://api.hay.test",
    position: "right",
    brandColor: "#14532d",
    themeMode: "light",
    logoUrl: null,
    homeHeading: null,
    widgetTitle: "Chat",
    greetingMessage: "</script><b>hi",
    showGreeting: true,
    csatEnabled: true,
    csatQuestion: "",
    teaserMessage: "",
    preview: { state: "home", device: "desktop" },
  };

  it("loads the real widget with the config in a data block, not an inline script", () => {
    const html = buildPreviewSrcdoc(config, "#fff");
    expect(html).toContain('src="https://api.hay.test/v1/webchat/widget.js"');
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    // The dashboard CSP blocks inline scripts, and the srcdoc frame inherits it.
    const openings = html.match(/<script\b[^>]*>/gi) ?? [];
    expect(openings).toHaveLength(2);
    for (const tag of openings) {
      expect(tag).toMatch(/\bsrc="|\btype="application\/json"/);
    }

    const block = html.split('<script type="application/json" id="hay-chat-config">')[1];
    expect(JSON.parse(block.split("</" + "script>")[0])).toEqual(config);
  });
});
