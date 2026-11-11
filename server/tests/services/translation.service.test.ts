import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Multilingual inbox: messages are translated in chunks with one structured
 * LLM call each, detecting each message's language on the way.
 */

type InvokeOptions = { history: string; prompt: string; tier: string; jsonSchema: object };
const mockInvoke = jest.fn<(options: InvokeOptions) => Promise<string>>();
jest.mock("@server/services/core/llm.service", () => ({
  LLMService: jest.fn(() => ({ invoke: mockInvoke })),
}));
const mockQuery = jest.fn<(sql: string, params: unknown[]) => Promise<unknown>>();
jest.mock("@server/database/data-source", () => ({ AppDataSource: { query: mockQuery } }));

import { TranslationService } from "@server/services/translation.service";

type Item = { id: string; text: string };
const sentItems = (call: number): Item[] =>
  JSON.parse(mockInvoke.mock.calls[call][0].history).items;

/** Answers every item as `[lang] text`, written in `source`. */
function answerAll(source: string) {
  mockInvoke.mockImplementation(async ({ history }) => {
    const items = JSON.parse(history).items as Item[];
    return JSON.stringify({
      translations: items.map((item) => ({
        id: item.id,
        sourceLanguage: source,
        text: `[nl] ${item.text}`,
      })),
    });
  });
}

describe("TranslationService.translateTexts", () => {
  let service: TranslationService;
  beforeEach(() => {
    jest.clearAllMocks();
    service = new TranslationService();
  });

  it("translates with one medium-tier structured call and names the target language", async () => {
    answerAll("en");
    const result = await service.translateTexts({
      organizationId: "org",
      items: [
        { id: "a", text: "Where is my order?" },
        { id: "b", text: "It has not arrived" },
      ],
      targetLanguage: "nl",
      context: "Customer: hi",
    });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const options = mockInvoke.mock.calls[0][0];
    expect(options.tier).toBe("medium");
    expect(options.jsonSchema).toBeDefined();
    expect(options.prompt).toContain("Dutch (nl)");
    expect(JSON.parse(options.history).context_do_not_translate).toBe("Customer: hi");
    expect(result.get("a")).toEqual({ sourceLanguage: "en", text: "[nl] Where is my order?" });
    expect(result.get("b")).toEqual({ sourceLanguage: "en", text: "[nl] It has not arrived" });
  });

  it("splits many messages into chunks of 20", async () => {
    answerAll("en");
    const items = Array.from({ length: 45 }, (_, i) => ({ id: `m${i}`, text: `message ${i}` }));
    const result = await service.translateTexts({
      organizationId: "org",
      items,
      targetLanguage: "nl",
    });

    expect(mockInvoke).toHaveBeenCalledTimes(3);
    expect([0, 1, 2].map((call) => sentItems(call).length)).toEqual([20, 20, 5]);
    expect(result.size).toBe(45);
    expect(result.get("m44")?.text).toBe("[nl] message 44");
  });

  it("returns the original text when it already is in the target language", async () => {
    mockInvoke.mockResolvedValue(
      JSON.stringify({ translations: [{ id: "1", sourceLanguage: "nl-NL", text: "Hallo!!" }] }),
    );
    const result = await service.translateTexts({
      organizationId: "org",
      items: [{ id: "a", text: "Hallo daar" }],
      targetLanguage: "nl",
    });
    expect(result.get("a")).toEqual({ sourceLanguage: "nl", text: "Hallo daar" });
  });

  it("skips the LLM for text without letters", async () => {
    const result = await service.translateTexts({
      organizationId: "org",
      items: [
        { id: "a", text: "👍" },
        { id: "b", text: "12345 !" },
      ],
      targetLanguage: "nl",
    });
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(result.get("a")).toEqual({ sourceLanguage: null, text: "👍" });
    expect(result.get("b")).toEqual({ sourceLanguage: null, text: "12345 !" });
  });

  it("shares one LLM call between concurrent requests for the same message", async () => {
    answerAll("en");
    const input = {
      organizationId: "org",
      items: [{ id: "a", text: "Where is my order?" }],
      targetLanguage: "nl" as const,
    };
    const [first, second] = await Promise.all([
      service.translateTexts(input),
      service.translateTexts(input),
    ]);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(first.get("a")).toEqual(second.get("a"));

    // Once done, a later request translates again (stored translations are the cache).
    await service.translateTexts(input);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("throws when the LLM fails or leaves an item out", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("provider down"));
    await expect(
      service.translateTexts({
        organizationId: "org",
        items: [{ id: "a", text: "Hello" }],
        targetLanguage: "nl",
      }),
    ).rejects.toThrow("provider down");

    mockInvoke.mockResolvedValueOnce(JSON.stringify({ translations: [] }));
    await expect(
      service.translateTexts({
        organizationId: "org",
        items: [{ id: "a", text: "Hello" }],
        targetLanguage: "nl",
      }),
    ).rejects.toThrow("missing item");
  });
});

describe("TranslationService.saveMessageTranslation", () => {
  it("merges into the stored translations and only fills an empty detected language", async () => {
    await new TranslationService().saveMessageTranslation({
      messageId: "m1",
      language: "nl",
      text: "Hallo",
      detectedLanguage: "en",
    });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("COALESCE(translations, '{}'::jsonb) ||");
    expect(sql).toContain("detected_language = COALESCE(detected_language, $4)");
    expect(params).toEqual(["m1", "nl", "Hallo", "en"]);
  });
});
