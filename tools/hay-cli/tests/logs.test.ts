import { describe, expect, it } from "vitest";
import { filterEntries, formatEntry, parseEntry, splitEntries } from "../src/logs";

const CONV = "2872190a-aded-4ed0-ae6e-e0f714837df7";
const OTHER = "5ebfff1c-168c-49c8-a33f-35edeeec9c95";

const json = (time: string, conversationId: string | undefined, msg: string, extra = {}) =>
  JSON.stringify({
    level: 20,
    time,
    pid: 1,
    hostname: "h",
    module: "orchestrator-run",
    ...(conversationId ? { conversationId } : {}),
    ...extra,
    msg,
  });

describe("splitEntries", () => {
  it("joins indented pino-pretty continuation lines to their header", () => {
    const text = [
      "[2026-10-29 13:58:16.317 +0000] DEBUG (orchestrator-queue): Enqueued",
      `    conversationId: "${CONV}"`,
      "[2026-10-29 13:58:17.000 +0000] INFO (other): unrelated",
      "",
    ].join("\n");
    const entries = splitEntries(text);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toContain(CONV);
  });
});

describe("parseEntry", () => {
  it("reads pino JSON lines", () => {
    const entry = parseEntry(
      json("2026-10-29T13:58:16.317Z", CONV, "Bot message sent", { durationMs: 26 }),
    );
    expect(entry).toMatchObject({
      time: "2026-10-29T13:58:16.317Z",
      level: "DEBUG",
      module: "orchestrator-run",
      msg: "Bot message sent",
      fields: { conversationId: CONV, durationMs: 26 },
    });
  });

  it("reads the time of pino-pretty lines", () => {
    expect(parseEntry("[2026-10-29 13:58:16.317 +0000] DEBUG (x): y").time).toBe(
      "2026-10-29T13:58:16.317Z",
    );
  });

  it("keeps unparseable lines raw", () => {
    expect(parseEntry("npm ERR! something")).toEqual({ raw: "npm ERR! something" });
  });
});

describe("filterEntries", () => {
  const entries = [
    json("2026-10-29T13:58:10.000Z", CONV, "too early"),
    json("2026-10-29T13:58:16.000Z", CONV, "mine"),
    json("2026-10-29T13:58:17.000Z", OTHER, "someone else"),
    json("2026-10-29T13:58:18.000Z", undefined, "mentions it", { ids: [CONV] }),
    "a crash line without time",
  ].map(parseEntry);
  const since = Date.parse("2026-10-29T13:58:15.000Z");

  it("keeps lines that mention the conversation after the start time", () => {
    const kept = filterEntries(entries, { conversationId: CONV, sinceMs: since });
    expect(kept.map((e) => e.msg)).toEqual(["mine", "mentions it"]);
  });

  it("without a conversation keeps timeless lines and honours the limit", () => {
    const kept = filterEntries(entries, { sinceMs: since, limit: 2 });
    expect(kept.map((e) => e.msg ?? e.raw)).toEqual(["mentions it", "a crash line without time"]);
  });
});

describe("formatEntry", () => {
  it("prints one compact line and drops implied fields", () => {
    const line = formatEntry(
      parseEntry(
        json("2026-10-29T13:58:16.317Z", CONV, "Perception analysis complete", {
          intent: "question",
          err: { type: "TRPCError", message: "boom", stack: "long" },
        }),
      ),
      { omit: ["conversationId"] },
    );
    expect(line).toBe(
      "13:58:16.317 DEBUG orchestrator-run Perception analysis complete intent=question err=TRPCError: boom",
    );
  });

  it("truncates long values unless verbose", () => {
    const entry = parseEntry(json("2026-10-29T13:58:16.317Z", CONV, "m", { big: "x".repeat(500) }));
    expect(formatEntry(entry).length).toBeLessThan(250);
    expect(formatEntry(entry, { verbose: true })).toContain("x".repeat(500));
  });
});
