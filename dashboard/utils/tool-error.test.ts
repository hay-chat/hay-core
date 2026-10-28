import { describe, it, expect } from "vitest";
import { parseToolError } from "./tool-error";

const error = { code: "PRECONDITION", retryable: false, message: "x", details: { reason: "ALREADY_SHIPPED" } };

describe("parseToolError", () => {
  it("reads a JSON string, an object and an MCP content array", () => {
    const expected = { code: "PRECONDITION", reason: "ALREADY_SHIPPED" };
    expect(parseToolError(JSON.stringify(error))).toEqual(expected);
    expect(parseToolError(error)).toEqual(expected);
    expect(parseToolError({ content: [{ type: "text", text: JSON.stringify(error) }] })).toEqual(
      expected,
    );
  });

  it("falls back to the stored error code and ignores free text", () => {
    expect(parseToolError({ error: "boom", errorType: "Error" }, "AUTH_FAILED")).toEqual({
      code: "AUTH_FAILED",
      reason: null,
    });
    expect(parseToolError("not json")).toEqual({ code: null, reason: null });
    expect(parseToolError({ code: "rm -rf", details: { reason: "<b>" } })).toEqual({
      code: null,
      reason: null,
    });
  });
});

describe("failure copy (en + pt-BR)", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const { TOOL_ERROR_CODES } = require("../../packages/plugin-sdk/tool-errors/index.cjs");
  const en = (await import("../i18n/locales/en/actions.json")).default.aiActions.toolErrors;
  const pt = (await import("../i18n/locales/pt-BR/actions.json")).default.aiActions.toolErrors;

  it("has a plain-language line for every tool-errors code", () => {
    for (const code of Object.keys(TOOL_ERROR_CODES)) {
      expect(en.codes).toHaveProperty(code);
      expect(pt.codes).toHaveProperty(code);
    }
  });

  it("has the same reasons and codes in both languages", () => {
    expect(Object.keys(pt.reasons).sort()).toEqual(Object.keys(en.reasons).sort());
    expect(Object.keys(pt.codes).sort()).toEqual(Object.keys(en.codes).sort());
  });
});
