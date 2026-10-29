import { describe, it, expect } from "@jest/globals";
import {
  decideQuickCheck,
  dueTimerStep,
  gaveUpVariant,
  minutesLeftAfterUpdate,
  MAX_QUESTIONS_PER_CONVERSATION,
  MAX_QUESTIONS_PER_ORG_PER_HOUR,
  type QuickCheckFacts,
} from "../../services/team-questions/quick-check-rules";
import { resolveQuickCheckSettings } from "../../types/organization-settings.types";
import { maskEmail, quickCheckCopy, quickCheckOfflineLine } from "../../orchestrator/handoff-copy";
import { signAnswerToken, verifyAnswerToken } from "../../services/team-questions/answer-token";

const facts: QuickCheckFacts = {
  settings: { enabled: true, updateAfterMinutes: 5, giveUpAfterMinutes: 10 },
  isTest: false,
  spamFlagged: false,
  repliesHeldForReview: false,
  hasOpenQuestion: false,
  questionsInConversation: 0,
  questionsInOrganizationLastHour: 0,
};

describe("quick check with the team (D19)", () => {
  describe("resolveQuickCheckSettings", () => {
    it("is off with 5 / 10 minute timers by default", () => {
      expect(resolveQuickCheckSettings(undefined)).toEqual({
        enabled: false,
        updateAfterMinutes: 5,
        giveUpAfterMinutes: 10,
      });
    });

    it("keeps valid org timers and repairs bad ones", () => {
      expect(
        resolveQuickCheckSettings({
          quickCheck: { enabled: true, updateAfterMinutes: 3, giveUpAfterMinutes: 8 },
        }),
      ).toEqual({ enabled: true, updateAfterMinutes: 3, giveUpAfterMinutes: 8 });
      expect(
        resolveQuickCheckSettings({
          quickCheck: { enabled: true, updateAfterMinutes: 0, giveUpAfterMinutes: 999 },
        }),
      ).toEqual({ enabled: true, updateAfterMinutes: 5, giveUpAfterMinutes: 10 });
      // The update always comes before the end of the wait.
      expect(
        resolveQuickCheckSettings({
          quickCheck: { enabled: true, updateAfterMinutes: 9, giveUpAfterMinutes: 4 },
        }),
      ).toMatchObject({ updateAfterMinutes: 3, giveUpAfterMinutes: 4 });
    });
  });

  describe("decideQuickCheck (D19-8 limits)", () => {
    it("asks when everything allows it", () => {
      expect(decideQuickCheck(facts)).toEqual({ action: "ask" });
    });

    it.each([
      ["disabled", { settings: { ...facts.settings, enabled: false } }],
      ["test", { isTest: true }],
      ["spam", { spamFlagged: true }],
      ["approval", { repliesHeldForReview: true }],
      ["conversation_limit", { questionsInConversation: MAX_QUESTIONS_PER_CONVERSATION }],
      ["org_cap", { questionsInOrganizationLastHour: MAX_QUESTIONS_PER_ORG_PER_HOUR }],
    ])("refuses: %s", (reason, extra) => {
      expect(decideQuickCheck({ ...facts, ...extra } as QuickCheckFacts)).toEqual({
        action: "refuse",
        reason,
      });
    });

    it("adds a second fact to the open question instead of asking again", () => {
      expect(
        decideQuickCheck({ ...facts, hasOpenQuestion: true, questionsInConversation: 1 }),
      ).toEqual({ action: "append" });
    });

    it("never asks in approval mode, even with an open question", () => {
      expect(
        decideQuickCheck({ ...facts, hasOpenQuestion: true, repliesHeldForReview: true }),
      ).toEqual({ action: "refuse", reason: "approval" });
    });
  });

  describe("dueTimerStep (D19-2)", () => {
    const askedAt = new Date("2026-10-29T10:00:00Z");
    const at = (minutes: number) => new Date(askedAt.getTime() + minutes * 60_000);
    const settings = { updateAfterMinutes: 5, giveUpAfterMinutes: 10 };

    it("waits, then updates once, then ends the wait", () => {
      expect(dueTimerStep({ askedAt, updateSentAt: null }, settings, at(4))).toBeNull();
      expect(dueTimerStep({ askedAt, updateSentAt: null }, settings, at(5))).toBe("update");
      expect(dueTimerStep({ askedAt, updateSentAt: at(5) }, settings, at(7))).toBeNull();
      expect(dueTimerStep({ askedAt, updateSentAt: at(5) }, settings, at(10))).toBe("give_up");
      // A sweep that missed T+5 entirely goes straight to the end of the wait.
      expect(dueTimerStep({ askedAt, updateSentAt: null }, settings, at(12))).toBe("give_up");
    });

    it("tells the shopper how long is left after the update", () => {
      expect(minutesLeftAfterUpdate(settings)).toBe(5);
      expect(minutesLeftAfterUpdate({ updateAfterMinutes: 9, giveUpAfterMinutes: 9 })).toBe(1);
    });
  });

  describe("copy", () => {
    it("picks the T+10 line from the channel and the contact", () => {
      expect(gaveUpVariant("whatsapp", null)).toBe("chat");
      expect(gaveUpVariant("web", "ana@example.com")).toBe("email");
      expect(gaveUpVariant("web", null)).toBe("leave_email");
    });

    it("names the system's own timers and nothing else", () => {
      expect(quickCheckCopy("en").asked(10)).toBe(
        "I don't have that information. I'm checking with the team and will update you here within 10 minutes. You can keep asking me other things meanwhile.",
      );
      expect(quickCheckCopy("pt-BR").asked(10)).toContain("em até 10 minutos");
      expect(quickCheckCopy("es").stillChecking(5)).toContain("unos 5 minutos");
      expect(quickCheckCopy("fr").gaveUp).toBe(quickCheckCopy("en").gaveUp);
      expect(quickCheckCopy("en").gaveUpEmail(maskEmail("roger@gmail.com"))).toContain(
        "r***@gmail.com",
      );
    });

    it("says when a closed team is back (D19-12)", () => {
      const now = new Date("2026-10-30T20:00:00Z"); // Friday 20:00 in Lisbon
      const line = quickCheckOfflineLine(
        {
          state: "closed",
          nextOpening: new Date("2026-11-02T09:00:00Z"),
          timezone: "Europe/Lisbon",
        },
        now,
        "en",
      );
      expect(line).toBe(
        "I don't have that information, and the team is away right now, back on Monday at 09:00 (Lisbon time). I've passed your question on, and they'll reply to you here in this chat. Until then, I can keep helping with anything else.",
      );
      expect(
        quickCheckOfflineLine(
          { state: "open_nobody_online", nextOpening: null, timezone: "UTC" },
          now,
          "pt",
        ),
      ).toContain("ninguém da equipe está online");
    });
  });

  describe("answer link token (D19-5)", () => {
    const now = Date.parse("2026-10-29T10:00:00Z");

    it("round-trips for 24 hours, then expires", () => {
      const token = signAnswerToken("q-1", "u-1", now);
      expect(verifyAnswerToken(token, now)).toEqual({ questionId: "q-1", userId: "u-1" });
      expect(verifyAnswerToken(token, now + 23 * 3_600_000)).not.toBeNull();
      expect(verifyAnswerToken(token, now + 25 * 3_600_000)).toBeNull();
    });

    it("rejects tampering", () => {
      const token = signAnswerToken("q-1", "u-1", now);
      const [, signature] = token.split(".");
      const forged = `${Buffer.from(`q-2.u-1.${Math.floor(now / 1000) + 86400}`).toString("base64url")}.${signature}`;
      expect(verifyAnswerToken(forged, now)).toBeNull();
      expect(verifyAnswerToken(`${token}x`, now)).toBeNull();
      expect(verifyAnswerToken("nope", now)).toBeNull();
      expect(verifyAnswerToken(undefined, now)).toBeNull();
    });
  });
});
