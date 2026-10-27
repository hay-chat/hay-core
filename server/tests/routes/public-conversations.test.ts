import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Public widget API (publicConversations.*): the guards in front of create.
 */

jest.mock("@server/config/env", () => ({
  config: { domain: { dashboard: "app.hay.chat" }, jwt: { secret: "test" } },
}));
const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));
jest.mock("@server/trpc", () => jest.requireActual("@server/trpc/init"));
jest.mock("@server/database/data-source", () => ({ AppDataSource: { isInitialized: false } }));

const mockCreateConversation = jest.fn(async (_orgId: string, _data: unknown) => ({
  id: "conv-1",
  created_at: new Date("2026-10-27T00:00:00Z"),
}));
jest.mock("@server/services/conversation.service", () => ({
  ConversationService: jest.fn(() => ({ createConversation: mockCreateConversation })),
}));
jest.mock("@server/services/dpop-cache.service", () => ({
  dpopCacheService: { generateNonce: jest.fn(async () => "nonce-1") },
}));
jest.mock("@server/repositories/conversation.repository", () => ({
  conversationRepository: { updateById: jest.fn(async () => undefined) },
}));
jest.mock("@server/repositories/customer.repository", () => ({
  CustomerRepository: jest.fn(() => ({ findByExternalId: jest.fn(async () => null) })),
}));

const mockFindOrganization = jest.fn<(id: string) => Promise<unknown>>();
jest.mock("@server/repositories/organization.repository", () => ({
  OrganizationRepository: jest.fn(() => ({ findById: mockFindOrganization })),
  organizationRepository: {},
}));

jest.mock("@server/repositories/webchat-settings.repository", () => ({
  webchatSettingsRepository: {},
}));
jest.mock("@server/repositories/agent.repository", () => ({ agentRepository: {} }));
jest.mock("@server/services/storage.service", () => ({ storageService: {} }));

const mockIsEnabled = jest.fn<(orgId: string) => Promise<boolean>>();
const mockGetSettings = jest.fn<(orgId: string) => Promise<{ allowedDomains: string[] }>>();
jest.mock("@server/services/webchat/webchat-settings.service", () => {
  const actual = jest.requireActual<
    typeof import("@server/services/webchat/webchat-settings.service")
  >("@server/services/webchat/webchat-settings.service");
  return {
    matchesAllowedDomains: actual.matchesAllowedDomains,
    webchatSettingsService: {
      isEnabled: mockIsEnabled,
      isDomainAllowed: async (orgId: string, hostname: string | null) =>
        actual.matchesAllowedDomains((await mockGetSettings(orgId)).allowedDomains, hostname),
    },
  };
});

import { publicConversationsRouter } from "@server/routes/v1/public-conversations";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const createInput = {
  organizationId: ORG_ID,
  publicJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" },
};

function callerFor(headers: Record<string, string> = {}, ipAddress = "203.0.113.7") {
  return publicConversationsRouter.createCaller({
    user: null,
    organizationId: null,
    req: { headers },
    res: {},
    ipAddress,
  } as never);
}

describe("publicConversations.create allowed domains", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOrganization.mockResolvedValue({ id: ORG_ID, suspendedAt: null, settings: {} });
    mockIsEnabled.mockResolvedValue(true);
    mockGetSettings.mockResolvedValue({ allowedDomains: ["shop.example.com", "*.brand.com"] });
  });

  it("creates a conversation from an allowed origin", async () => {
    const result = await callerFor({ origin: "https://shop.example.com" }).create(createInput);
    expect(result).toMatchObject({ id: "conv-1", nonce: "nonce-1" });
  });

  it("accepts a subdomain of a wildcard entry", async () => {
    await expect(
      callerFor({ origin: "https://eu.brand.com" }).create(createInput),
    ).resolves.toMatchObject({ id: "conv-1" });
  });

  it("falls back to Referer when Origin is absent", async () => {
    await expect(
      callerFor({ referer: "https://shop.example.com/products/1" }).create(createInput),
    ).resolves.toMatchObject({ id: "conv-1" });
  });

  it("rejects an origin that is not on the list", async () => {
    await expect(
      callerFor({ origin: "https://evilbrand.com" }).create(createInput),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  it("rejects a request with no Origin or Referer when the list is restricted", async () => {
    await expect(callerFor().create(createInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows any site, and header-less clients, when the list is *", async () => {
    mockGetSettings.mockResolvedValue({ allowedDomains: ["*"] });
    await expect(callerFor().create(createInput)).resolves.toMatchObject({ id: "conv-1" });
  });

  it("always allows the Hay.chat dashboard (widget preview)", async () => {
    await expect(
      callerFor({ origin: "https://app.hay.chat" }).create(createInput),
    ).resolves.toMatchObject({ id: "conv-1" });
  });

  it("rejects unknown, suspended or webchat-disabled organizations", async () => {
    mockFindOrganization.mockResolvedValueOnce(null);
    await expect(callerFor().create(createInput)).rejects.toMatchObject({ code: "FORBIDDEN" });

    mockFindOrganization.mockResolvedValueOnce({ id: ORG_ID, suspendedAt: new Date() });
    await expect(callerFor().create(createInput)).rejects.toMatchObject({ code: "FORBIDDEN" });

    mockIsEnabled.mockResolvedValueOnce(false);
    await expect(callerFor().create(createInput)).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(mockCreateConversation).not.toHaveBeenCalled();
  });
});
