import { describe, it, expect, jest } from "@jest/globals";

jest.mock("@server/database/data-source", () => ({ AppDataSource: {} }));
jest.mock("@server/services/vector-store.service", () => ({ vectorStoreService: {} }));
jest.mock("@server/services/core/llm.service", () => ({ LLMService: class {} }));

import {
  checkQuestion,
  mapWithConcurrency,
  parseCheckOutput,
  type CheckDeps,
  type CheckPassage,
} from "../../services/setup/check";

const passages: CheckPassage[] = [
  {
    number: 1,
    documentId: "d1",
    title: "Returns",
    url: "https://x.com/returns",
    content: "30 days.",
  },
  { number: 2, documentId: "d2", title: "Shipping", content: "Ships in 3 days." },
];
const deps = (over: Partial<CheckDeps>): CheckDeps => ({
  findPassages: async () => passages,
  ask: async () =>
    JSON.stringify({
      evidence: "30 days.",
      states_the_fact: true,
      answer: "30 days.",
      passage_numbers: [1],
    }),
  now: () => new Date("2026-11-05T10:00:00Z"),
  ...over,
});

describe("checkQuestion", () => {
  it("answers with title and url of the cited document only", async () => {
    const r = await checkQuestion("o", "q", deps({}));
    expect(r).toEqual({
      outcome: "answered",
      answer: "30 days.",
      sources: [{ documentId: "d1", title: "Returns", url: "https://x.com/returns" }],
      checkedAt: "2026-11-05T10:00:00.000Z",
    });
  });

  it("no passages is not_answered without calling the model", async () => {
    const ask = jest.fn<CheckDeps["ask"]>();
    const r = await checkQuestion("o", "q", deps({ findPassages: async () => [], ask }));
    expect(r.outcome).toBe("not_answered");
    expect(ask).not.toHaveBeenCalled();
  });

  it("a model that finds no fact is not_answered", async () => {
    const r = await checkQuestion(
      "o",
      "q",
      deps({
        ask: async () =>
          JSON.stringify({ evidence: "", states_the_fact: false, answer: "", passage_numbers: [] }),
      }),
    );
    expect(r.outcome).toBe("not_answered");
  });

  it("search errors, model errors and bad JSON are failed, never not_answered", async () => {
    for (const over of [
      {
        findPassages: async () => {
          throw new Error("pgvector down");
        },
      },
      {
        ask: async () => {
          throw new Error("429");
        },
      },
      { ask: async () => "not json" },
      { ask: async () => JSON.stringify({ answer: 1 }) },
    ]) {
      expect((await checkQuestion("o", "q", deps(over))).outcome).toBe("failed");
    }
  });
});

describe("helpers", () => {
  it("parseCheckOutput validates", () => {
    expect(() => parseCheckOutput("{}")).toThrow();
  });
  it("mapWithConcurrency caps in-flight work and keeps order", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12]);
    expect(peak).toBe(2);
  });
});
