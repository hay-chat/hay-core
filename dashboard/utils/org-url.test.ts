import { describe, expect, it } from "vitest";
import { addOrgToLocation, splitOrgFromLocation } from "./org-url";

const ORG = "6f1c2a34-90ab-4cde-8f01-23456789abcd";

describe("splitOrgFromLocation", () => {
  it.each([
    [`/${ORG}/inbox`, "/inbox"],
    [`/${ORG}`, "/"],
    [`/${ORG}/`, "/"],
    [`/${ORG}?a=1`, "/?a=1"],
    [`/${ORG}/settings/llm?a=1#x`, "/settings/llm?a=1#x"],
    [`/integrations/plugins/%40hay%2Fx?org=${ORG}`, "/integrations/plugins/%40hay%2Fx"],
    [`/inbox?question=q1&org=${ORG}`, "/inbox?question=q1"],
    [`/inbox?org=${ORG}&question=q1#top`, "/inbox?question=q1#top"],
  ])("takes the organization out of %s", (input, location) => {
    expect(splitOrgFromLocation(input)).toEqual({ organizationId: ORG, location });
  });

  it("lowercases the organization id", () => {
    expect(splitOrgFromLocation(`/${ORG.toUpperCase()}/inbox`).organizationId).toBe(ORG);
  });

  it.each(["/inbox", "/", "/conversations/" + ORG, "/inbox?org=not-a-uuid", `/${ORG}x/inbox`])(
    "leaves %s alone",
    (input) => {
      expect(splitOrgFromLocation(input)).toEqual({ organizationId: null, location: input });
    },
  );
});

describe("addOrgToLocation", () => {
  it("prefixes dashboard pages", () => {
    expect(addOrgToLocation("/inbox?a=1", ORG)).toBe(`/${ORG}/inbox?a=1`);
    expect(addOrgToLocation("/", ORG)).toBe(`/${ORG}`);
    expect(addOrgToLocation("/privacy-settings", ORG)).toBe(`/${ORG}/privacy-settings`);
  });

  it("leaves pages outside any organization alone", () => {
    expect(addOrgToLocation("/login?redirect=/inbox", ORG)).toBe("/login?redirect=/inbox");
    expect(addOrgToLocation("/auth/exchange", ORG)).toBe("/auth/exchange");
    expect(addOrgToLocation("/sso/callback", ORG)).toBe("/sso/callback");
    expect(addOrgToLocation("/no-access", ORG)).toBe("/no-access");
  });

  it("does nothing without an organization or when one is already there", () => {
    expect(addOrgToLocation("/inbox", null)).toBe("/inbox");
    expect(addOrgToLocation(`/${ORG}/inbox`, ORG)).toBe(`/${ORG}/inbox`);
  });

  it("round-trips through splitOrgFromLocation", () => {
    const location = "/conversations/abc?x=1#y";
    expect(splitOrgFromLocation(addOrgToLocation(location, ORG))).toEqual({
      organizationId: ORG,
      location,
    });
  });
});
