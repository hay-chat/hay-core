import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Public widget API (publicConversations.*): the guards in front of create.
 */

jest.mock("@server/config/env", () => ({
  config: {
    domain: { dashboard: "app.hay.chat", api: "api.hay.chat:443" },
    jwt: { secret: "test" },
  },
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
const mockFindByExternalId = jest.fn<(id: string, orgId: string) => Promise<unknown>>(
  async () => null,
);
jest.mock("@server/repositories/customer.repository", () => ({
  CustomerRepository: jest.fn(() => ({ findByExternalId: mockFindByExternalId })),
}));

const mockVerifiedCustomerExternalId = jest.fn<
  (orgId: string, id?: string, signature?: string) => Promise<string | null>
>(async () => null);
jest.mock("@server/services/webchat/webchat-identity.service", () => ({
  verifiedCustomerExternalId: mockVerifiedCustomerExternalId,
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

const mockRateLimited =
  jest.fn<(checks: Array<{ rule: string; id: string }>) => Promise<boolean>>();
jest.mock("@server/services/public-widget-limits", () => ({
  PUBLIC_WIDGET_LIMITS: { maxMessageLength: 4000 },
  isPublicWidgetRateLimited: mockRateLimited,
}));

type GateOutcomeMock = {
  decision: "allow" | "deny" | "flag";
  results: Array<{ pluginId: string; decision: string; reason?: string }>;
};
const mockRunGates = jest.fn<(...args: unknown[]) => Promise<GateOutcomeMock>>(async () => ({
  decision: "allow",
  results: [],
}));
jest.mock("@server/services/webchat/webchat-extensions.service", () => ({
  webchatExtensionsService: { runGates: mockRunGates },
}));

const mockRecordCreateAttempt = jest.fn<(orgId: string) => Promise<boolean>>(async () => false);
jest.mock("@server/services/webchat/under-attack.service", () => ({
  recordCreateAttempt: mockRecordCreateAttempt,
  isUnderAttack: async () => false,
}));

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
    mockRateLimited.mockResolvedValue(false);
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

describe("publicConversations.create language", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOrganization.mockResolvedValue({ id: ORG_ID, suspendedAt: null, settings: {} });
    mockIsEnabled.mockResolvedValue(true);
    mockGetSettings.mockResolvedValue({ allowedDomains: ["*"] });
    mockRateLimited.mockResolvedValue(false);
  });

  it("passes the widget locale on to the conversation", async () => {
    await callerFor().create({ ...createInput, language: "pt-BR" });
    expect(mockCreateConversation).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ language: "pt-BR" }),
    );
  });

  it.each(["", "portuguese-brazil-x", "pt_BR", "<script>", "a".repeat(40)])(
    "rejects a malformed locale %p",
    async (language) => {
      await expect(callerFor().create({ ...createInput, language })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(mockCreateConversation).not.toHaveBeenCalled();
    },
  );
});

describe("publicConversations.create metadata", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOrganization.mockResolvedValue({ id: ORG_ID, suspendedAt: null, settings: {} });
    mockIsEnabled.mockResolvedValue(true);
    mockGetSettings.mockResolvedValue({ allowedDomains: ["*"] });
    mockRateLimited.mockResolvedValue(false);
  });

  it("keeps the page details and drops every key the server trusts", async () => {
    await callerFor().create({
      ...createInput,
      metadata: {
        source: "web-embed",
        url: "https://shop.example.com/cart",
        referrer: "",
        userAgent: "Mozilla/5.0",
        timestamp: "2026-10-28T00:00:00Z",
        dryRun: true,
        isPlayground: true,
        sourceId: "playground",
        runKind: "simulation",
        test_mode: "true",
        channel: "whatsapp",
        whatsapp: { conversationId: "wa-1" },
      },
    });

    const [, data] = mockCreateConversation.mock.calls[0] as [
      string,
      { metadata: Record<string, unknown> },
    ];
    expect(data.metadata).toEqual({
      source: "web-embed",
      url: "https://shop.example.com/cart",
      referrer: "",
      userAgent: "Mozilla/5.0",
      timestamp: "2026-10-28T00:00:00Z",
      channel: "web",
      createdAt: expect.any(String),
    });
  });
});

