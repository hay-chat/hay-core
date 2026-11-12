import { describe, it, expect, jest, beforeEach } from "@jest/globals";

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

type Settings = Record<string, unknown>;
let stored: Settings;
const mockGetOrCreate = jest.fn(async (_orgId: string) => stored);
const mockUpdate = jest.fn(async (_orgId: string, data: Settings) => {
  stored = { ...stored, ...data };
  return stored;
});
const mockPatch = jest.fn(async (_orgId: string, _data: Settings) => undefined);
jest.mock("@server/repositories/webchat-settings.repository", () => ({
  webchatSettingsRepository: {
    getOrCreate: mockGetOrCreate,
    update: mockUpdate,
    patch: mockPatch,
  },
}));

const mockFindOrganization = jest.fn(async (_id: string): Promise<unknown> => null);
jest.mock("@server/repositories/organization.repository", () => ({
  organizationRepository: { findById: mockFindOrganization },
}));
const mockDeleteUpload = jest.fn(async (_id: string) => undefined);
jest.mock("@server/services/storage.service", () => ({
  storageService: {
    getUrl: (upload: { id: string }) => `https://cdn.example/${upload.id}.png`,
    delete: mockDeleteUpload,
  },
}));
jest.mock("@server/entities/upload.entity", () => ({
  Upload: { findOne: async ({ where }: { where: { id: string } }) => ({ id: where.id }) },
}));

interface FakeMember {
  isActive: boolean;
  role: string;
  user: Record<string, unknown>;
  hasScope: (resource: string, action: string) => boolean;
}
let members: FakeMember[] = [];
const mockFindMembers = jest.fn(async () => members);
jest.mock("@server/database/data-source", () => ({
  AppDataSource: { getRepository: () => ({ find: mockFindMembers }) },
}));
jest.mock("@server/entities/user-organization.entity", () => ({ UserOrganization: class {} }));
const mockResolveWebsite = jest.fn(async (_orgId: string): Promise<string | null> => null);
jest.mock("@server/services/site-index.service", () => ({
  siteIndexService: { resolveWebsite: mockResolveWebsite },
}));
const mockStartImport = jest.fn();
jest.mock("@server/services/branding-import/branding-import.service", () => ({
  brandingImportService: { startImport: mockStartImport },
}));

import { webchatSettingsService } from "@server/services/webchat/webchat-settings.service";
import type { WebchatSettings } from "@server/database/entities/webchat-settings.entity";

const ORG = "11111111-1111-4111-8111-111111111111";

function settingsRow(overrides: Settings = {}): Settings {
  return {
    id: "w1",
    organizationId: ORG,
    widgetTitle: "Chat with us",
    position: "right",
    themeMode: "light",
    brandColor: "#001df5",
    brandColorSource: null,
    brandPalette: [],
    logoUploadId: null,
    logoSource: null,
    brandingImportedAt: null,
    homeHeading: null,
    showGreeting: true,
    greetingMessage: "Hello!",
    teaserMessage: null,
    csatEnabled: true,
    csatQuestion: null,
    allowedDomains: [],
    isEnabled: true,
    spamClassifierEnabled: false,
    spamGuidance: null,
    underAttackUntil: null,
    underAttackSource: null,
    customCss: null,
    preChatForm: null,
    pageTools: { enabled: false },
    lastSeenAt: null,
    lastSeenOrigin: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    ...overrides,
  };
}

function member(
  firstName: string | undefined,
  options: { canTakeOver?: boolean; status?: string; lastSeenAt?: Date; avatarUrl?: string } = {},
): FakeMember {
  return {
    isActive: true,
    role: "agent",
    user: {
      firstName,
      isActive: true,
      status: options.status ?? "available",
      lastSeenAt: options.lastSeenAt,
      avatarUrl: options.avatarUrl,
    },
    hasScope: () => options.canTakeOver ?? true,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  stored = settingsRow();
  members = [];
});

describe("updateSettings", () => {
  it("marks a brand colour set by the merchant as custom", async () => {
    const view = await webchatSettingsService.updateSettings(ORG, { brandColor: "#FF8800" });
    expect(mockUpdate).toHaveBeenCalledWith(ORG, {
      brandColor: "#ff8800",
      brandColorSource: "custom",
    });
    expect(view).toMatchObject({ brandColor: "#ff8800", brandColorSource: "custom" });
  });

  it("leaves the colour source alone for other fields", async () => {
    await webchatSettingsService.updateSettings(ORG, { themeMode: "dark", homeHeading: "Hi!" });
    expect(mockUpdate).toHaveBeenCalledWith(ORG, { themeMode: "dark", homeHeading: "Hi!" });
  });
});

