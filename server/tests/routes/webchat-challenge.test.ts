import { describe, it, expect, jest, beforeEach } from "@jest/globals";

jest.mock("@server/config/env", () => ({
  config: { domain: { dashboard: "app.hay.chat", api: "api.hay.chat" } },
}));
jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock("@server/database/data-source", () => ({ AppDataSource: { isInitialized: false } }));

const mockFindOrganization = jest.fn<(id: string) => Promise<unknown>>();
jest.mock("@server/repositories/organization.repository", () => ({
  organizationRepository: { findById: mockFindOrganization },
}));
const mockIsEnabled = jest.fn<(orgId: string) => Promise<boolean>>();
const mockAllowed = jest.fn<(orgId: string, host: string | null) => Promise<boolean>>();
jest.mock("@server/services/webchat/webchat-settings.service", () => ({
  matchesAllowedDomains: (list: string[], host: string) => list.includes(host),
  webchatSettingsService: { isEnabled: mockIsEnabled, isDomainAllowed: mockAllowed },
}));
const mockResolveChallenges = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
jest.mock("@server/services/webchat/webchat-extensions.service", () => ({
  webchatExtensionsService: { resolveChallenges: mockResolveChallenges },
}));
jest.mock("@server/services/public-widget-limits", () => ({
  isPublicWidgetRateLimited: async () => false,
}));

jest.mock("@server/services/webchat/under-attack.service", () => ({
  isUnderAttack: async () => false,
}));

import { webchatChallengeHandler, parsePageOrigin } from "@server/routes/webchat-challenge";

const ORG = "11111111-1111-4111-8111-111111111111";
const challenge = {
  id: "turnstile.challenge",
  type: "challenge@1",
  props: {
    provider: "turnstile",
    siteKey: "1x00000000000000000000AA",
    mode: "invisible",
    action: "conversation_create",
  },
};

function fakeRes() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: "",
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name.toLowerCase()] = value;
    },
    send(body: string) {
      res.body = body;
    },
  };
  return res;
}

async function load(query: Record<string, string>) {
  const res = fakeRes();
  await webchatChallengeHandler(
    { query, headers: {}, socket: { remoteAddress: "203.0.113.7" } } as never,
    res as never,
  );
  return res;
}

describe("parsePageOrigin", () => {
  it("accepts bare http(s) origins only", () => {
    expect(parsePageOrigin("https://shop.example.com")?.hostname).toBe("shop.example.com");
    expect(parsePageOrigin("http://localhost:5173")?.port).toBe("5173");
    expect(parsePageOrigin("https://shop.example.com/cart")).toBeNull();
    expect(parsePageOrigin("javascript:alert(1)")).toBeNull();
    expect(parsePageOrigin("null")).toBeNull();
    expect(parsePageOrigin("https://user@shop.example.com")).toBeNull();
  });
});

describe("GET /v1/webchat/challenge", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsEnabled.mockResolvedValue(true);
    mockFindOrganization.mockResolvedValue({ id: ORG, suspendedAt: null });
    mockAllowed.mockResolvedValue(true);
    mockResolveChallenges.mockResolvedValue([challenge]);
  });

  it("renders Turnstile framed only by the page origin, posting only to it", async () => {
    const res = await load({ org: ORG, c: challenge.id, origin: "https://shop.example.com" });

    expect(res.statusCode).toBe(200);
    const csp = res.headers["content-security-policy"];
    expect(csp).toContain("frame-ancestors https://shop.example.com");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toMatch(/script-src 'nonce-[^']+' https:\/\/challenges\.cloudflare\.com/);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toContain('"parentOrigin":"https://shop.example.com"');
    expect(res.body).toContain('"appearance":"interaction-only"');
    expect(res.body).toContain("challenges.cloudflare.com/turnstile/v0/api.js?render=explicit");
    expect(res.body).not.toContain('postMessage(msg, "*")');
  });

  it("shows the widget to everyone in challenge_all mode", async () => {
    mockResolveChallenges.mockResolvedValue([
      { ...challenge, props: { ...challenge.props, mode: "challenge_all" } },
    ]);
    const res = await load({ org: ORG, c: challenge.id, origin: "https://shop.example.com" });
    expect(res.body).toContain('"appearance":"always"');
  });

  it("refuses an origin that is not on the allowed list", async () => {
    mockAllowed.mockResolvedValue(false);
    const res = await load({ org: ORG, c: challenge.id, origin: "https://evil.example" });
    expect(res.statusCode).toBe(403);
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  it("always allows the Hay.chat dashboard (widget preview)", async () => {
    mockAllowed.mockResolvedValue(false);
    const res = await load({ org: ORG, c: challenge.id, origin: "https://app.hay.chat" });
    expect(res.statusCode).toBe(200);
  });

  it("rejects malformed origins and unknown contributions", async () => {
    expect(
      (await load({ org: ORG, c: challenge.id, origin: "https://shop.example.com/x" })).statusCode,
    ).toBe(400);
    expect(
      (await load({ org: ORG, c: "other.challenge", origin: "https://shop.example.com" }))
        .statusCode,
    ).toBe(404);
  });

  it("is unavailable when no challenge is configured (keys unset)", async () => {
    mockResolveChallenges.mockResolvedValue([]);
    const res = await load({ org: ORG, c: challenge.id, origin: "https://shop.example.com" });
    expect(res.statusCode).toBe(404);
  });

  it("escapes values embedded in the inline script", async () => {
    mockResolveChallenges.mockResolvedValue([
      {
        ...challenge,
        props: { ...challenge.props, siteKey: "</script><script>alert(1)</script>" },
      },
    ]);
    const res = await load({ org: ORG, c: challenge.id, origin: "https://shop.example.com" });
    expect(res.body).not.toContain("</script><script>alert(1)");
  });
});
