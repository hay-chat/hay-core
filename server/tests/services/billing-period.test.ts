import { describe, it, expect } from "@jest/globals";
import { billingPeriodFor } from "../../services/resolution-ledger.service";

const d = (iso: string) => new Date(iso);

describe("billingPeriodFor (Lane A1)", () => {
  it("uses UTC calendar months without an operator period", () => {
    const now = d("2026-10-28T12:00:00Z");
    expect(billingPeriodFor(null, 0, now)).toEqual({
      index: 0,
      start: d("2026-10-01T00:00:00Z"),
      end: d("2026-11-01T00:00:00Z"),
      source: "calendar",
    });
    expect(billingPeriodFor(null, 10, now).start).toEqual(d("2025-12-01T00:00:00Z"));
  });

  it("returns the operator period itself while it is current", () => {
    const anchor = { start: d("2026-10-14T09:30:00Z"), end: d("2026-11-14T09:30:00Z") };
    const period = billingPeriodFor(anchor, 0, d("2026-10-28T12:00:00Z"));
    expect(period).toEqual({ index: 0, ...anchor, source: "billing" });
  });

  it("steps back by the period length, keeping the time of day", () => {
    const anchor = { start: d("2026-10-14T09:30:00Z"), end: d("2026-11-14T09:30:00Z") };
    const previous = billingPeriodFor(anchor, 1, d("2026-10-28T12:00:00Z"));
    expect(previous.start).toEqual(d("2026-09-14T09:30:00Z"));
    expect(previous.end).toEqual(anchor.start);
  });

  it("rolls a stale anchor forward to the period containing now", () => {
    const anchor = { start: d("2026-08-14T09:30:00Z"), end: d("2026-09-14T09:30:00Z") };
    const current = billingPeriodFor(anchor, 0, d("2026-10-28T12:00:00Z"));
    expect(current.start).toEqual(d("2026-10-14T09:30:00Z"));
    expect(current.end).toEqual(d("2026-11-14T09:30:00Z"));
    expect(billingPeriodFor(anchor, 0, d("2026-10-14T09:30:00Z")).start).toEqual(current.start);
  });

  it("handles annual periods and month-end anchors", () => {
    const annual = { start: d("2026-03-05T00:00:00Z"), end: d("2027-03-05T00:00:00Z") };
    expect(billingPeriodFor(annual, 1, d("2026-10-28T00:00:00Z")).start).toEqual(
      d("2025-03-05T00:00:00Z"),
    );
    const monthEnd = { start: d("2026-01-31T00:00:00Z"), end: d("2026-02-28T00:00:00Z") };
    const march = billingPeriodFor(monthEnd, 0, d("2026-03-15T00:00:00Z"));
    expect(march.start).toEqual(d("2026-02-28T00:00:00Z"));
    expect(march.end).toEqual(d("2026-03-31T00:00:00Z"));
  });
});
