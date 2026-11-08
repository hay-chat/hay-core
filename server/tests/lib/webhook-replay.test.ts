const set = jest.fn();
const del = jest.fn();
const mockState = { connected: true };
jest.mock("@server/services/redis.service", () => ({
  redisService: { getClient: () => ({ set, del }), isConnected: () => mockState.connected },
}));

import {
  claimWebhookDelivery,
  releaseWebhookDelivery,
  WebhookReplayUnavailableError,
} from "@server/lib/webhook-replay";

describe("webhook delivery claims", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockState.connected = true;
  });

  it("refuses a delivery when Redis is disconnected, without issuing a command", async () => {
    mockState.connected = false;

    await expect(claimWebhookDelivery("ns", "d-3")).rejects.toBeInstanceOf(
      WebhookReplayUnavailableError,
    );
    await releaseWebhookDelivery("ns", "d-3");
    expect(set).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("refuses a delivery when the Redis command fails", async () => {
    set.mockRejectedValue(new Error("boom"));

    await expect(claimWebhookDelivery("ns", "d-4")).rejects.toBeInstanceOf(
      WebhookReplayUnavailableError,
    );
  });

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
