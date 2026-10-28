import { describe, it, expect, jest } from "@jest/globals";

jest.mock("@server/database/data-source", () => ({ AppDataSource: {} }));

import {
  evaluateSchedule,
  medianMinutes,
  pickSchedule,
  zonedTimeToInstant,
  type ScheduleRules,
} from "@server/services/business-hours.service";

const weekdays9to18 = [1, 2, 3, 4, 5].map((day) => ({ day, start: "09:00", end: "18:00" }));
const lisbon = (extra: Partial<ScheduleRules> = {}): ScheduleRules => ({
  timezone: "Europe/Lisbon",
  weekly_hours: weekdays9to18,
  closures: [],
  ...extra,
});

describe("evaluateSchedule", () => {
  it("is open on a weekday afternoon in the shop's timezone, not UTC", () => {
    // Tue 27 Oct 2026 14:40 Lisbon (WET, UTC+0)
    const result = evaluateSchedule(lisbon(), new Date("2026-10-27T14:40:00Z"));
    expect(result.withinHours).toBe(true);
    expect(result.nextOpening).toBeNull();
    expect(result.localTime).toBe("2026-10-27T14:40");

    // 08:30 in São Paulo is closed even though it is 11:30 UTC
    const saoPaulo = evaluateSchedule(
      { ...lisbon(), timezone: "America/Sao_Paulo" },
      new Date("2026-10-27T11:30:00Z"),
    );
    expect(saoPaulo.withinHours).toBe(false);
    expect(saoPaulo.nextOpening?.toISOString()).toBe("2026-10-27T12:00:00.000Z");
  });

  it("treats the end time as exclusive", () => {
    expect(evaluateSchedule(lisbon(), new Date("2026-10-27T18:00:00Z")).withinHours).toBe(false);
    expect(evaluateSchedule(lisbon(), new Date("2026-10-27T17:59:00Z")).withinHours).toBe(true);
  });

  it("finds Monday's opening across the autumn DST change", () => {
    // Fri 23 Oct 2026 18:30 Lisbon summer time (UTC+1); clocks go back on Sun 25 Oct
    const result = evaluateSchedule(lisbon(), new Date("2026-10-23T17:30:00Z"));
    expect(result.withinHours).toBe(false);
    // Mon 26 Oct 09:00 winter time = 09:00 UTC (not 08:00)
    expect(result.nextOpening?.toISOString()).toBe("2026-10-26T09:00:00.000Z");
  });

  it("finds Monday's opening across the spring DST change", () => {
    // Fri 27 Mar 2026 19:00 Lisbon winter time; clocks go forward on Sun 29 Mar
    const result = evaluateSchedule(lisbon(), new Date("2026-03-27T19:00:00Z"));
    expect(result.nextOpening?.toISOString()).toBe("2026-03-30T08:00:00.000Z");
  });

  it("handles an interval that runs past midnight", () => {
    const rules = lisbon({ weekly_hours: [{ day: 5, start: "22:00", end: "02:00" }] });
    // Fri 30 Oct 2026 21:00 → closed, opens at 22:00
    const before = evaluateSchedule(rules, new Date("2026-10-30T21:00:00Z"));
    expect(before.withinHours).toBe(false);
    expect(before.nextOpening?.toISOString()).toBe("2026-10-30T22:00:00.000Z");
    // Fri 23:00 and Sat 01:30 → open
    expect(evaluateSchedule(rules, new Date("2026-10-30T23:00:00Z")).withinHours).toBe(true);
    expect(evaluateSchedule(rules, new Date("2026-10-31T01:30:00Z")).withinHours).toBe(true);
    // Sat 02:00 → closed, next Friday 22:00
    const after = evaluateSchedule(rules, new Date("2026-10-31T02:00:00Z"));
    expect(after.withinHours).toBe(false);
    expect(after.nextOpening?.toISOString()).toBe("2026-11-06T22:00:00.000Z");
  });

  it("treats 24:00 as midnight, not as an overnight interval", () => {
    const rules = lisbon({ weekly_hours: [{ day: 2, start: "20:00", end: "24:00" }] });
    expect(evaluateSchedule(rules, new Date("2026-10-27T23:59:00Z")).withinHours).toBe(true);
    expect(evaluateSchedule(rules, new Date("2026-10-28T00:30:00Z")).withinHours).toBe(false);
  });

  it("stays closed on holidays and closure ranges", () => {
    const rules = lisbon({
      closures: [
        { date: "2026-10-27", label: "Holiday" },
        { date: "2026-12-24", endDate: "2026-12-28" },
      ],
    });
    const holiday = evaluateSchedule(rules, new Date("2026-10-27T10:00:00Z"));
    expect(holiday.withinHours).toBe(false);
    expect(holiday.nextOpening?.toISOString()).toBe("2026-10-28T09:00:00.000Z");

    // Thu 24 Dec → back Tue 29 Dec
    const christmas = evaluateSchedule(rules, new Date("2026-12-24T10:00:00Z"));
    expect(christmas.nextOpening?.toISOString()).toBe("2026-12-29T09:00:00.000Z");
  });

  it("opens at midnight when a closed day's overnight interval carries into the next day", () => {
    const rules = lisbon({
      weekly_hours: [{ day: 6, start: "22:00", end: "04:00" }],
      closures: [{ date: "2026-10-31" }],
    });
    const result = evaluateSchedule(rules, new Date("2026-10-31T23:00:00Z"));
    expect(result.withinHours).toBe(false);
    expect(result.nextOpening?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("never opens with no weekly hours", () => {
    const result = evaluateSchedule(lisbon({ weekly_hours: [] }), new Date("2026-10-27T10:00:00Z"));
    expect(result).toMatchObject({ withinHours: false, nextOpening: null });
  });

  it("falls back to UTC for an unknown timezone", () => {
    const result = evaluateSchedule(lisbon({ timezone: "Mars/Olympus" }), new Date());
    expect(result.timezone).toBe("UTC");
  });
});

describe("zonedTimeToInstant", () => {
  it("shifts a time inside a DST gap forward", () => {
    // 02:30 on 8 Mar 2026 never happens in New York (02:00 → 03:00 EDT)
    expect(zonedTimeToInstant(2026, 3, 8, 150, "America/New_York").toISOString()).toBe(
      "2026-03-08T07:30:00.000Z",
    );
  });

  it("takes the first of a repeated hour", () => {
    // 01:30 on 1 Nov 2026 happens twice in New York; the first is EDT (UTC-4)
    expect(zonedTimeToInstant(2026, 11, 1, 90, "America/New_York").toISOString()).toBe(
      "2026-11-01T05:30:00.000Z",
    );
  });
});

describe("pickSchedule", () => {
  const rows = [
    { id: "default", channels: [] as string[] },
    { id: "whatsapp", channels: ["whatsapp"] },
  ];
  it("prefers the channel's own schedule, then the default", () => {
    expect(pickSchedule(rows, "whatsapp")?.id).toBe("whatsapp");
    expect(pickSchedule(rows, "web")?.id).toBe("default");
    expect(pickSchedule([rows[1]], "web")).toBeNull();
  });
});

describe("medianMinutes", () => {
  it("hides the estimate without enough data", () => {
    expect(medianMinutes([1, 2, 3, 4])).toBeNull();
  });
  it("returns the rounded median, at least 1 minute", () => {
    expect(medianMinutes([3, 1, 50, 4, 2])).toBe(3);
    expect(medianMinutes([1, 2, 3, 4, 5, 6])).toBe(4);
    expect(medianMinutes([0.1, 0.2, 0.2, 0.3, 0.1])).toBe(1);
  });
});
