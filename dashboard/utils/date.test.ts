import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseLocalDate, toISODateRange, toLocalDateString } from "./date";

/**
 * Regression: "Last 30 days" ended at midnight today while the API filters
 * `<= endDate`, so today's conversations were left out (KPI cards showed 0).
 */

describe("toLocalDateString", () => {
  it("formats the local calendar day, not the UTC one", () => {
    // Just after local midnight: in zones east of UTC, toISOString() would
    // still give yesterday.
    expect(toLocalDateString(new Date(2026, 9, 27, 0, 30))).toBe("2026-10-27");
    expect(toLocalDateString(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("parseLocalDate", () => {
  it("reads YYYY-MM-DD as local midnight", () => {
    expect(parseLocalDate("2026-10-27")?.getTime()).toBe(new Date(2026, 9, 27).getTime());
  });

  it("rejects anything else", () => {
    expect(parseLocalDate("")).toBeNull();
    expect(parseLocalDate("2026-10-27T10:00:00Z")).toBeNull();
  });
});

describe("toISODateRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 27, 15, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("covers the whole end day, so a range ending today includes now", () => {
    const range = toISODateRange({ startDate: "2026-09-28", endDate: "2026-10-27" });
    expect(range.startDate).toBe(new Date(2026, 8, 28).toISOString());
    expect(range.endDate).toBe(new Date(2026, 9, 27, 23, 59, 59, 999).toISOString());
    expect(new Date(range.endDate!).getTime()).toBeGreaterThan(Date.now());
  });

  it("leaves missing bounds undefined", () => {
    expect(toISODateRange({ startDate: "", endDate: "" })).toEqual({
      startDate: undefined,
      endDate: undefined,
    });
  });
});
