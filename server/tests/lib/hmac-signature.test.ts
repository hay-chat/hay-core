import crypto from "crypto";
import { verifyHmacSha256 } from "@server/lib/hmac-signature";

describe("verifyHmacSha256", () => {
  const body = Buffer.from('{"shop_domain":"x.myshopify.com"}');
  const sign = (encoding: "hex" | "base64", secret = "app-secret") =>
    crypto.createHmac("sha256", secret).update(body).digest(encoding);

  it("verifies a hex signature by default, with or without the sha256= prefix", () => {
    expect(verifyHmacSha256(body, sign("hex"), "app-secret")).toBe(true);
    expect(verifyHmacSha256(body, `sha256=${sign("hex")}`, "app-secret")).toBe(true);
    expect(verifyHmacSha256(body, sign("base64"), "app-secret")).toBe(false);
  });

  it("verifies a base64 signature when asked to", () => {
    expect(verifyHmacSha256(body, sign("base64"), "app-secret", "base64")).toBe(true);
    expect(verifyHmacSha256(body, sign("base64", "other"), "app-secret", "base64")).toBe(false);
    expect(verifyHmacSha256(body, sign("hex"), "app-secret", "base64")).toBe(false);
  });
});
