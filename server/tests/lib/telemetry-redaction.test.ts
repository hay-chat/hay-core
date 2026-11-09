import { describe, it, expect } from "@jest/globals";
import { redactedError } from "@server/lib/telemetry";

describe("redactedError", () => {
  it("removes an email from the message and stack and keeps the error type", () => {
    const error = new TypeError("no user for jane.doe@example.com");

    const redacted = redactedError(error);

    expect(redacted.name).toBe("TypeError");
    expect(redacted.message).not.toContain("jane.doe@example.com");
    expect(redacted.stack).not.toContain("jane.doe@example.com");
  });

  it("redacts thrown strings", () => {
    expect(redactedError("failed for jane.doe@example.com").message).not.toContain(
      "jane.doe@example.com",
    );
  });

  it("never forwards the contents of other thrown values", () => {
    expect(redactedError({ email: "jane.doe@example.com" }).message).toBe("Non-Error exception");
  });
});
