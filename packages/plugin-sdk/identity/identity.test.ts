import { describe, it, expect } from "vitest";
import { matchIdentity, hasIdentity, samePhone } from "./index.cjs";

describe("identity", () => {
  const onOrder = { emails: ["Ana@Example.com", null], phones: ["+55 (11) 98765-4321"] };

  it("matches email case-insensitively and phone by its last 8 digits", () => {
    expect(matchIdentity(onOrder, { email: " ana@example.com " })).toBe("email");
    expect(matchIdentity(onOrder, { phone: "11987654321" })).toBe("phone");
    expect(matchIdentity(onOrder, { email: "x@y.z", phone: "1234" })).toBeNull();
  });

  it("needs a real email or a phone with at least 8 digits", () => {
    expect(hasIdentity({})).toBe(false);
    expect(hasIdentity({ phone: "123" })).toBe(false);
    expect(hasIdentity({ phone: "98765-4321" })).toBe(true);
    expect(samePhone("", "")).toBe(false);
  });
});
