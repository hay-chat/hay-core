import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * AI label (D14-6): on by default, renamable, hideable per channel only for
 * non-EU organizations. The widget's public config carries the result.
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
jest.mock("@server/services/llm/llm-provider.factory", () => ({
  llmProviderFactory: { invalidate: jest.fn() },
}));

const mockFindById = jest.fn<(id: string) => Promise<unknown>>();
jest.mock("@server/repositories/organization.repository", () => {
  const actual = jest.requireActual<typeof import("@server/repositories/organization.repository")>(
    "@server/repositories/organization.repository",
  );
  return { ...actual, organizationRepository: { findById: (id: string) => mockFindById(id) } };
});
jest.mock("@server/services/webchat/webchat-settings.service", () => ({
  webchatSettingsService: {
    isEnabled: async () => true,
    getPublicConfig: async () => ({ widgetTitle: "Chat" }),
  },
}));

import { organizationsRouter } from "@server/routes/v1/organizations";
import { webchatRouter } from "@server/routes/v1/webchat";
import { isAiLabelShown, isEuOrganization } from "@server/services/ai-disclosure";
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
const publicCaller = () =>
  webchatRouter.createCaller({ req: { headers: {} }, res: {} } as unknown as Context);

const US_ORG = { id: ORG_ID, timezone: "America/Sao_Paulo", settings: { retentionDays: 30 } };

describe("AI disclosure label", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOne.mockResolvedValue(US_ORG);
    mockUpdate.mockResolvedValue({});
  });

  it("treats EU-only processing or a European time zone as EU", () => {
    expect(isEuOrganization({ timezone: "Europe/Berlin" } as never)).toBe(true);
    expect(isEuOrganization({ settings: { aiRegion: "eu" } } as never)).toBe(true);
    expect(isEuOrganization(US_ORG as never)).toBe(false);
  });

  it("is shown everywhere by default", async () => {
    await expect(caller().getAiDisclosure()).resolves.toEqual({
      label: null,
      hiddenChannels: [],
      locked: false,
      draftsChannels: [],
    });
    expect(isAiLabelShown(US_ORG as never, "web")).toBe(true);
  });

  it("lets a non-EU org rename it and hide it per channel, keeping other settings", async () => {
    await caller().updateAiDisclosure({ label: "  Aurora bot  ", hiddenChannels: ["web", "web"] });
    expect(mockUpdate).toHaveBeenCalledWith(ORG_ID, {
      settings: {
        retentionDays: 30,
        aiDisclosure: { label: "Aurora bot", hiddenChannels: ["web"] },
      },
    });
  });

  it("lets an EU org rename it but never hide it", async () => {
    mockFindOne.mockResolvedValue({ ...US_ORG, timezone: "Europe/Lisbon" });
    await expect(caller().updateAiDisclosure({ hiddenChannels: ["web"] })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller().updateAiDisclosure({ label: "Assistente IA" })).resolves.toEqual({
      success: true,
    });

    // A label hidden before the org became EU is shown anyway.
    const euOrg = {
      ...US_ORG,
      settings: { aiRegion: "eu", aiDisclosure: { hiddenChannels: ["web"] } },
    };
    mockFindOne.mockResolvedValue(euOrg);
    await expect(caller().getAiDisclosure()).resolves.toMatchObject({
      hiddenChannels: [],
      locked: true,
    });
    expect(isAiLabelShown(euOrg as never, "web")).toBe(true);
  });

  it("rejects a label longer than 40 characters and channel ids that are not ids", async () => {
    await expect(caller().updateAiDisclosure({ label: "x".repeat(41) })).rejects.toThrow();
    await expect(caller().updateAiDisclosure({ hiddenChannels: ["../web"] })).rejects.toThrow();
  });

  it("switches channels to drafts only and back (D14-7)", async () => {
    await caller().updateAiDisclosure({ draftsChannels: ["whatsapp", "email"] });
    expect(mockUpdate).toHaveBeenLastCalledWith(ORG_ID, {
      settings: expect.objectContaining({
        retentionDays: 30,
        channelAiModes: { whatsapp: "drafts", email: "drafts" },
      }),
    });

    mockFindOne.mockResolvedValue({
      ...US_ORG,
      settings: { channelAiModes: { whatsapp: "drafts", web: "on" } },
    });
    await expect(caller().getAiDisclosure()).resolves.toMatchObject({
      draftsChannels: ["whatsapp"],
    });

    // Saving only the label leaves the channel modes alone.
    await caller().updateAiDisclosure({ label: "Aurora bot" });
    expect(mockUpdate).toHaveBeenLastCalledWith(ORG_ID, {
      settings: expect.objectContaining({ channelAiModes: { whatsapp: "drafts", web: "on" } }),
    });

    await caller().updateAiDisclosure({ draftsChannels: [] });
    expect(mockUpdate).toHaveBeenLastCalledWith(ORG_ID, {
      settings: expect.objectContaining({ channelAiModes: {} }),
    });
  });

  it("sends the label to the widget", async () => {
    mockFindById.mockResolvedValue({
      ...US_ORG,
      settings: { aiDisclosure: { label: "Aurora bot" } },
    });
    await expect(publicCaller().getPublicConfig({ organizationId: ORG_ID })).resolves.toMatchObject(
      { enabled: true, aiLabelShown: true, aiLabelText: "Aurora bot" },
    );

    mockFindById.mockResolvedValue({
      ...US_ORG,
      settings: { aiDisclosure: { hiddenChannels: ["web"] } },
    });
    await expect(publicCaller().getPublicConfig({ organizationId: ORG_ID })).resolves.toMatchObject(
      { aiLabelShown: false, aiLabelText: null },
    );
  });
});
