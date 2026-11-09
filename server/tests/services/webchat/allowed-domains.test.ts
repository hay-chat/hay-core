import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockGetOrCreate = jest.fn<(orgId: string) => Promise<{ allowedDomains: string[] }>>();
jest.mock("@server/repositories/webchat-settings.repository", () => ({
  webchatSettingsRepository: { getOrCreate: mockGetOrCreate },
}));
jest.mock("@server/repositories/organization.repository", () => ({ organizationRepository: {} }));
jest.mock("@server/services/storage.service", () => ({ storageService: {} }));
const mockResolveWebsite = jest.fn<(orgId: string) => Promise<string | null>>();
jest.mock("@server/services/site-index.service", () => ({
  siteIndexService: { resolveWebsite: mockResolveWebsite },
}));

import {
  domainsForWebsite,
  webchatSettingsService,
} from "@server/services/webchat/webchat-settings.service";

describe("domainsForWebsite", () => {
  it("covers the site and its subdomains", () => {
    expect(domainsForWebsite("https://www.Shop.example.com/about")).toEqual([
      "shop.example.com",
      "*.shop.example.com",
    ]);
    expect(domainsForWebsite("shop.example.com")).toEqual([
      "shop.example.com",
      "*.shop.example.com",
    ]);
  });

  it("is empty without a usable website", () => {
    expect(domainsForWebsite(null)).toEqual([]);
    expect(domainsForWebsite("not a url")).toEqual([]);
  });
});

describe("isDomainAllowed", () => {
  beforeEach(() => jest.clearAllMocks());

  it("an empty list allows only the organization's website", async () => {
    mockGetOrCreate.mockResolvedValue({ allowedDomains: [] });
    mockResolveWebsite.mockResolvedValue("https://shop.example.com");

    expect(await webchatSettingsService.isDomainAllowed("o", "shop.example.com")).toBe(true);
    expect(await webchatSettingsService.isDomainAllowed("o", "evil.test")).toBe(false);
  });

  it("an empty list with no website allows nothing", async () => {
    mockGetOrCreate.mockResolvedValue({ allowedDomains: [] });
    mockResolveWebsite.mockResolvedValue(null);

    expect(await webchatSettingsService.isDomainAllowed("o", "shop.example.com")).toBe(false);
  });

  it("a stored list decides on its own", async () => {
    mockGetOrCreate.mockResolvedValue({ allowedDomains: ["*"] });

    expect(await webchatSettingsService.isDomainAllowed("o", "anything.test")).toBe(true);
    expect(mockResolveWebsite).not.toHaveBeenCalled();
  });
});
