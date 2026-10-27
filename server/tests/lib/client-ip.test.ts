import { describe, it, expect } from "@jest/globals";
import { getClientIp } from "@server/lib/client-ip";

describe("getClientIp", () => {
  it("uses the first X-Forwarded-For entry", () => {
    expect(getClientIp({ "x-forwarded-for": "203.0.113.7, 10.0.0.2" }, "10.0.0.1")).toBe(
      "203.0.113.7",
    );
  });

  it("falls back to X-Real-IP, then the socket peer", () => {
    expect(getClientIp({ "x-real-ip": "203.0.113.8" }, "10.0.0.1")).toBe("203.0.113.8");
    expect(getClientIp({}, "10.0.0.1")).toBe("10.0.0.1");
    expect(getClientIp({})).toBe("Unknown");
  });
});
