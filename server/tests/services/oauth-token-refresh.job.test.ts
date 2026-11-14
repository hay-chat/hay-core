import { jest } from "@jest/globals";

// Stub the job's DB-backed imports so loading the module doesn't pull in the
// data source and entity graph.
const findOAuthInstances = jest.fn<() => Promise<unknown[]>>();
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: { findOAuthInstances },
}));
const refreshToken = jest.fn<(organizationId: string, pluginId: string) => Promise<unknown>>();
jest.mock("@server/services/oauth.service", () => ({ oauthService: { refreshToken } }));
const markFailing = jest.fn(async (..._args: unknown[]) => undefined);
const markOk = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock("@server/services/channel-health.service", () => ({
  channelHealthService: { markFailing, markOk },
}));

import { refreshOAuthTokens, shouldRefresh } from "@server/services/oauth-token-refresh.job";

const DAY = 24 * 60 * 60;
const now = 1_800_000_000;

describe("shouldRefresh", () => {
  it("waits until 80% of the lifetime has passed", () => {
    // 60-day token issued 47 days ago: 13 days left, not yet
    expect(shouldRefresh(now + 13 * DAY, now - 47 * DAY, now)).toBe(false);
    // issued 49 days ago: past day 48, refresh
    expect(shouldRefresh(now + 11 * DAY, now - 49 * DAY, now)).toBe(true);
  });

  it("refreshes a 1-hour token in its last 15 minutes, before the 80% mark", () => {
    // 80% would be minute 48, but the 15-minute floor kicks in at minute 45
    expect(shouldRefresh(now + 16 * 60, now - 44 * 60, now)).toBe(false);
    expect(shouldRefresh(now + 14 * 60, now - 46 * 60, now)).toBe(true);
  });

  it("falls back to the last 15 minutes when the issue time is unknown", () => {
    expect(shouldRefresh(now + 11 * DAY, undefined, now)).toBe(false);
    expect(shouldRefresh(now + 10 * 60, undefined, now)).toBe(true);
  });

  it("never refreshes an already expired token", () => {
    expect(shouldRefresh(now - 1, now - 60 * DAY, now)).toBe(false);
  });
});

describe("refreshOAuthTokens", () => {
  const nowSeconds = () => Math.floor(Date.now() / 1000);

  /** A 60-day token with `secondsLeft` to go, so it is past the 80% mark. */
  function instanceExpiringIn(secondsLeft: number) {
    const expiresAt = nowSeconds() + secondsLeft;
    return {
      organizationId: "org-1",
      plugin: { pluginId: "hay-channel-instagram", metadata: { authMethods: [] } },
      authState: {
        credentials: { refreshToken: "r", expiresAt, issuedAt: expiresAt - 60 * DAY },
      },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("clears an expiry warning once a refresh succeeds", async () => {
    findOAuthInstances.mockResolvedValue([instanceExpiringIn(2 * DAY)]);
    refreshToken.mockResolvedValue({});
    await refreshOAuthTokens();
    expect(markOk).toHaveBeenCalledWith("org-1", "hay-channel-instagram", ["token_expiring"]);
    expect(markFailing).not.toHaveBeenCalled();
  });

  it("keeps retrying quietly while there is time left", async () => {
    findOAuthInstances.mockResolvedValue([instanceExpiringIn(5 * DAY)]);
    refreshToken.mockRejectedValue(new Error("provider refused"));
    await refreshOAuthTokens();
    expect(markFailing).not.toHaveBeenCalled();
  });

  it("warns owners and admins when a refresh fails with under 3 days left", async () => {
    const instance = instanceExpiringIn(2 * DAY);
    findOAuthInstances.mockResolvedValue([instance]);
    refreshToken.mockRejectedValue(new Error("provider refused"));
    await refreshOAuthTokens();
    expect(markFailing).toHaveBeenCalledWith(
      "org-1",
      "hay-channel-instagram",
      "token_expiring",
      new Date(instance.authState.credentials.expiresAt * 1000).toISOString(),
    );
    expect(markOk).not.toHaveBeenCalled();
  });
});
