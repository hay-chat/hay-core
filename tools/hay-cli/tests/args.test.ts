import { describe, expect, it } from "vitest";
import { intFlag, isUuid, parseArgs, parseDuration, UsageError } from "../src/args";
import { resolveHandler } from "../src/main";

describe("parseArgs", () => {
  it("splits positionals, valued flags and boolean flags", () => {
    const args = parseArgs([
      "chat",
      "send",
      "hi there",
      "--conversation",
      "abc",
      "--logs",
      "--json",
    ]);
    expect(args.positionals).toEqual(["chat", "send", "hi there"]);
    expect(args.flags).toEqual({ conversation: "abc", logs: true, json: true });
  });

  it("accepts --flag=value and keeps everything after -- as positionals", () => {
    const args = parseArgs(["logs", "--since=5m", "--", "--not-a-flag"]);
    expect(args.flags.since).toBe("5m");
    expect(args.positionals).toEqual(["logs", "--not-a-flag"]);
  });

  it("refuses a valued flag without a value", () => {
    expect(() => parseArgs(["logs", "--since"])).toThrow(UsageError);
    expect(() => parseArgs(["logs", "--since", "--json"])).toThrow(UsageError);
  });

  it("maps -h to help", () => {
    expect(parseArgs(["-h"]).flags.help).toBe(true);
  });

  it("validates integer flags", () => {
    expect(intFlag(parseArgs(["--limit", "5"]), "limit", 20)).toBe(5);
    expect(intFlag(parseArgs([]), "limit", 20)).toBe(20);
    expect(() => intFlag(parseArgs(["--limit", "0"]), "limit", 20)).toThrow(UsageError);
  });
});

describe("parseDuration", () => {
  it.each([
    ["500ms", 500],
    ["30", 30_000],
    ["90s", 90_000],
    ["5m", 300_000],
    ["2h", 7_200_000],
    ["1d", 86_400_000],
    ["1.5m", 90_000],
  ])("%s -> %d ms", (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it("rejects garbage", () => {
    expect(() => parseDuration("5 minutes")).toThrow(UsageError);
  });
});

describe("command routing", () => {
  it("resolves top-level and nested commands", () => {
    expect(resolveHandler(["orgs"])).toBeTypeOf("function");
    expect(resolveHandler(["chat", "send", "hi"])).toBeTypeOf("function");
    expect(resolveHandler(["chat"])).toBeUndefined();
    expect(resolveHandler(["nope"])).toBeUndefined();
  });
});

it("isUuid", () => {
  expect(isUuid("2872190a-aded-4ed0-ae6e-e0f714837df7")).toBe(true);
  expect(isUuid("5m")).toBe(false);
});
