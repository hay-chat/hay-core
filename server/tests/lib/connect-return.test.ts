import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

jest.mock("@server/config/env", () => ({ getDashboardUrl: () => "https://app.hay.example" }));

import { isAllowedConnectReturn } from "../../lib/connect-return";

const saved = { ...process.env };
beforeEach(() => {
  delete process.env.CONNECT_ALLOWED_REDIRECT_ORIGINS;
});
afterEach(() => {
  process.env = { ...saved };
});

describe("connect return_to allowlist", () => {
  const dashboard = () => "https://app.hay.example";

  it("allows the dashboard's own origin on any path", () => {
    const origin = dashboard();
    expect(isAllowedConnectReturn(`${origin}/setup`)).toBe(true);
    expect(isAllowedConnectReturn(`${origin}/setup?plugin=shopify`)).toBe(true);
  });

  it("still allows the listed external origins", () => {
    process.env.CONNECT_ALLOWED_REDIRECT_ORIGINS = "https://billing.example.com, https://x.test";
    expect(isAllowedConnectReturn("https://billing.example.com/return")).toBe(true);
    expect(isAllowedConnectReturn("https://x.test")).toBe(true);
  });

  it("rejects look-alike origins", () => {
    const origin = dashboard();
    const host = new URL(origin).host;
    for (const bad of [
      `${origin}.evil.com/setup`,
      `https://evil.com/?next=${origin}`,
      `https://${host}@evil.com/setup`,
      `https://evil.com#${origin}`,
      `https://${host}.evil.com/setup`,
      `https://evil-${host}/setup`,
      "http://app.hay.example/setup",
      `${origin}:8443/setup`,
      "javascript:alert(1)",
      "//evil.com/setup",
      "/setup",
      "not a url",
      "",
    ]) {
      expect(isAllowedConnectReturn(bad)).toBe(false);
    }
  });

  it("denies everything else by default", () => {
    expect(isAllowedConnectReturn("https://billing.example.com/return")).toBe(false);
  });
});
