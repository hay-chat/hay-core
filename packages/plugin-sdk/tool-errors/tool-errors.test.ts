import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import {
  TOOL_ERROR_CODES,
  ToolError,
  toolError,
  isToolError,
  toToolError,
  toolErrorResult,
  codeForHttpStatus,
  codeForNetworkFailure,
} from "./index.cjs";

describe("tool-errors", () => {
  it("can be required from CommonJS (local MCP servers are CJS)", () => {
    const require = createRequire(import.meta.url);
    const cjs = require("./index.cjs");
    expect(typeof cjs.toolErrorResult).toBe("function");
    expect(Object.keys(cjs.TOOL_ERROR_CODES)).toEqual(Object.keys(TOOL_ERROR_CODES));
  });

  it("defaults retryable from the code and allows an override", () => {
    expect(toolError("RATE_LIMITED", "slow down").retryable).toBe(true);
    expect(toolError("PRECONDITION", "already shipped").retryable).toBe(false);
    expect(toolError("PROVIDER_DOWN", "x", { retryable: false }).retryable).toBe(false);
  });

  it("rejects codes outside the vocabulary", () => {
    expect(() => new ToolError("NOPE" as never, "x")).toThrow(/Unknown tool error code/);
  });

  it("renders an MCP error result with the JSON payload", () => {
    const res = toolErrorResult(
      toolError("PRECONDITION", "Order #1001 has already shipped.", {
        details: { reason: "ALREADY_SHIPPED" },
      }),
    );
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text)).toEqual({
      code: "PRECONDITION",
      retryable: false,
      message: "Order #1001 has already shipped.",
      details: { reason: "ALREADY_SHIPPED" },
    });
  });

  it("treats unknown errors as INTERNAL and keeps the message", () => {
    const res = toolErrorResult(new Error("boom"));
    expect(JSON.parse(res.content[0].text)).toEqual({
      code: "INTERNAL",
      retryable: false,
      message: "boom",
    });
    expect(toToolError("plain string").message).toBe("plain string");
  });

  it("recognises a ToolError from another copy of the module by shape", () => {
    const foreign = Object.assign(new Error("x"), { name: "ToolError", code: "NOT_FOUND" });
    expect(isToolError(foreign)).toBe(true);
    expect(isToolError(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe(false);
  });

  it("maps HTTP statuses, treating a failed write as OUTCOME_UNKNOWN", () => {
    expect(codeForHttpStatus(400, { idempotent: true })).toBe("BAD_INPUT");
    expect(codeForHttpStatus(401, { idempotent: true })).toBe("AUTH_FAILED");
    expect(codeForHttpStatus(403, { idempotent: false })).toBe("SCOPE_MISSING");
    expect(codeForHttpStatus(404, { idempotent: true })).toBe("NOT_FOUND");
    expect(codeForHttpStatus(429, { idempotent: false })).toBe("RATE_LIMITED");
    expect(codeForHttpStatus(503, { idempotent: true })).toBe("PROVIDER_DOWN");
    expect(codeForHttpStatus(503, { idempotent: false })).toBe("OUTCOME_UNKNOWN");
    expect(codeForHttpStatus(402, { idempotent: true })).toBe("PROVIDER_REFUSED");
    expect(codeForNetworkFailure({ idempotent: true })).toBe("PROVIDER_DOWN");
    expect(codeForNetworkFailure({ idempotent: false })).toBe("OUTCOME_UNKNOWN");
  });
});
