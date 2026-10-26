import { describe, expect, it } from "vitest";
import { formatWaitTime } from "./conversation";

describe("formatWaitTime", () => {
  it("shows seconds only under a minute", () => {
    expect(formatWaitTime(0)).toBe("0s");
    expect(formatWaitTime(45)).toBe("45s");
    expect(formatWaitTime(59)).toBe("59s");
  });

  it("shows minutes and seconds under an hour", () => {
    expect(formatWaitTime(60)).toBe("1m");
    expect(formatWaitTime(12 * 60 + 4)).toBe("12m 4s");
    expect(formatWaitTime(59 * 60 + 59)).toBe("59m 59s");
  });

  it("shows hours and minutes under a day, dropping seconds", () => {
    expect(formatWaitTime(3600)).toBe("1h");
    expect(formatWaitTime(5 * 3600 + 12 * 60 + 30)).toBe("5h 12m");
    expect(formatWaitTime(23 * 3600 + 59 * 60 + 59)).toBe("23h 59m");
  });

  it("shows days and hours from a day up, dropping minutes", () => {
    expect(formatWaitTime(86400)).toBe("1d");
    expect(formatWaitTime(3 * 86400 + 4 * 3600 + 50 * 60)).toBe("3d 4h");
  });

  it("stays compact for multi-month waits", () => {
    // 489579m 4s was the value shown on the inbox before the fix.
    expect(formatWaitTime(489579 * 60 + 4)).toBe("339d 23h");
    expect(formatWaitTime(100 * 86400)).toBe("100d");
  });

  it("tolerates fractional and negative input", () => {
    expect(formatWaitTime(90.9)).toBe("1m 30s");
    expect(formatWaitTime(-15)).toBe("0s");
  });
});
