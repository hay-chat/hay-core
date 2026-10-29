import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseTime, parseDay, resolveWindow, matchByName, cleanEmail } = require("../lib/format");

describe("parseTime", () => {
  it.each([
    ["14:00", 840],
    ["14h", 840],
    ["14h30", 870],
    ["2pm", 840],
    ["2:30 pm", 870],
    ["12am", 0],
    ["9", 540],
    ["09.15", 555],
  ])("reads %s", (input, minutes) => {
    expect(parseTime(input)).toBe(minutes);
  });

  it("refuses what is not a time, saying the expected format", () => {
    expect(() => parseTime("afternoon")).toThrow(/HH:MM/);
  });
});

describe("parseDay / resolveWindow", () => {
  const now = new Date("2027-06-14T23:30:00Z"); // already 15 June in Lisbon

  it("reads relative days in the location's time zone", () => {
    expect(parseDay("tomorrow", "Europe/Lisbon", now)).toEqual({ year: 2027, month: 6, day: 16 });
    expect(parseDay("hoje", "Europe/Lisbon", now)).toEqual({ year: 2027, month: 6, day: 15 });
  });

  it("converts local wall time to UTC across DST", () => {
    const summer = resolveWindow({ date: "2027-06-15", start_time: "14:00" }, "Europe/Lisbon");
    expect(summer.start.toISOString()).toBe("2027-06-15T13:00:00.000Z");
    expect(summer.end.toISOString()).toBe("2027-06-15T14:00:00.000Z");
    const winter = resolveWindow(
      { date: "2027-12-15", start_time: "14:00", end_time: "15:30" },
      "Europe/Lisbon",
    );
    expect(winter.start.toISOString()).toBe("2027-12-15T14:00:00.000Z");
    expect(winter.end.toISOString()).toBe("2027-12-15T15:30:00.000Z");
  });

  it("refuses an end before the start instead of guessing", () => {
    expect(() =>
      resolveWindow({ date: "2027-06-15", start_time: "15:00", end_time: "14:00" }, "UTC"),
    ).toThrow(/not after the start/);
  });
});

describe("matchByName", () => {
  const items = [
    { id: "1", name: "Orange Room" },
    { id: "2", name: "Blue Room" },
    { id: "3", name: "Sala Açores" },
  ];
  const nameOf = (x) => x.name;

  it("matches partial, case- and accent-insensitive names", () => {
    expect(matchByName(items, "orange", nameOf).match.id).toBe("1");
    expect(matchByName(items, "acores", nameOf).match.id).toBe("3");
    expect(matchByName(items, "2", nameOf).match.id).toBe("2");
  });

  it("returns candidates instead of guessing", () => {
    const { match, candidates } = matchByName(items, "room", nameOf);
    expect(match).toBeNull();
    expect(candidates.map((c) => c.id)).toEqual(["1", "2"]);
  });
});

describe("cleanEmail", () => {
  it("trims and lowercases", () => {
    expect(cleanEmail("  Ana@Example.COM ")).toBe("ana@example.com");
  });
  it("tells the agent what to ask for", () => {
    expect(() => cleanEmail("ana")).toThrow(/Ask the member for the email/);
  });
});
