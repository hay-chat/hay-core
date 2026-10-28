import { describe, it, expect } from "vitest";
import enUs from "@/i18n/locales/en-us";
import ptBr from "@/i18n/locales/pt-br";
import type { TranslationKey } from "@/i18n";
import { headerStatus, waitingDetail, type WidgetAvailability } from "../availability";
import { resumeConversationId } from "../resume";

const en = (key: TranslationKey) => enUs[key];
const pt = (key: TranslationKey) => ptBr[key];

const base: WidgetAvailability = {
  state: "open",
  nextOpening: null,
  timezone: "Europe/Lisbon",
  hasSchedule: true,
  typicalReplyMinutes: null,
};

describe("headerStatus", () => {
  it("says nothing for orgs without business hours", () => {
    expect(headerStatus({ ...base, hasSchedule: false }, en, "en-us")).toBeNull();
    expect(headerStatus(null, en, "en-us")).toBeNull();
  });

  it("shows open or when the team is back", () => {
    expect(headerStatus(base, en, "en-us")).toBe("Open now");
    const closed = { ...base, state: "closed" as const, nextOpening: "2026-11-02T09:00:00Z" };
    expect(headerStatus(closed, en, "en-us")).toMatch(/^Back Mon/);
    expect(headerStatus(closed, pt, "pt-br")).toMatch(/^Retorno: seg/);
    expect(headerStatus({ ...base, state: "closed" }, en, "en-us")).toBe("Away right now");
  });
});

describe("waitingDetail", () => {
  it("hides the typical reply time without enough data", () => {
    expect(waitingDetail(base, en, "en-us")).toBeNull();
    expect(waitingDetail({ ...base, typicalReplyMinutes: 90 }, en, "en-us")).toBe(
      "Usually replies in ~2 h",
    );
  });

  it("tells the shopper the team was alerted when nobody is online", () => {
    expect(waitingDetail({ ...base, state: "open_nobody_online" }, pt, "pt-br")).toBe(
      "Avisamos a equipe.",
    );
  });

  it("says when the team is back outside hours, without a reply estimate", () => {
    const closed = {
      ...base,
      state: "closed" as const,
      nextOpening: "2026-11-02T09:00:00Z",
      typicalReplyMinutes: 5,
    };
    expect(waitingDetail(closed, en, "en-us")).toMatch(/^The team is back Mon .*keep helping/);
  });
});

describe("resumeConversationId", () => {
  it("reads the conversation id from a follow-up email link", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(resumeConversationId(`https://shop.com/p?hay_conversation=${id}`)).toBe(id);
    expect(resumeConversationId("https://shop.com/p?hay_conversation=nope")).toBeNull();
    expect(resumeConversationId("https://shop.com/p")).toBeNull();
  });
});
