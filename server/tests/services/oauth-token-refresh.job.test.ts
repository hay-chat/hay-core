// shouldRefresh is pure; stub the job's DB-backed imports so loading the
// module doesn't pull in the data source and entity graph.
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: {},
}));
jest.mock("@server/services/oauth.service", () => ({ oauthService: {} }));

import { shouldRefresh } from "@server/services/oauth-token-refresh.job";

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
