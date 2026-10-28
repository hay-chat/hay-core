import { describe, it, expect, jest } from "@jest/globals";

jest.mock("@server/repositories/webchat-settings.repository", () => ({
  webchatSettingsRepository: {},
}));
jest.mock("@server/repositories/organization.repository", () => ({ organizationRepository: {} }));
jest.mock("@server/repositories/agent.repository", () => ({ agentRepository: {} }));
jest.mock("@server/services/storage.service", () => ({ storageService: {} }));
jest.mock("@server/database/data-source", () => ({ AppDataSource: { isInitialized: false } }));

import { matchesAllowedDomains } from "@server/services/webchat/webchat-settings.service";

describe("matchesAllowedDomains", () => {
  it("* allows every host, and requests with no host", () => {
    expect(matchesAllowedDomains(["*"], "anything.test")).toBe(true);
    expect(matchesAllowedDomains(["shop.com", "*"], null)).toBe(true);
  });

  it("an exact entry matches only that host", () => {
    expect(matchesAllowedDomains(["shop.com"], "shop.com")).toBe(true);
    expect(matchesAllowedDomains(["shop.com"], "www.shop.com")).toBe(false);
    expect(matchesAllowedDomains(["shop.com"], "evilshop.com")).toBe(false);
  });

  it("*.example.com matches subdomains but not look-alike domains", () => {
    expect(matchesAllowedDomains(["*.example.com"], "app.example.com")).toBe(true);
    expect(matchesAllowedDomains(["*.example.com"], "a.b.example.com")).toBe(true);
    expect(matchesAllowedDomains(["*.example.com"], "evilexample.com")).toBe(false);
    expect(matchesAllowedDomains(["*.example.com"], "example.com.evil.io")).toBe(false);
  });

  it("normalizes entries typed as URLs, with ports, case or trailing dots", () => {
    expect(matchesAllowedDomains(["https://Shop.com/"], "shop.com")).toBe(true);
    expect(matchesAllowedDomains(["shop.com:443"], "shop.com")).toBe(true);
    expect(matchesAllowedDomains([" shop.com. "], "SHOP.com")).toBe(true);
  });

  it("a restricted list rejects requests with no host", () => {
    expect(matchesAllowedDomains(["shop.com"], null)).toBe(false);
    expect(matchesAllowedDomains([], "shop.com")).toBe(false);
  });
});
