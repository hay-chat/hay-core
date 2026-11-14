import { describe, it, expect } from "@jest/globals";
import {
  percentage,
  previousRange,
  summarizeHandoffs,
  toCsv,
} from "../../services/analytics-reports.service";

describe("previousRange", () => {
  it("is the range of the same length ending where the current one starts", () => {
    const range = {
      start: new Date("2026-10-08T00:00:00Z"),
      end: new Date("2026-10-15T00:00:00Z"),
    };
    expect(previousRange(range)).toEqual({
      start: new Date("2026-10-01T00:00:00Z"),
      end: new Date("2026-10-08T00:00:00Z"),
    });
  });
});

describe("percentage", () => {
  it("is null with nothing to divide by, so an empty period never reads as 0%", () => {
    expect(percentage(0, 0)).toBeNull();
    expect(percentage(1, 4)).toBe(25);
  });
});

describe("summarizeHandoffs", () => {
  const report = summarizeHandoffs({
    closes: 20,
    cells: [
      { date: "2026-10-01", reason: "playbook", count: 2 },
      { date: "2026-10-01", reason: "low_confidence", count: 3 },
      { date: "2026-10-02", reason: "low_confidence", count: 1 },
      { date: "2026-10-02", reason: "customer_request", count: 1 },
      { date: "2026-10-02", reason: "not_recorded", count: 1 },
    ],
  });

  it("totals hand-offs and their categories", () => {
    expect(report.summary).toEqual({
      closes: 20,
      handedOff: 8,
      handoffRate: 40,
      categories: { planned: 2, customer_asked: 1, fallback: 4, not_recorded: 1 },
    });
  });

  it("lists reasons most common first, with their share of hand-offs", () => {
    expect(report.reasons.map((r) => [r.reason, r.category, r.count, r.share])).toEqual([
      ["low_confidence", "fallback", 4, 50],
      ["playbook", "planned", 2, 25],
      ["customer_request", "customer_asked", 1, 12.5],
      ["not_recorded", "not_recorded", 1, 12.5],
    ]);
  });

  it("gives one trend point per day", () => {
    expect(report.trend).toEqual([
      { date: "2026-10-01", planned: 2, customer_asked: 0, fallback: 3, not_recorded: 0 },
      { date: "2026-10-02", planned: 0, customer_asked: 1, fallback: 1, not_recorded: 1 },
    ]);
  });

  it("has no rate when nothing closed", () => {
    expect(summarizeHandoffs({ closes: 0, cells: [] }).summary.handoffRate).toBeNull();
  });
});

describe("toCsv", () => {
  it("quotes commas and defuses cells a spreadsheet would run as a formula", () => {
    expect(
      toCsv(
        ["topic", "closes"],
        [
          ["returns, refunds", 3],
          ["=HYPERLINK(1)", 1],
          [null, 0],
        ],
      ),
    ).toBe(`topic,closes\n"returns, refunds",3\n'=HYPERLINK(1),1\n,0`);
  });
});
