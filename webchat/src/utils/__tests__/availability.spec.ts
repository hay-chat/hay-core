import { describe, it, expect } from "vitest";
import enUs from "@/i18n/locales/en-us";
import ptBr from "@/i18n/locales/pt-br";
import type { TranslationKey } from "@/i18n";
import {
  headerStatus,
  waitingDetail,
  waitingTypical,
  type WidgetAvailability,
} from "../availability";
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
  it("says nothing without business hours or reply-time data", () => {
    expect(headerStatus({ ...base, hasSchedule: false }, en, "en-us")).toBeNull();
    expect(headerStatus(null, en, "en-us")).toBeNull();
  });

  it("prefers the typical reply time while the team is around", () => {
    expect(headerStatus({ ...base, typicalReplyMinutes: 4 }, en, "en-us")).toEqual({
      text: "Typically replies in ~4 min",
      online: true,
    });
    expect(
      headerStatus({ ...base, hasSchedule: false, typicalReplyMinutes: 90 }, en, "en-us"),
    ).toEqual({ text: "Typically replies in ~2 h", online: true });
  });

  it("shows open or when the team is back", () => {
    expect(headerStatus(base, en, "en-us")).toEqual({ text: "Open now", online: true });
    const closed = {
      ...base,
      state: "closed" as const,
      nextOpening: "2026-11-02T09:00:00Z",
      typicalReplyMinutes: 4,
    };
    expect(headerStatus(closed, en, "en-us")?.text).toMatch(/^Back Mon/);
    expect(headerStatus(closed, en, "en-us")?.online).toBe(false);
    expect(headerStatus(closed, pt, "pt-br")?.text).toMatch(/^Retorno: seg/);
    expect(headerStatus({ ...base, state: "closed" }, en, "en-us")?.text).toBe("Away right now");
  });
});

describe("waitingTypical", () => {
  it("is the short reply estimate, hidden without data or outside hours", () => {
    expect(waitingTypical(base, en)).toBeNull();
    expect(waitingTypical({ ...base, typicalReplyMinutes: 5 }, en)).toBe("usually ~5 min");
    expect(waitingTypical({ ...base, state: "closed", typicalReplyMinutes: 5 }, en)).toBeNull();
  });
});

describe("waitingDetail", () => {
  it("says nothing while the team is simply open", () => {
    expect(waitingDetail({ ...base, typicalReplyMinutes: 90 }, en, "en-us")).toBeNull();
  });

  it("tells the shopper the team was alerted when nobody is online", () => {
    expect(waitingDetail({ ...base, state: "open_nobody_online" }, pt, "pt-br")).toBe(
      "Avisamos a equipe.",
    );
  });

  it("says when the team is back outside hours", () => {
    const closed = { ...base, state: "closed" as const, nextOpening: "2026-11-02T09:00:00Z" };
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
