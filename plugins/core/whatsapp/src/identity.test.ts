import { describe, expect, it } from "vitest";
import { customerExternalId, recipientFor } from "./identity.js";

describe("customerExternalId", () => {
  it("keys phone users by E.164 with a plus", () => {
    expect(customerExternalId("5511999999999", "BR.1")).toBe("+5511999999999");
  });

  it("falls back to the BSUID for username users", () => {
    expect(customerExternalId(undefined, "BR.1349120865530274")).toBe("whatsapp:bsuid:BR.1349120865530274");
  });

  it("returns null without any id", () => {
    expect(customerExternalId(undefined, undefined)).toBeNull();
  });
});

describe("recipientFor", () => {
  it("sends to the phone number with a plus", () => {
    expect(recipientFor("+5511999999999")).toEqual({ to: "+5511999999999" });
  });

  it("sends to the BSUID for username users", () => {
    expect(recipientFor("whatsapp:bsuid:BR.13")).toEqual({ recipient: "BR.13" });
  });
});
