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

  it("refreshes a 1-hour token after 48 minutes", () => {
    expect(shouldRefresh(now + 13 * 60, now - 47 * 60, now)).toBe(false);
    expect(shouldRefresh(now + 11 * 60, now - 49 * 60, now)).toBe(true);
  });

  it("falls back to the last 15 minutes when the issue time is unknown", () => {
    expect(shouldRefresh(now + 11 * DAY, undefined, now)).toBe(false);
    expect(shouldRefresh(now + 10 * 60, undefined, now)).toBe(true);
  });

  it("never refreshes an already expired token", () => {
    expect(shouldRefresh(now - 1, now - 60 * DAY, now)).toBe(false);
  });
});
