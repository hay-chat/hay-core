import { describe, it, expect, jest } from "@jest/globals";

jest.mock("@server/lib/logger", () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { createLogger: () => log };
});

import { calculateDateTool, addDays } from "../../services/core/core-tools/calculate-date";

const conversation = (language = "en", timezone = "UTC") =>
  ({ language, organization: { timezone } }) as never;
const date = (iso: string) => new Date(`${iso}T12:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("addDays", () => {
  it("does not count the start day and skips weekends", () => {
    expect(iso(addDays(date("2026-11-09"), 3, "business_days"))).toBe("2026-11-12");
    expect(iso(addDays(date("2026-11-09"), 9, "business_days"))).toBe("2026-11-20");
    expect(iso(addDays(date("2026-11-09"), 7, "business_days"))).toBe("2026-11-18");
  });

  it("moves a weekend start to the next working days", () => {
    expect(iso(addDays(date("2026-11-07"), 1, "business_days"))).toBe("2026-11-09");
  });

  it("counts calendar days straight", () => {
    expect(iso(addDays(date("2026-11-28"), 5, "calendar_days"))).toBe("2026-12-03");
  });

  it("add 0 keeps the date", () => {
    expect(iso(addDays(date("2026-11-08"), 0, "business_days"))).toBe("2026-11-08");
  });
});

describe("calculate_date", () => {
  it("returns both ends of a window from one call", async () => {
    const result = await calculateDateTool.execute(conversation(), {
      dates: [
        { from: "2026-11-09T11:26:21Z", add: 3, unit: "business_days" },
        { from: "2026-11-09T11:26:21Z", add: 9, unit: "business_days" },
      ],
    });
    expect(result).toMatchObject({
      results: [
        { date: "2026-11-12", label: "Thursday, 12 November 2026" },
        { date: "2026-11-20", label: "Friday, 20 November 2026" },
      ],
    });
  });

  it("labels dates in the customer's language", async () => {
    const result = (await calculateDateTool.execute(conversation("pt"), {
      dates: [{ from: "2026-11-12", add: 0, unit: "calendar_days" }],
    })) as { results: { label: string }[] };
    expect(result.results[0].label).toBe("quinta-feira, 12 de novembro de 2026");
  });

  it("reads a timestamp as the shop's local day", async () => {
    const result = (await calculateDateTool.execute(conversation("en", "America/New_York"), {
      dates: [{ from: "2026-10-21T01:00:00Z", add: 0, unit: "calendar_days" }],
    })) as { results: { date: string }[] };
    expect(result.results[0].date).toBe("2026-10-20");
  });

  it("reports a bad input without failing the others", async () => {
    const result = (await calculateDateTool.execute(conversation(), {
      dates: [
        { from: "soon", add: 1, unit: "business_days" },
        { from: "2026-11-09", add: 1, unit: "business_days" },
      ],
    })) as { results: { error?: string; date?: string }[] };
    expect(result.results[0].error).toBeDefined();
    expect(result.results[1].date).toBe("2026-11-10");
  });
});
