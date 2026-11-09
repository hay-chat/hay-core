import { describe, expect, it } from "vitest";
import { statusesForFilter, timeframeStart } from "./conversation-filters";

describe("statusesForFilter", () => {
  it("maps every option to real conversation statuses", () => {
    expect(statusesForFilter("")).toBeUndefined();
    expect(statusesForFilter("active")).toEqual(["open", "processing", "awaiting-approval"]);
    expect(statusesForFilter("escalated")).toEqual(["pending-human", "human-took-over"]);
    expect(statusesForFilter("unresolved")).toEqual(["unresolved"]);
  });
});

describe("timeframeStart", () => {
  const now = new Date(2026, 10, 9, 15, 30);

  it("has no bound for all time", () => {
    expect(timeframeStart("all", now)).toBeUndefined();
  });

  it("starts today at local midnight", () => {
    expect(timeframeStart("today", now)).toEqual(new Date(2026, 10, 9));
  });

  it("looks back 7 and 30 days", () => {
    expect(timeframeStart("week", now)?.getTime()).toBe(now.getTime() - 7 * 86_400_000);
    expect(timeframeStart("month", now)?.getTime()).toBe(now.getTime() - 30 * 86_400_000);
  });
});