describe("publicConversations rate limits", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOrganization.mockResolvedValue({ id: ORG_ID, suspendedAt: null, settings: {} });
    mockIsEnabled.mockResolvedValue(true);
    mockGetSettings.mockResolvedValue({ allowedDomains: ["*"] });
  });

  it("create is limited per IP and per org", async () => {
    mockRateLimited.mockResolvedValue(true);
    await expect(callerFor({}, "198.51.100.4").create(createInput)).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    expect(mockRateLimited).toHaveBeenCalledWith([
      { rule: "createPerIp", id: "198.51.100.4" },
      { rule: "createPerOrg", id: ORG_ID },
    ]);
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  const sendInput = {
    conversationId: "22222222-2222-4222-8222-222222222222",
    content: "hello",
    proof: "proof",
    method: "POST",
    url: "http://localhost:3001/v1/publicConversations.sendMessage",
  };

  it("sendMessage is limited per IP before the proof is checked", async () => {
    mockRateLimited.mockResolvedValue(true);
    await expect(callerFor({}, "198.51.100.4").sendMessage(sendInput)).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    expect(mockRateLimited).toHaveBeenCalledTimes(1);
    expect(mockRateLimited).toHaveBeenCalledWith([{ rule: "messagePerIp", id: "198.51.100.4" }]);
  });

  it("sendMessage does not spend the per-conversation budget on an unverified proof", async () => {
    mockRateLimited.mockResolvedValue(false);
    await expect(callerFor().sendMessage(sendInput)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(mockRateLimited).not.toHaveBeenCalledWith([
      { rule: "messagePerConversation", id: sendInput.conversationId },
    ]);
  });

  it("sendMessage rejects content over the length cap", async () => {
    mockRateLimited.mockResolvedValue(false);
    await expect(
      callerFor().sendMessage({ ...sendInput, content: "x".repeat(4001) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockRateLimited).not.toHaveBeenCalled();
  });
});

describe("publicConversations.sendAttachment guards (D8-9)", () => {
  beforeEach(() => jest.clearAllMocks());

  const attachmentInput = {
    conversationId: "22222222-2222-4222-8222-222222222222",
    data: Buffer.from("abc").toString("base64"),
    mimeType: "image/jpeg" as const,
    filename: "photo.jpg",
    proof: "proof",
    method: "POST",
    url: "http://localhost:3001/v1/publicConversations.sendAttachment",
  };

  it("is limited per IP before the proof is checked", async () => {
    mockRateLimited.mockResolvedValue(true);
    await expect(
      callerFor({}, "198.51.100.4").sendAttachment(attachmentInput),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(mockRateLimited).toHaveBeenCalledTimes(1);
    expect(mockRateLimited).toHaveBeenCalledWith([{ rule: "attachmentPerIp", id: "198.51.100.4" }]);
  });

  it("requires a valid proof for the conversation (ownership) before anything is stored", async () => {
    mockRateLimited.mockResolvedValue(false);
    await expect(callerFor().sendAttachment(attachmentInput)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(mockRateLimited).not.toHaveBeenCalledWith([
      { rule: "attachmentPerConversation", id: attachmentInput.conversationId },
    ]);
  });

  it("refuses types other than images and PDF", async () => {
    mockRateLimited.mockResolvedValue(false);
    await expect(
      callerFor().sendAttachment({ ...attachmentInput, mimeType: "video/mp4" as never }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockRateLimited).not.toHaveBeenCalled();
  });
});

describe("publicConversations.create plugin gates", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOrganization.mockResolvedValue({ id: ORG_ID, suspendedAt: null, settings: {} });
    mockIsEnabled.mockResolvedValue(true);
    mockGetSettings.mockResolvedValue({ allowedDomains: ["*"] });
    mockRateLimited.mockResolvedValue(false);
  });

  it("passes the challenge token and page host to the gates", async () => {
    await callerFor({ origin: "https://shop.example.com" }).create({
      ...createInput,
      challengeToken: "tok",
    });
    expect(mockRunGates).toHaveBeenCalledWith(
      ORG_ID,
      "conversation.create",
      expect.objectContaining({
        token: "tok",
        pageHostname: "shop.example.com",
        frameHostname: "api.hay.chat",
      }),
    );
  });

  it("counts the attempt and tells the gates when the org is under attack", async () => {
    mockRecordCreateAttempt.mockResolvedValueOnce(true);
    await callerFor().create(createInput);
    expect(mockRecordCreateAttempt).toHaveBeenCalledWith(ORG_ID);
    expect(mockRunGates).toHaveBeenCalledWith(
      ORG_ID,
      "conversation.create",
      expect.objectContaining({ underAttack: true }),
    );
  });

  it("refuses with VERIFICATION_FAILED and creates nothing when a gate denies", async () => {
    mockRunGates.mockResolvedValueOnce({
      decision: "deny",
      results: [{ pluginId: "p", decision: "deny", reason: "invalid_token" }],
    });
    await expect(callerFor().create(createInput)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "VERIFICATION_FAILED",
    });
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  it("creates a flagged conversation and records the bot check", async () => {
    const results = [{ pluginId: "p", decision: "flag", reason: "provider_unavailable" }];
    mockRunGates.mockResolvedValueOnce({ decision: "flag", results });
    await callerFor().create(createInput);
    const data = mockCreateConversation.mock.calls[0][1] as { metadata: Record<string, unknown> };
    expect(data.metadata.botCheck).toMatchObject({ decision: "flag", results });
  });
});

describe("publicConversations.create customer link (D1)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOrganization.mockResolvedValue({ id: ORG_ID, suspendedAt: null, settings: {} });
    mockIsEnabled.mockResolvedValue(true);
    mockGetSettings.mockResolvedValue({ allowedDomains: ["*"] });
    mockRateLimited.mockResolvedValue(false);
    mockFindByExternalId.mockResolvedValue({ id: "customer-ana" });
  });

  it("links the store's customer when the id is signed", async () => {
    mockVerifiedCustomerExternalId.mockResolvedValue("ana@shop.com");

    await callerFor().create({
      ...createInput,
      customerExternalId: "ana@shop.com",
      customerExternalIdSignature: "a".repeat(64),
    });

    expect(mockVerifiedCustomerExternalId).toHaveBeenCalledWith(
      ORG_ID,
      "ana@shop.com",
      "a".repeat(64),
    );
    expect(mockFindByExternalId).toHaveBeenCalledWith("ana@shop.com", ORG_ID);
    expect(mockCreateConversation).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ customer_id: "customer-ana" }),
    );
  });

  it.each([
    ["unsigned", undefined],
    ["wrongly signed", "b".repeat(64)],
  ])("never links an %s id: the visitor gets a fresh customer", async (_label, signature) => {
    mockVerifiedCustomerExternalId.mockResolvedValue(null);

    await callerFor().create({
      ...createInput,
      customerExternalId: "ana@shop.com",
      ...(signature ? { customerExternalIdSignature: signature } : {}),
    });

    expect(mockFindByExternalId).not.toHaveBeenCalled();
    expect(mockCreateConversation).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ customer_id: null }),
    );
  });

  it("a signed id with no matching customer stays anonymous", async () => {
    mockVerifiedCustomerExternalId.mockResolvedValue("new@shop.com");
    mockFindByExternalId.mockResolvedValue(null);

    await callerFor().create({
      ...createInput,
      customerExternalId: "new@shop.com",
      customerExternalIdSignature: "c".repeat(64),
    });

    expect(mockCreateConversation).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ customer_id: null }),
    );
  });
});