describe("toView", () => {
  it("exposes the logo URL and ISO dates, and hides internals", async () => {
    const view = await webchatSettingsService.toView(
      settingsRow({
        logoUploadId: "logo-1",
        logoSource: "website",
        lastSeenAt: new Date("2026-11-01T10:00:00Z"),
        lastSeenOrigin: "https://shop.example.com",
        identitySecret: "secret",
      }) as unknown as WebchatSettings,
    );
    expect(view).toMatchObject({
      logoUrl: "https://cdn.example/logo-1.png",
      logoSource: "website",
      lastSeenAt: "2026-11-01T10:00:00.000Z",
      lastSeenOrigin: "https://shop.example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(view).not.toHaveProperty("identitySecret");
    expect(view).not.toHaveProperty("logoUploadId");
    expect(view).not.toHaveProperty("brandingImportedAt");
  });
});

describe("logo upload and removal", () => {
  it("a merchant upload replaces the old logo and is custom", async () => {
    stored = settingsRow({ logoUploadId: "imported", logoSource: "website" });
    const view = await webchatSettingsService.setCustomLogo(ORG, "mine");
    expect(view).toMatchObject({ logoUrl: "https://cdn.example/mine.png", logoSource: "custom" });
    expect(mockDeleteUpload).toHaveBeenCalledWith("imported");
  });

  it("removing the logo is a merchant choice too", async () => {
    stored = settingsRow({ logoUploadId: "imported", logoSource: "website" });
    const view = await webchatSettingsService.removeLogo(ORG);
    expect(view).toMatchObject({ logoUrl: null, logoSource: "custom" });
    expect(mockDeleteUpload).toHaveBeenCalledWith("imported");
  });
});

describe("importBrandingIfNeverDone", () => {
  it("starts the import once for an organization with a website and nothing set", async () => {
    mockResolveWebsite.mockResolvedValueOnce("https://shop.example.com");
    webchatSettingsService.importBrandingIfNeverDone(settingsRow() as unknown as WebchatSettings);
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockStartImport).toHaveBeenCalledWith(ORG, "https://shop.example.com");
  });

  it("does nothing once something was imported, chosen or tried", async () => {
    for (const overrides of [
      { brandColorSource: "custom" },
      { logoSource: "website" },
      { brandingImportedAt: new Date() },
    ]) {
      webchatSettingsService.importBrandingIfNeverDone(
        settingsRow(overrides) as unknown as WebchatSettings,
      );
    }
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockResolveWebsite).not.toHaveBeenCalled();
  });
});

describe("recordWidgetLoad", () => {
  it("writes at most once a minute per organization, for allowed sites only", async () => {
    const org = "22222222-2222-4222-8222-222222222222";
    stored = settingsRow({ allowedDomains: ["shop.example.com"] });
    const start = new Date("2026-11-12T10:00:00Z");

    await webchatSettingsService.recordWidgetLoad(org, "https://shop.example.com", start);
    await webchatSettingsService.recordWidgetLoad(
      org,
      "https://shop.example.com",
      new Date(start.getTime() + 30_000),
    );
    expect(mockPatch).toHaveBeenCalledTimes(1);
    expect(mockPatch).toHaveBeenCalledWith(org, {
      lastSeenAt: start,
      lastSeenOrigin: "https://shop.example.com",
    });

    await webchatSettingsService.recordWidgetLoad(
      org,
      "https://evil.example.net",
      new Date(start.getTime() + 61_000),
    );
    expect(mockPatch).toHaveBeenCalledTimes(1);
  });
});

describe("getPublicConfig", () => {
  it("returns the C1 shape with the widget logo and up to two team members", async () => {
    stored = settingsRow({ logoUploadId: "logo-1", homeHeading: "Ask us anything" });
    mockFindOrganization.mockResolvedValue({
      id: ORG,
      assistantName: "Ava",
      logoUpload: { id: "org-logo" },
      settings: {},
    });
    members = [
      member("Old", { status: "available", lastSeenAt: new Date("2026-01-01") }),
      member("Away", { status: "away", lastSeenAt: new Date("2026-11-11") }),
      member("Viewer", { canTakeOver: false }),
      member(undefined),
      member("Recent", {
        status: "available",
        lastSeenAt: new Date("2026-11-10"),
        avatarUrl: "https://cdn.example/r.png",
      }),
    ];

    const config = await webchatSettingsService.getPublicConfig(ORG);
    expect(config).toEqual({
      widgetTitle: "Chat with us",
      position: "right",
      brandColor: "#001df5",
      themeMode: "light",
      logoUrl: "https://cdn.example/logo-1.png",
      homeHeading: "Ask us anything",
      team: [
        { firstName: "Recent", avatarUrl: "https://cdn.example/r.png" },
        { firstName: "Old", avatarUrl: null },
      ],
      showGreeting: true,
      greetingMessage: "Hello!",
      teaserMessage: null,
      csatEnabled: true,
      csatQuestion: null,
      agentName: "Ava",
      agentAvatarUrl: null,
      preChatForm: null,
    });
  });

  it("falls back to the organization logo, and shows no team when hand-off is off", async () => {
    mockFindOrganization.mockResolvedValue({
      id: ORG,
      logoUpload: { id: "org-logo" },
      settings: { confidenceGuardrail: { enableEscalation: false } },
    });
    members = [member("Ann")];
    const config = await webchatSettingsService.getPublicConfig(ORG);
    expect(config.logoUrl).toBe("https://cdn.example/org-logo.png");
    expect(config.team).toEqual([]);
    expect(mockFindMembers).not.toHaveBeenCalled();
  });
});
