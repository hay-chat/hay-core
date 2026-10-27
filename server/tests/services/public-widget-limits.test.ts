import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockCheckKey =
  jest.fn<(key: string, max: number, windowSeconds: number) => Promise<{ limited: boolean }>>();
jest.mock("@server/services/rate-limit.service", () => ({
  rateLimitService: { checkKeyRateLimit: mockCheckKey },
}));

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
    );
    expect(mockCheckKey).toHaveBeenCalledWith(
      "public-widget:createPerOrg:org-1",
      PUBLIC_WIDGET_LIMITS.createPerOrg.max,
      PUBLIC_WIDGET_LIMITS.createPerOrg.windowSeconds,
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
});
