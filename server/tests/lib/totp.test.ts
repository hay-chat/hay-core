import { describe, it, expect } from "@jest/globals";
import {
  base32Decode,
  base32Encode,
  findTotpStep,
  generateTotpSecret,
  totpCode,
  totpProvisioningUri,
  totpStepAt,
} from "../../lib/auth/totp";

// RFC 6238 appendix B, SHA-1 column.
const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");
const RFC_VECTORS: Array<[number, string]> = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("totp", () => {
  it.each(RFC_VECTORS)("matches the RFC 6238 vector at t=%d", (seconds, expected) => {
    expect(totpCode(RFC_SECRET, totpStepAt(seconds * 1000), 8)).toBe(expected);
  });

  it("round-trips base32 with the RFC 4648 alphabet", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Decode("MZXW6YTBOI").toString()).toBe("foobar");
    expect(() => base32Decode("not-base32!")).toThrow();
  });

  describe("findTotpStep", () => {
    const secret = generateTotpSecret();
    const now = 1_800_000_000_000;
    const step = totpStepAt(now);
    const codeAt = (s: number) => totpCode(base32Decode(secret), s);

    it("accepts the current step and one either side", () => {
      expect(findTotpStep(secret, codeAt(step), now)).toBe(step);
      expect(findTotpStep(secret, codeAt(step - 1), now)).toBe(step - 1);
      expect(findTotpStep(secret, codeAt(step + 1), now)).toBe(step + 1);
    });

    it("refuses codes outside the window and wrong codes", () => {
      expect(findTotpStep(secret, codeAt(step - 2), now)).toBeNull();
      expect(findTotpStep(secret, codeAt(step + 2), now)).toBeNull();
      expect(findTotpStep(secret, "abcdef", now)).toBeNull();
      expect(findTotpStep(secret, "12345", now)).toBeNull();
    });

    it("refuses a step that was already used, and earlier ones", () => {
      expect(findTotpStep(secret, codeAt(step), now, step)).toBeNull();
      expect(findTotpStep(secret, codeAt(step - 1), now, step)).toBeNull();
      expect(findTotpStep(secret, codeAt(step + 1), now, step)).toBe(step + 1);
    });
  });

  it("escapes the account in the provisioning URI", () => {
    const uri = totpProvisioningUri("ABC", "a+b@example.com", "Hay");
    expect(uri.startsWith("otpauth://totp/Hay:a%2Bb%40example.com?")).toBe(true);
    expect(new URL(uri).searchParams.get("secret")).toBe("ABC");
  });
});
