import { describe, it, expect } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { handoffCopy, type HandoffCopyKey } from "../../orchestrator/handoff-copy";

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

  it("the hand-off message prompt exists in en and pt", () => {
    expect(read("en/conversation/handoff-message.md")).toMatch(/id: handoff-message/);
    expect(read("pt/conversation/handoff-message.md")).toMatch(/id: handoff-message/);
  });
});
