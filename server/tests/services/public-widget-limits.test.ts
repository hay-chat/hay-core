import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockCheckKey =
  jest.fn<
    (
      key: string,
      max: number,
      windowSeconds: number,
      failClosed: boolean,
    ) => Promise<{ limited: boolean }>
  >();
jest.mock("@server/services/rate-limit.service", () => ({
  rateLimitService: { checkKeyRateLimit: mockCheckKey },
}));

import { config } from "@server/config/env";
import {
  PUBLIC_WIDGET_LIMITS,
  isPublicWidgetRateLimited,
} from "@server/services/public-widget-limits";

describe("isPublicWidgetRateLimited", () => {
  beforeEach(() => jest.clearAllMocks());

  it("checks every rule under its own key with the configured limit", async () => {
    mockCheckKey.mockResolvedValue({ limited: false });

    const limited = await isPublicWidgetRateLimited([
      { rule: "createPerIp", id: "203.0.113.7" },
      { rule: "createPerOrg", id: "org-1" },
    ]);

    expect(limited).toBe(false);
    expect(mockCheckKey).toHaveBeenCalledWith(
      "public-widget:createPerIp:203.0.113.7",
      PUBLIC_WIDGET_LIMITS.createPerIp.max,
      PUBLIC_WIDGET_LIMITS.createPerIp.windowSeconds,
      false,
    );
    expect(mockCheckKey).toHaveBeenCalledWith(
      "public-widget:createPerOrg:org-1",
      PUBLIC_WIDGET_LIMITS.createPerOrg.max,
      PUBLIC_WIDGET_LIMITS.createPerOrg.windowSeconds,
      false,
    );
  });

  it("is limited when any rule is exhausted", async () => {
    mockCheckKey.mockResolvedValueOnce({ limited: false }).mockResolvedValueOnce({ limited: true });

    await expect(
      isPublicWidgetRateLimited([
        { rule: "messagePerConversation", id: "c" },
        { rule: "messagePerIp", id: "ip" },
      ]),
    ).resolves.toBe(true);
  });

  it("stops at the first refusal so a refused per-IP request never spends the per-org counter", async () => {
    mockCheckKey.mockResolvedValueOnce({ limited: true });

    await expect(
      isPublicWidgetRateLimited([
        { rule: "createPerIp", id: "203.0.113.7" },
        { rule: "createPerOrg", id: "org-1" },
      ]),
    ).resolves.toBe(true);

    expect(mockCheckKey).toHaveBeenCalledTimes(1);
    expect(mockCheckKey).not.toHaveBeenCalledWith(
      "public-widget:createPerOrg:org-1",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("passes the fail-closed choice to every rule and surfaces the refusal", async () => {
    mockCheckKey.mockResolvedValue({ limited: false });
    await isPublicWidgetRateLimited([{ rule: "createPerIp", id: "ip" }], { failClosed: true });
    expect(mockCheckKey.mock.calls[0][3]).toBe(true);

    mockCheckKey.mockRejectedValue(new Error("unavailable"));
    await expect(
      isPublicWidgetRateLimited([{ rule: "createPerIp", id: "ip" }], { failClosed: true }),
    ).rejects.toThrow("unavailable");
  });

  it("checks rules in the order given", async () => {
    mockCheckKey.mockResolvedValue({ limited: false });

    await isPublicWidgetRateLimited([
      { rule: "createPerIp", id: "ip" },
      { rule: "createPerOrg", id: "org" },
    ]);

    expect(mockCheckKey.mock.calls.map(([key]) => key)).toEqual([
      "public-widget:createPerIp:ip",
      "public-widget:createPerOrg:org",
    ]);
  });

  it("skips only the per-IP rules for an exempt IP", async () => {
    mockCheckKey.mockResolvedValue({ limited: false });
    const exempt = config.server.publicWidgetRateLimitExemptIps;
    exempt.push("198.51.100.9");
    try {
      await isPublicWidgetRateLimited([
        { rule: "createPerIp", id: "198.51.100.9" },
        { rule: "createPerOrg", id: "org-1" },
      ]);
    } finally {
      exempt.pop();
    }

    expect(mockCheckKey).toHaveBeenCalledTimes(1);
    expect(mockCheckKey.mock.calls[0][0]).toBe("public-widget:createPerOrg:org-1");
  });
});
