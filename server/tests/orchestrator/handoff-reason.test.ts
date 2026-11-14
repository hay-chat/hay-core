import { describe, it, expect } from "@jest/globals";
import {
  HANDOFF_REASONS,
  HANDOFF_REASON_NOT_RECORDED,
  handoffCategory,
  isHandoffReason,
  resolveHandoffReason,
} from "../../orchestrator/handoff-reason";

const none = { plannedHandoff: false, customerAskedForHuman: false };

describe("resolveHandoffReason", () => {
  it("says the AI chose to when nothing else explains the hand-off", () => {
    expect(resolveHandoffReason(none)).toBe("ai_decision");
  });

  it("reports the shopper asking for a person", () => {
    expect(resolveHandoffReason({ ...none, customerAskedForHuman: true })).toBe("customer_request");
  });

  it("counts a planned playbook hand-off as the playbook's, even when the shopper asked", () => {
    expect(resolveHandoffReason({ plannedHandoff: true, customerAskedForHuman: true })).toBe(
      "playbook",
    );
  });

  it("lets the guardrail that stopped the reply win over the shopper's request", () => {
    expect(
      resolveHandoffReason({ ...none, customerAskedForHuman: true, code: "low_confidence" }),
    ).toBe("low_confidence");
  });

  it("reports an outage or a tool loop before anything else", () => {
    expect(
      resolveHandoffReason({
        ...none,
        plannedHandoff: true,
        aiUnavailable: true,
        code: "broken_link",
      }),
    ).toBe("ai_unavailable");
    expect(resolveHandoffReason({ ...none, planningExhausted: true })).toBe("planning_exhausted");
  });
});

describe("handoffCategory", () => {
  it("splits reasons into planned, customer-asked and fallback", () => {
    expect(handoffCategory("playbook")).toBe("planned");
    expect(handoffCategory("customer_request")).toBe("customer_asked");
    expect(handoffCategory(HANDOFF_REASON_NOT_RECORDED)).toBe("not_recorded");
    const fallbacks = HANDOFF_REASONS.filter((r) => r !== "playbook" && r !== "customer_request");
    expect(fallbacks.map(handoffCategory)).toEqual(fallbacks.map(() => "fallback"));
  });
});

describe("isHandoffReason", () => {
  it("accepts only the stored codes", () => {
    expect(isHandoffReason("low_confidence")).toBe(true);
    expect(isHandoffReason(HANDOFF_REASON_NOT_RECORDED)).toBe(false);
    expect(isHandoffReason("The customer asked to speak to Maria")).toBe(false);
    expect(isHandoffReason(null)).toBe(false);
  });
});
