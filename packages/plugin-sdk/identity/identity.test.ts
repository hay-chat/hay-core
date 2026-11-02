import { describe, it, expect } from "vitest";
import {
  matchIdentity,
  hasIdentity,
  samePhone,
  callerIdentity,
  ownsRecord,
  lookupFor,
  verifiedEmail,
  CUSTOMER_META_KEY,
} from "./index.cjs";

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

describe("the verified customer core sends with a tool call", () => {
  const ana = {
    trust: "verified",
    source: "channel",
    externalId: "wa:1",
    email: "ana@example.com",
    phone: "+55 11 98765-4321",
  };
  const extra = (customer: unknown) => ({ _meta: { [CUSTOMER_META_KEY]: customer } });

  it("reads missing or malformed identities as nobody", () => {
    expect(callerIdentity(undefined)).toEqual({ trust: "none" });
    expect(callerIdentity(extra("verified"))).toEqual({ trust: "none" });
    expect(callerIdentity(extra({ trust: "admin" }))).toEqual({ trust: "none" });
    expect(callerIdentity(extra({ trust: "staff", email: "x" }))).toEqual({ trust: "staff" });
    expect(callerIdentity(extra(ana))).toEqual(ana);
  });

  it("lets a verified customer see only their own records", () => {
    const id = callerIdentity(extra(ana));
    expect(ownsRecord(id, { emails: ["ANA@example.com"], phones: [] })).toBe(true);
    expect(ownsRecord(id, { emails: ["bruno@example.com"], phones: [] })).toBe(false);
    expect(ownsRecord({ trust: "none" }, { emails: ["ana@example.com"], phones: [] })).toBe(false);
    expect(ownsRecord({ trust: "staff" }, { emails: [], phones: [] })).toBe(true);
  });

  it("searches by the verified identity and refuses anyone else's", () => {
    const id = callerIdentity(extra(ana));
    expect(lookupFor(id, {})).toEqual({ email: ana.email, phone: ana.phone });
    expect(lookupFor(id, { phone: "11987654321" })).toEqual({ email: ana.email, phone: ana.phone });
    expect(() => lookupFor(id, { email: "bruno@example.com" })).toThrow(/not the verified/);
    expect(() => lookupFor({ trust: "none" }, { email: ana.email })).toThrow(/not verified/);
    expect(lookupFor({ trust: "staff" }, { email: "x@y.z" })).toEqual({ email: "x@y.z" });
  });

  it("needs an email on file for email-only lookups", () => {
    const phoneOnly = callerIdentity(extra({ ...ana, email: null }));
    expect(() => verifiedEmail(phoneOnly, undefined)).toThrow(/no email on file/);
    expect(verifiedEmail({ trust: "staff" }, "")).toBe("");
  });
});
