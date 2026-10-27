import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * organizations.getAiRegion / updateAiRegion / updateLlmConfig — the EU-only switch
 * can only be turned on when the EU endpoint is configured, and a custom provider
 * cannot be saved while it is on (it would be ignored).
 */

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

const mockFindOne = jest.fn<(id: string) => Promise<unknown>>();
const mockUpdate = jest.fn<(id: string, data: unknown) => Promise<unknown>>();
jest.mock("@server/services/organization.service", () => ({
  organizationService: {
    findOne: (id: string) => mockFindOne(id),
    update: (id: string, data: unknown) => mockUpdate(id, data),
  },
}));

const mockInvalidate = jest.fn();
jest.mock("@server/services/llm/llm-provider.factory", () => ({
  llmProviderFactory: { invalidate: (id: string) => mockInvalidate(id) },
}));

const mockEuConfigured = jest.fn(() => true);
jest.mock("@server/services/llm/ai-region", () => {
  const actual = jest.requireActual<typeof import("@server/services/llm/ai-region")>(
    "@server/services/llm/ai-region",
  );
  return { ...actual, isEuRegionConfigured: () => mockEuConfigured() };
});

import { organizationsRouter } from "@server/routes/v1/organizations";
import type { Context } from "@server/trpc/context";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const ctx = {
  user: {
    id: "user-1",
    hasScope: () => true,
    getRole: () => "owner",
    userOrganization: { organization: {} },
  },
  organizationId: ORG_ID,
  req: { headers: {} },
  res: {},
} as unknown as Context;
const caller = () => organizationsRouter.createCaller(ctx);

const llmInput = {
  chat: {
    provider: "openai-compatible" as const,
    vendor: "openai" as const,
    tiers: { easy: "e", medium: "m", hard: "h" },
  },
  embedding: { model: "text-embedding-3-small" },
};

describe("organizations AI region", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEuConfigured.mockReturnValue(true);
    mockFindOne.mockResolvedValue({ id: ORG_ID, settings: { retentionDays: 30 } });
    mockUpdate.mockResolvedValue({});
  });

  it("reports the region, whether EU is available, and whether a custom provider is set", async () => {
    mockEuConfigured.mockReturnValue(false);
    await expect(caller().getAiRegion()).resolves.toEqual({
      region: "default",
      euAvailable: false,
      hasCustomProvider: false,
    });
  });

  it("turns EU on, keeps other settings, and drops the cached provider bundle", async () => {
    await expect(caller().updateAiRegion({ region: "eu" })).resolves.toEqual({
      success: true,
      region: "eu",
    });
    expect(mockUpdate).toHaveBeenCalledWith(ORG_ID, {
      settings: { retentionDays: 30, aiRegion: "eu" },
    });
    expect(mockInvalidate).toHaveBeenCalledWith(ORG_ID);
  });

  it("refuses to turn EU on when the EU endpoint is not configured", async () => {
    mockEuConfigured.mockReturnValue(false);
    await expect(caller().updateAiRegion({ region: "eu" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("always allows turning EU off, even when EU is not configured", async () => {
    mockEuConfigured.mockReturnValue(false);
    mockFindOne.mockResolvedValue({ id: ORG_ID, settings: { aiRegion: "eu" } });
    await caller().updateAiRegion({ region: "default" });
    expect(mockUpdate).toHaveBeenCalledWith(ORG_ID, { settings: { aiRegion: "default" } });
  });

  it("rejects unknown regions", async () => {
    await expect(
      caller().updateAiRegion({ region: "us" as unknown as "eu" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses to save a custom AI provider while the org is EU-only", async () => {
    mockFindOne.mockResolvedValue({ id: ORG_ID, settings: { aiRegion: "eu" } });
    await expect(caller().updateLlmConfig(llmInput)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("still saves a custom AI provider for default-region orgs", async () => {
    await expect(caller().updateLlmConfig(llmInput)).resolves.toEqual({ success: true });
    expect(mockUpdate).toHaveBeenCalled();
  });
});
