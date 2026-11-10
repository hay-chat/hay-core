import { describe, it, expect } from "@jest/globals";
import { assessReplyDates, extractReplyDates } from "../../services/core/date-guardrail.service";

const now = new Date("2026-11-09T21:50:00Z"); // A Monday
const assess = (response: string, contextTexts: string[] = []) =>
  assessReplyDates({
    dates: extractReplyDates(response),
    contextTexts,
    timezone: "UTC",
    now,
  });
const reasons = (response: string, contextTexts: string[] = []) =>
  assess(response, contextTexts).map((date) => date.reason);

describe("extractReplyDates", () => {
  it.each([
    "Your order will arrive in 3–7 business days.",
    "We're open 24/7 and rated 3/5 by no one.",
    "3 out of 5 items shipped, 1 may be delayed, 2 set aside.",
    "Your total is $25 and order #12 is on its way.",
    "Set 4 Linen Napkins are in stock.",
    "See you at 10:30 on Friday.",
  ])("finds no date in %s", (text) => {
    expect(extractReplyDates(text)).toEqual([]);
  });

  it.each([
    ["Monday 9 November", 1],
    ["Monday, November 9th, 2026", 1],
    ["Friday the 21st of November", 5],
    ["segunda-feira, 9 de novembro de 2026", 1],
    ["sábado, 21 de novembro", 6],
    ["lunes 9 de noviembre", 1],
  ])("reads %s with its weekday", (text, weekday) => {
    const [date] = extractReplyDates(text);
    expect(date.weekday).toBe(weekday);
  });

  it.each([
    "between 12 and 20 November",
    "12–20 November",
    "12-20 November",
    "Nov 12-20",
    "entre 12 e 20 de novembro",
    "del 12 al 20 de noviembre",
    "Thursday 12 to Friday 20 November",
  ])("reads both ends of %s", (text) => {
    const days = extractReplyDates(text).map((date) => date.candidates[0].day);
    expect(days).toEqual([12, 20]);
  });

  it("reads a cued short numeric date as either day/month or month/day", () => {
    const [date] = extractReplyDates("Chega até 18/11.");
    expect(date.candidates).toEqual([{ day: 18, month: 11, year: undefined }]);
    expect(extractReplyDates("Chega dia 5/11.")[0].candidates).toHaveLength(2);
  });
});

describe("assessReplyDates: the replies from the investigation", () => {
  const orderTool = '{"createdAt":"2026-11-09T11:26:21Z","estimatedDeliveryAt":null}';
  const shippedTool = '{"shippedAt":"2026-11-09T11:41:49Z","estimatedDeliveryAt":null}';

  it("catches every bad date in reply A and passes today's", () => {
    const bad = assess(
      "Order #1001 was placed on Sunday 9 November. Since today is Monday 9 November, it should " +
        "ship by Wednesday 11 November at the latest. Delivery between Tuesday 17 November and " +
        "Tuesday 25 November.",
      [orderTool],
    );
    expect(bad).toEqual([
      { raw: "Sunday 9 November", reason: "wrong_weekday", actualWeekday: "Monday" },
      { raw: "Wednesday 11 November", reason: "unsourced" },
      { raw: "Tuesday 17 November", reason: "unsourced" },
      { raw: "Tuesday 25 November", reason: "wrong_weekday", actualWeekday: "Wednesday" },
    ]);
  });

  it("catches reply B's date and accepts the shipped date", () => {
    expect(
      assess("Shipped today (9 Nov). You should receive it by Friday 21 November.", [shippedTool]),
    ).toEqual([{ raw: "Friday 21 November", reason: "wrong_weekday", actualWeekday: "Saturday" }]);
  });

  it("accepts a date quoted from the order", () => {
    expect(
      reasons("It was cancelled on Monday, 9 November 2026.", [
        '{"cancelledAt":"2026-11-09T10:00:00Z"}',
      ]),
    ).toEqual([]);
  });
});

describe("assessReplyDates: sources", () => {
  const calculated = '{"results":[{"date":"2026-11-12","label":"Thursday, 12 November 2026"}]}';

  it("accepts a calculate_date result", () => {
    expect(reasons("Delivery from Thursday 12 November.", [calculated])).toEqual([]);
  });

  it("accepts a date the customer or a document gave", () => {
    expect(reasons("We'll aim for 24 December.", ["I need it by 24 December"])).toEqual([]);
    expect(reasons("The sale ends 30 November.", ["Sale until November 30."])).toEqual([]);
  });

  it("accepts yesterday, today and tomorrow, and nothing further", () => {
    expect(reasons("8 November, 9 November, 10 November")).toEqual([]);
    expect(reasons("11 November")).toEqual(["unsourced"]);
  });

  it("uses the shop's day for a timestamp near midnight", () => {
    const bad = assessReplyDates({
      dates: extractReplyDates("It shipped on 20 October."),
      contextTexts: ['{"shippedAt":"2026-10-21T01:00:00Z"}'],
      timezone: "America/New_York",
      now,
    });
    expect(bad).toEqual([]);
  });

  it("flags impossible dates whatever the sources say", () => {
    expect(reasons("31 November", ["31 November"])).toEqual(["impossible"]);
  });

  it("flags a wrong weekday even on a sourced date", () => {
    expect(reasons("Sunday 12 November", ["2026-11-12"])).toEqual(["wrong_weekday"]);
  });

  it("reads a date in January as next year when it is nearer", () => {
    const december = new Date("2026-12-20T12:00:00Z");
    const bad = assessReplyDates({
      dates: extractReplyDates("Friday 1 January"), // 2027-01-01 is a Friday
      contextTexts: ["2027-01-01"],
      timezone: "UTC",
      now: december,
    });
    expect(bad).toEqual([]);
  });

  it("passes a numeric date if either reading works", () => {
    expect(reasons("Chega dia 5/11.", ["2026-11-05"])).toEqual([]);
  });
});
