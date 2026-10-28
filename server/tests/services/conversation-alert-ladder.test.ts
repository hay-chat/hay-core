import { describe, it, expect } from "@jest/globals";
import {
  ESCALATION_DELAY_MS,
  isAlertRecipient,
  nextEscalationStep,
  type EscalationState,
} from "@server/services/conversation-alert.service";

/** D11-8: the fallback ladder's decisions (re-push, then email), pure. */

const START = new Date("2026-10-27T12:00:00Z");
const after = (ms: number) => new Date(START.getTime() + ms);
const MIN = 60 * 1000;

function state(overrides: Partial<EscalationState> = {}): EscalationState {
  return {
    status: "pending-human",
    assignedUserId: null,
    cycleStartedAt: START,
    humanReplied: false,
    withinBusinessHours: true,
    repushAt: null,
    repushDelivered: false,
    emailed: false,
    now: after(ESCALATION_DELAY_MS),
    ...overrides,
  };
}

describe("nextEscalationStep", () => {
  it("waits 10 minutes before the first escalation", () => {
    expect(ESCALATION_DELAY_MS).toBe(10 * MIN);
    expect(nextEscalationStep(state({ now: after(9 * MIN) }))).toBeNull();
    expect(nextEscalationStep(state({ now: after(10 * MIN) }))).toBe("repush");
  });

  it("emails 10 minutes after a re-push that reached a device", () => {
    const repushed = { repushAt: after(10 * MIN), repushDelivered: true };
    expect(nextEscalationStep(state({ ...repushed, now: after(15 * MIN) }))).toBeNull();
    expect(nextEscalationStep(state({ ...repushed, now: after(20 * MIN) }))).toBe("email");
  });

  it("emails right away when the re-push reached no device", () => {
    expect(
      nextEscalationStep(
        state({ repushAt: after(10 * MIN), repushDelivered: false, now: after(10 * MIN) }),
      ),
    ).toBe("email");
  });

  it("stops after the email", () => {
    expect(
      nextEscalationStep(
        state({
          repushAt: after(10 * MIN),
          repushDelivered: true,
          emailed: true,
          now: after(60 * MIN),
        }),
      ),
    ).toBeNull();
  });

  it("does nothing outside business hours, and resumes inside them", () => {
    expect(
      nextEscalationStep(state({ withinBusinessHours: false, now: after(120 * MIN) })),
    ).toBeNull();
    expect(nextEscalationStep(state({ withinBusinessHours: true, now: after(120 * MIN) }))).toBe(
      "repush",
    );
  });

  it("is cancelled when a human replied", () => {
    expect(nextEscalationStep(state({ humanReplied: true }))).toBeNull();
  });

  it("is cancelled when someone took over or was assigned", () => {
    expect(nextEscalationStep(state({ status: "human-took-over" }))).toBeNull();
    expect(nextEscalationStep(state({ assignedUserId: "user-1" }))).toBeNull();
  });

  it("is cancelled when the conversation closed or went back to the AI", () => {
    for (const status of ["closed", "resolved", "unresolved", "open"] as const) {
      expect(nextEscalationStep(state({ status }))).toBeNull();
    }
  });
});

describe("isAlertRecipient", () => {
  const member = {
    id: "u1",
    email: "a@example.com",
    firstName: "Ana",
    membershipActive: true,
    userActive: true,
    status: "available",
  };

  it("accepts an active, Available member", () => {
    expect(isAlertRecipient(member)).toBe(true);
  });

  it("skips Away members, inactive memberships and deactivated users", () => {
    expect(isAlertRecipient({ ...member, status: "away" })).toBe(false);
    expect(isAlertRecipient({ ...member, membershipActive: false })).toBe(false);
    expect(isAlertRecipient({ ...member, userActive: false })).toBe(false);
  });
});
