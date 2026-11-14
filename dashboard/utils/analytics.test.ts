import { describe, it, expect } from "vitest";
import { describeDelta, deltaColor, formatRate, formatScore, quotaBurnDown } from "./analytics";

describe("formatRate and formatScore", () => {
  it("show a dash, not zero, when there is no value", () => {
    expect(formatRate(null)).toBe("—");
    expect(formatScore(undefined)).toBe("—");
    expect(formatRate(42.857)).toBe("42.9%");
    expect(formatScore(4.5)).toBe("4.50");
  });
});

describe("describeDelta", () => {
  it("subtracts rates as points", () => {
    expect(describeDelta(45.25, 42, "points")).toEqual({ text: "+3.3 pts", direction: "up" });
    expect(describeDelta(40, 42, "points")).toEqual({ text: "-2.0 pts", direction: "down" });
  });

  it("reports counts as relative growth", () => {
    expect(describeDelta(150, 100, "percent")).toEqual({ text: "+50%", direction: "up" });
    expect(describeDelta(100, 100, "percent")).toEqual({ text: "0%", direction: "flat" });
  });

  it("has nothing to say without a previous value, or for growth from zero", () => {
    expect(describeDelta(40, null, "points")).toBeNull();
    expect(describeDelta(null, 40, "points")).toBeNull();
    expect(describeDelta(12, 0, "percent")).toBeNull();
  });

  it("is flat when the change rounds to nothing", () => {
    expect(describeDelta(4.501, 4.5, "score")).toEqual({ text: "0.00", direction: "flat" });
  });
});

describe("deltaColor", () => {
  it("is green when the change is good for the metric", () => {
    const up = describeDelta(50, 40, "points");
    expect(deltaColor(up)).toBe("green");
    // A hand-off rate going up is bad.
    expect(deltaColor(up, false)).toBe("red");
    expect(deltaColor(null)).toBe("default");
  });
});

describe("quotaBurnDown", () => {
  const period = { start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-10-31T00:00:00Z") };

  it("projects the period at the pace so far and flags going over", () => {
    const burn = quotaBurnDown({
      ...period,
      billable: 300,
      included: 500,
      now: new Date("2026-10-16T00:00:00Z"),
    });
    expect(burn).toEqual({ usedShare: 60, daysLeft: 15, projected: 600, overPace: true });
  });

  it("does not extrapolate from the first hours of a period", () => {
    const burn = quotaBurnDown({
      ...period,
      billable: 4,
      included: 500,
      now: new Date("2026-10-01T06:00:00Z"),
    });
    expect(burn.projected).toBe(4);
    expect(burn.overPace).toBe(false);
  });

  it("works without a quota", () => {
    const burn = quotaBurnDown({
      ...period,
      billable: 300,
      included: null,
      now: new Date("2026-10-16T00:00:00Z"),
    });
    expect(burn).toMatchObject({ usedShare: null, overPace: false, projected: 600 });
  });

  it("caps the bar at full once the quota is used up", () => {
    const burn = quotaBurnDown({
      ...period,
      billable: 700,
      included: 500,
      now: new Date("2026-11-02T00:00:00Z"),
    });
    expect(burn).toMatchObject({ usedShare: 100, daysLeft: 0, projected: 700 });
  });
});
