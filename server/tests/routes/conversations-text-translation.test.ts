import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Multilingual inbox: `conversations.translateTexts` shows titles and hand-off
 * summaries in the reader's language, in one batch, cached per conversation
 * and tied to the text they were made from.
 */

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

jest.mock("@server/repositories/conversation.repository", () => ({
  ConversationRepository: jest.fn(() => ({})),
}));

type InvokeOptions = { history: string; prompt: string };
const mockInvoke = jest.fn<(options: InvokeOptions) => Promise<string>>();
jest.mock("@server/services/core/llm.service", () => ({
  LLMService: jest.fn(() => ({ invoke: mockInvoke })),
}));

type Row = {
  id: string;
  title: string | null;
  summary: string | null;
  translations: Record<string, unknown> | null;
};
let rows: Row[] = [];
const mockQuery = jest.fn<(sql: string, params: unknown[]) => Promise<unknown>>(async (sql) =>
  sql.trim().startsWith("SELECT") ? rows : [],
);
jest.mock("@server/database/data-source", () => ({
  AppDataSource: { query: mockQuery, getRepository: () => ({}) },
}));

import { conversationsRouter } from "@server/routes/v1/conversations";
import { sourceTextHash } from "@server/services/translation.service";
import type { Context } from "@server/trpc/context";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const id = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`;

const ctx = {
  user: {
    id: "22222222-2222-4222-8222-222222222222",
    hasScope: () => true,
    getRole: () => "owner",
  },
  organizationId: ORG_ID,
  req: { headers: {} },
  res: {},
} as unknown as Context;
const caller = () => conversationsRouter.createCaller(ctx);

/** The LLM translates every item as `[target] text`, written in `source`. */
function llmAnswers(source: string) {
  mockInvoke.mockImplementation(async ({ history, prompt }) => {
    const target = /\(([a-zA-Z-]+)\)/.exec(prompt)![1];
    const items = JSON.parse(history).items as Array<{ id: string; text: string }>;
    return JSON.stringify({
      translations: items.map((item) => ({
        id: item.id,
        sourceLanguage: source,
        text: `[${target}] ${item.text}`,
      })),
    });
  });
}

const savedPatches = () =>
  mockQuery.mock.calls
    .filter(([sql]) => sql.includes("UPDATE conversations"))
    .map(([, params]) => JSON.parse(params[1] as string));

beforeEach(() => {
  jest.clearAllMocks();
  rows = [];
});

describe("conversations.translateTexts", () => {
  it("translates what is missing in one call, reuses fresh caches and stores the rest", async () => {
    rows = [
      {
        id: id(1),
        title: "Gift box question",
        summary: "Customer asks about a gift box.",
        translations: {
          // Fresh: made for this summary.
          summary: {
            sourceHash: sourceTextHash("Customer asks about a gift box."),
            sourceLanguage: "en",
            text: { nl: "Klant vraagt naar een cadeaudoos." },
          },
          // Stale: made for an older title.
          title: { sourceHash: sourceTextHash("Old"), sourceLanguage: "en", text: { nl: "Oud" } },
        },
      },
      { id: id(2), title: "Refund", summary: null, translations: null },
    ];
    llmAnswers("en");

    const result = await caller().translateTexts({
      conversationIds: [id(1), id(2), id(1)],
      language: "nl",
    });

    expect(result).toEqual([
      {
        conversationId: id(1),
        title: { source: "Gift box question", text: "[nl] Gift box question" },
        summary: {
          source: "Customer asks about a gift box.",
          text: "Klant vraagt naar een cadeaudoos.",
        },
      },
      { conversationId: id(2), title: { source: "Refund", text: "[nl] Refund" } },
    ]);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockInvoke.mock.calls[0][0].history).items).toHaveLength(2);

    // Scoped by organization, deduplicated ids.
    const [, selectParams] = mockQuery.mock.calls[0];
    expect(selectParams).toEqual([ORG_ID, [id(1), id(2)]]);

    // Only the changed caches are written, in one statement.
    expect(savedPatches()).toEqual([
      {
        [id(1)]: {
          title: {
            sourceHash: sourceTextHash("Gift box question"),
            sourceLanguage: "en",
            text: { nl: "[nl] Gift box question" },
          },
        },
        [id(2)]: {
          title: {
            sourceHash: sourceTextHash("Refund"),
            sourceLanguage: "en",
            text: { nl: "[nl] Refund" },
          },
        },
      },
    ]);
  });

  it("sends nothing to the LLM for text known to be in the reader's language", async () => {
    rows = [
      {
        id: id(1),
        title: "Pakket kwijt",
        summary: "Klant mist een pakket.",
        translations: {
          title: { sourceHash: sourceTextHash("Pakket kwijt"), sourceLanguage: "nl", text: {} },
          summary: {
            sourceHash: sourceTextHash("Klant mist een pakket."),
            sourceLanguage: "nl",
            text: {},
          },
        },
      },
    ];

    const result = await caller().translateTexts({
      conversationIds: [id(1)],
      language: "nl",
      fields: ["summary"],
    });

    expect(result).toEqual([
      {
        conversationId: id(1),
        summary: { source: "Klant mist een pakket.", text: "Klant mist een pakket." },
      },
    ]);
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(savedPatches()).toEqual([]);
  });

  it("records the source language without a translation when the text already was in it", async () => {
    rows = [{ id: id(1), title: "Pakket kwijt", summary: null, translations: null }];
    llmAnswers("nl");

    const [result] = await caller().translateTexts({ conversationIds: [id(1)], language: "nl" });

    expect(result.title).toEqual({ source: "Pakket kwijt", text: "Pakket kwijt" });
    expect(savedPatches()[0][id(1)].title).toEqual({
      sourceHash: sourceTextHash("Pakket kwijt"),
      sourceLanguage: "nl",
      text: {},
    });
  });

  it("fails with TRANSLATION_FAILED and stores nothing when the LLM fails", async () => {
    rows = [{ id: id(1), title: "Refund", summary: null, translations: null }];
    mockInvoke.mockRejectedValue(new Error("provider down"));

    await expect(
      caller().translateTexts({ conversationIds: [id(1)], language: "nl" }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "TRANSLATION_FAILED" });
    expect(savedPatches()).toEqual([]);
  });
});
