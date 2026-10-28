import { describe, it, expect } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import {
  availabilityHandoffLine,
  formatNextOpening,
  handoffCopy,
  type HandoffCopyKey,
} from "../../orchestrator/handoff-copy";

/**
 * D5-2: hand-off lines must never promise a response time, in any language,
 * and the planner prompts must not model one either.
 */

const KEYS: HandoffCopyKey[] = ["handoffQueued", "handoffNobodyOnline", "recoveryEscalation"];
const TIME_PROMISES =
  /shortly|soon|right away|in a few minutes|within \d+|em breve|logo mais|em alguns minutos|em até|pronto|enseguida|en breve|en unos minutos/i;

describe("handoffCopy", () => {
  it.each(["en", "pt", "es"])("never promises a response time (%s)", (language) => {
    for (const key of KEYS) {
      expect(handoffCopy(key, language)).not.toMatch(TIME_PROMISES);
    }
  });

  it("uses the first language it has copy for", () => {
    expect(handoffCopy("handoffQueued", "de", "pt", "en")).toBe(handoffCopy("handoffQueued", "pt"));
    expect(handoffCopy("handoffQueued", undefined, null, "es")).toBe(
      handoffCopy("handoffQueued", "es"),
    );
  });

  it("treats region tags as their base language", () => {
    expect(handoffCopy("handoffNobodyOnline", "pt-BR")).toBe(
      handoffCopy("handoffNobodyOnline", "pt"),
    );
  });

  it("falls back to English", () => {
    expect(handoffCopy("handoffQueued", "ja", null)).toBe(handoffCopy("handoffQueued", "en"));
    expect(handoffCopy("handoffQueued")).toMatch(/team/);
  });
});

describe("hand-off prompts", () => {
  const promptsDir = path.join(__dirname, "../../prompts");
  const read = (file: string) => fs.readFileSync(path.join(promptsDir, file), "utf8");

  it("the planner no longer models a response-time promise and forbids inventing one", () => {
    const en = read("en/execution/planner.md");
    expect(en).not.toMatch(/48 hours/);
    expect(en).toMatch(/Never promise or estimate when the team will reply/);
    expect(read("pt/execution/planner.md")).toMatch(/Nunca prometa nem estime/);
  });
});

describe("availabilityHandoffLine (D5-7)", () => {
  const base = { timezone: "America/Sao_Paulo", typicalReplyMinutes: null, nextOpening: null };
  // Fri 30 Oct 2026 20:00 in São Paulo (UTC-3)
  const now = new Date("2026-10-30T23:00:00Z");

  it("names the next opening in the schedule's timezone and the shopper's language", () => {
    const line = availabilityHandoffLine(
      { ...base, state: "closed", nextOpening: new Date("2026-11-02T12:00:00Z") },
      now,
      "pt-BR",
    );
    expect(line).toContain("volta na segunda-feira às 09:00 (horário de Sao Paulo)");
    expect(line).toContain("posso continuar ajudando");
  });

  it("says tomorrow and uses 'no' for weekend days in Portuguese", () => {
    expect(formatNextOpening(new Date("2026-10-31T12:00:00Z"), base.timezone, now, "en")).toBe(
      "tomorrow at 09:00 (Sao Paulo time)",
    );
    expect(formatNextOpening(new Date("2026-11-01T12:00:00Z"), base.timezone, now, "pt")).toBe(
      "no domingo às 09:00 (horário de Sao Paulo)",
    );
  });

  it("gives the typical reply time only when there is data", () => {
    const open = { ...base, state: "open_nobody_online" as const };
    expect(availabilityHandoffLine(open, now, "en")).toBe(handoffCopy("handoffNobodyOnline", "en"));
    expect(availabilityHandoffLine({ ...open, typicalReplyMinutes: 90 }, now, "en")).toMatch(
      /usually reply within about 2 hours/,
    );
  });

  it("uses the queued line when someone is reachable", () => {
    expect(availabilityHandoffLine({ ...base, state: "open" }, now, "es")).toBe(
      handoffCopy("handoffQueued", "es"),
    );
  });
});
