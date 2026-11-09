import { describe, expect, it } from "vitest";
import { sanitizeError } from "../utils/error-report";

describe("sanitizeError", () => {
  it("removes emails, tokens and phone numbers from the message", () => {
    const out = sanitizeError(
      new Error(
        "Failed for jane.doe@example.com with eyJhbGci.eyJzdWIi.c2lnbmF0dXJl and +351 912 345 678",
      ),
    );
    expect(out.message).toBe("Failed for [email] with [token] and [number]");
  });

  it("strips query strings from stack frame URLs but keeps the position", () => {
    const error = new TypeError("boom");
    error.stack = "TypeError: boom\n at f (https://app.test/_nuxt/a.js?token=abc:10:5)";
    const out = sanitizeError(error);
    expect(out.name).toBe("TypeError");
    expect(out.stack).toContain("https://app.test/_nuxt/a.js");
    expect(out.stack).not.toContain("token=abc");
  });

  it("does not send thrown values that are not errors", () => {
    expect(sanitizeError({ email: "jane@example.com" }).message).toBe("Non-Error value thrown");
  });

  it("caps the message length", () => {
    expect(sanitizeError(new Error("x ".repeat(2000))).message.length).toBe(500);
  });
});
