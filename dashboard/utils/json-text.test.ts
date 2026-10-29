import { describe, it, expect } from "vitest";
import { unwrapJsonText } from "./json-text";

const error = { code: "BAD_INPUT", retryable: false, details: { errors: [{ line: 2 }] } };

describe("unwrapJsonText", () => {
  it("parses a JSON string, including a double-encoded one", () => {
    expect(unwrapJsonText(JSON.stringify(error))).toEqual(error);
    expect(unwrapJsonText(JSON.stringify(JSON.stringify(error)))).toEqual(error);
    expect(unwrapJsonText(`  ${JSON.stringify(error)}\n`)).toEqual(error);
  });

  it("parses JSON strings nested in objects and arrays", () => {
    expect(unwrapJsonText({ error: JSON.stringify(error) })).toEqual({ error });
    expect(unwrapJsonText([JSON.stringify([1, 2])])).toEqual([[1, 2]]);
  });

  it("leaves plain text, invalid JSON and non-strings alone", () => {
    expect(unwrapJsonText("No order named #1005")).toBe("No order named #1005");
    expect(unwrapJsonText("{not json}")).toBe("{not json}");
    expect(unwrapJsonText("1005")).toBe("1005");
    expect(unwrapJsonText(42)).toBe(42);
    expect(unwrapJsonText(null)).toBe(null);
  });
});
