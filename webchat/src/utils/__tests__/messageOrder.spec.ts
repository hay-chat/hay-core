import { describe, it, expect } from "vitest";
import { insertMessage, parseServerTime } from "../messageOrder";
import type { Message } from "@/types";

const at = (iso: string) => new Date(iso).getTime();
const greeting = (ts: number): Message => ({
  id: "greeting",
  sender: "agent",
  content: "Hello!",
  timestamp: ts,
  isGreeting: true,
});
const server = (id: string, iso: string, sender: Message["sender"] = "agent"): Message => ({
  id,
  sender,
  content: id,
  timestamp: at(iso),
});

describe("parseServerTime", () => {
  it("reads zone-less server strings as UTC", () => {
    expect(parseServerTime("2026-10-27T10:00:00")).toBe(at("2026-10-27T10:00:00Z"));
    expect(parseServerTime("2026-10-27T10:00:00.123Z")).toBe(at("2026-10-27T10:00:00.123Z"));
    expect(parseServerTime("2026-10-27T12:00:00+02:00")).toBe(at("2026-10-27T10:00:00Z"));
  });

  it("falls back when the value is missing or unparseable", () => {
    expect(parseServerTime(undefined, 42)).toBe(42);
    expect(parseServerTime("not a date", 42)).toBe(42);
  });
});

describe("insertMessage", () => {
  it("keeps the greeting first even when an agent message is older than it", () => {
    // Greeting stamped by a clock that ran ahead; the first agent message
    // has an earlier server time. It must still render below the greeting.
    const list: Message[] = [greeting(at("2026-10-27T12:00:00Z"))];
    insertMessage(list, server("handoff", "2026-10-27T10:00:05Z"));
    expect(list.map((m) => m.id)).toEqual(["greeting", "handoff"]);
  });

  it("never replaces the greeting with the first agent message", () => {
    const list: Message[] = [greeting(at("2026-10-27T10:00:00Z"))];
    insertMessage(list, server("a1", "2026-10-27T10:00:05Z"));
    insertMessage(list, server("a2", "2026-10-27T10:00:06Z"));
    expect(list.map((m) => m.id)).toEqual(["greeting", "a1", "a2"]);
  });

  it("keeps server order when server messages arrive out of order", () => {
    const list: Message[] = [greeting(at("2026-10-27T10:00:00Z"))];
    insertMessage(list, server("a2", "2026-10-27T10:00:06Z"));
    insertMessage(list, server("a1", "2026-10-27T10:00:05Z"));
    expect(list.map((m) => m.id)).toEqual(["greeting", "a1", "a2"]);
  });

  it("does not move a server message above an optimistic message on a skewed clock", () => {
    // The browser clock is two hours fast, so the optimistic message looks
    // "newer" than the reply. Clocks are not compared: the reply goes after it.
    const list: Message[] = [
      greeting(at("2026-10-27T10:00:00Z")),
      { id: "temp-1", sender: "user", content: "hi", timestamp: at("2026-10-27T12:00:00Z") },
    ];
    insertMessage(list, server("reply", "2026-10-27T10:00:05Z"));
    expect(list.map((m) => m.id)).toEqual(["greeting", "temp-1", "reply"]);
  });

  it("re-pins a greeting to the top if one is added later", () => {
    const list: Message[] = [server("a1", "2026-10-27T10:00:05Z")];
    insertMessage(list, greeting(at("2026-10-27T10:00:05Z")));
    expect(list.map((m) => m.id)).toEqual(["greeting", "a1"]);
  });

  it("replaces the local greeting with the server's greeting, keeping it first", () => {
    const list: Message[] = [
      greeting(at("2026-10-27T10:00:00Z")),
      { id: "temp-1", sender: "user", content: "hi", timestamp: at("2026-10-27T12:00:00Z") },
    ];
    insertMessage(list, { ...server("g1", "2026-10-27T10:00:01Z"), metadata: { isGreeting: true } });
    expect(list.map((m) => m.id)).toEqual(["g1", "temp-1"]);
    expect(list[0].isGreeting).toBe(true);
  });

  it("does not put the local greeting back over the server's greeting", () => {
    const list: Message[] = [];
    insertMessage(list, { ...server("g1", "2026-10-27T10:00:01Z"), metadata: { isGreeting: true } });
    insertMessage(list, server("a1", "2026-10-27T10:00:05Z"));
    insertMessage(list, greeting(at("2026-10-27T10:00:01Z")));
    expect(list.map((m) => m.id)).toEqual(["g1", "a1"]);
  });
});
