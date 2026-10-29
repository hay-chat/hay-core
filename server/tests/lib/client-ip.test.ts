import { describe, it, expect } from "@jest/globals";
import { getClientIp } from "@server/lib/client-ip";

describe("getClientIp", () => {
  it("takes the address our proxy appended, not client-supplied entries", () => {
    // nginx appends the peer it saw to whatever X-Forwarded-For the client sent.
    expect(getClientIp({ "x-forwarded-for": "198.51.100.1, 203.0.113.7" }, "10.0.0.1", 1)).toBe(
      "203.0.113.7",
    );
    expect(getClientIp({ "x-forwarded-for": "203.0.113.7" }, "10.0.0.1", 1)).toBe("203.0.113.7");
  });

  it("walks back one entry per trusted hop", () => {
    expect(
      getClientIp({ "x-forwarded-for": "198.51.100.1, 203.0.113.7, 10.0.0.3" }, "10.0.0.1", 2),
    ).toBe("203.0.113.7");
  });

  it("ignores forwarding headers when no proxy is trusted", () => {
    expect(getClientIp({ "x-forwarded-for": "203.0.113.7" }, "10.0.0.1", 0)).toBe("10.0.0.1");
    expect(getClientIp({ "x-real-ip": "203.0.113.8" }, "10.0.0.1", 1)).toBe("10.0.0.1");
  });

  it("falls back to the leftmost address when the chain is shorter than the hops", () => {
    expect(getClientIp({}, "10.0.0.1", 1)).toBe("10.0.0.1");
    expect(getClientIp({}, undefined, 1)).toBe("Unknown");
  });
});
