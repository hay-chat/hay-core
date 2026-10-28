import { describe, expect, it } from "vitest";
import { needsIosInstall } from "./install-app";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";

describe("needsIosInstall", () => {
  it("asks an iPhone browser tab to add Hay.chat to the Home Screen", () => {
    expect(needsIosInstall({ userAgent: IPHONE_SAFARI })).toBe(true);
  });

  it("stays quiet once opened from the Home Screen", () => {
    expect(needsIosInstall({ userAgent: IPHONE_SAFARI, standalone: true })).toBe(false);
    expect(needsIosInstall({ userAgent: IPHONE_SAFARI, displayStandalone: true })).toBe(false);
  });

  it("recognizes an iPad that reports itself as a Mac", () => {
    expect(
      needsIosInstall({ userAgent: MAC_SAFARI, platform: "MacIntel", maxTouchPoints: 5 }),
    ).toBe(true);
    expect(
      needsIosInstall({ userAgent: MAC_SAFARI, platform: "MacIntel", maxTouchPoints: 0 }),
    ).toBe(false);
  });

  it("ignores Android and desktop browsers", () => {
    expect(needsIosInstall({ userAgent: ANDROID_CHROME, platform: "Linux armv8l" })).toBe(false);
  });
});
