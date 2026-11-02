const set = jest.fn();
const del = jest.fn();
jest.mock("@server/services/redis.service", () => ({
  redisService: { getClient: () => ({ set, del }), isConnected: () => true },
}));

import { claimWebhookDelivery, releaseWebhookDelivery } from "@server/lib/webhook-replay";

describe("webhook delivery claims", () => {
  beforeEach(() => jest.resetAllMocks());

  it("sets the key once with the default window, then reports repeats", async () => {
    set.mockResolvedValueOnce("OK").mockResolvedValueOnce(null);

    await expect(claimWebhookDelivery("ns", "d-1")).resolves.toBe(true);
    await expect(claimWebhookDelivery("ns", "d-1")).resolves.toBe(false);
    expect(set).toHaveBeenCalledWith(
      expect.stringMatching(/^webhook:seen:ns:/),
      "1",
      "EX",
      600,
      "NX",
    );
  });

  it("uses the caller's window and releases the same key", async () => {
    set.mockResolvedValue("OK");

    await claimWebhookDelivery("ns", "d-2", 86400);
    await releaseWebhookDelivery("ns", "d-2");

    expect(set).toHaveBeenCalledWith(expect.any(String), "1", "EX", 86400, "NX");
    expect(del).toHaveBeenCalledWith(set.mock.calls[0][0]);
  });
});
