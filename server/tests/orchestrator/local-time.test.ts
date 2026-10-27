import { describe, it, expect } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { describeLocalTime } from "../../orchestrator/local-time";
import { VariableEngine } from "../../utils/variable-engine";

/** D5-3: the planner knows the business's local date and hour. */

// 27 Oct 2026 17:20 UTC = 14:20 in São Paulo (UTC-3, no DST).
const NOW = new Date("2026-10-27T17:20:00Z");

describe("describeLocalTime", () => {
  it("renders the organization's local weekday, date and hour window", () => {
    expect(describeLocalTime("America/Sao_Paulo", NOW)).toEqual({
      timezone: "America/Sao_Paulo",
      localTime: "Tuesday, 27 October 2026, between 14:00 and 15:00 (GMT-3)",
    });
  });

  it("rolls the date over in zones ahead of UTC", () => {
    // 17:20 UTC = 06:20 next day in Auckland (UTC+13 in NZ summer time).
    expect(describeLocalTime("Pacific/Auckland", NOW).localTime).toBe(
      "Wednesday, 28 October 2026, between 06:00 and 07:00 (GMT+13)",
    );
  });

  it("wraps the window past midnight", () => {
    const lateNight = new Date("2026-10-27T23:30:00Z");
    expect(describeLocalTime("UTC", lateNight).localTime).toBe(
      "Tuesday, 27 October 2026, between 23:00 and 00:00 (GMT)",
    );
  });

  it("falls back to UTC for a missing or invalid zone", () => {
    expect(describeLocalTime(null, NOW).timezone).toBe("UTC");
    expect(describeLocalTime("Mars/Olympus_Mons", NOW)).toEqual({
      timezone: "UTC",
      localTime: "Tuesday, 27 October 2026, between 17:00 and 18:00 (GMT)",
    });
  });

  it("stays the same within the hour, so the cached planner prompt does not churn", () => {
    const a = describeLocalTime("Europe/Lisbon", new Date("2026-10-27T10:01:00Z"));
    const b = describeLocalTime("Europe/Lisbon", new Date("2026-10-27T10:59:00Z"));
    expect(a).toEqual(b);
  });
});

describe("planner prompt", () => {
  it.each(["en", "pt"])("renders the local time block (%s)", (language) => {
    const template = fs.readFileSync(
      path.join(__dirname, `../../prompts/${language}/execution/planner.md`),
      "utf8",
    );
    const rendered = VariableEngine.render(template, {
      hasTools: false,
      tools: "",
      toolsDetail: "",
      ...describeLocalTime("America/Sao_Paulo", NOW),
    });
    expect(rendered).toContain("between 14:00 and 15:00 (GMT-3)");
    expect(rendered).toContain("America/Sao_Paulo");
    expect(rendered).not.toMatch(/\{\{\s*(localTime|timezone)\s*\}\}/);
  });
});
