import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, reactive, ref } from "vue";
import type { TranslatableConversation } from "@/composables/useTextTranslations";

const translateTexts = vi.fn();
const translateQuestions = vi.fn();
vi.mock("@/utils/api", () => ({
  Hay: {
    conversations: { translateTexts: { mutate: translateTexts } },
    teamQuestions: { translate: { mutate: translateQuestions } },
  },
}));

const store = reactive<{ user: { translationLanguage: string | null } | null }>({
  user: { translationLanguage: "nl" },
});
vi.mock("@/stores/user", () => ({ useUserStore: () => store }));

const {
  conversationTextBatcher,
  teamQuestionTextBatcher,
  useConversationTextTranslations,
  useTeamQuestionTranslations,
} = await import("@/composables/useTextTranslations");

const scopes: Array<ReturnType<typeof effectScope>> = [];
function inScope<T>(run: () => T): T {
  const scope = effectScope();
  scopes.push(scope);
  return scope.run(run)!;
}

/** Run the debounce and let the requests settle. */
async function settle() {
  await nextTick();
  await vi.advanceTimersByTimeAsync(60);
  await nextTick();
}

/** The server answers every requested field as `[nl] <source>`. */
function serverTranslates(conversations: TranslatableConversation[]) {
  translateTexts.mockImplementation(
    async ({ conversationIds, fields }: { conversationIds: string[]; fields: string[] }) =>
      conversationIds.map((id) => {
        const conversation = conversations.find((candidate) => candidate.id === id)!;
        const result: Record<string, unknown> = { conversationId: id };
        for (const field of fields) {
          const source = conversation[field as "title" | "summary"];
          if (source) result[field] = { source, text: `[nl] ${source}` };
        }
        return result;
      }),
  );
}

describe("useConversationTextTranslations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    translateTexts.mockReset();
    translateQuestions.mockReset();
    conversationTextBatcher.reset();
    teamQuestionTextBatcher.reset();
    store.user = { translationLanguage: "nl" };
  });

  afterEach(() => {
    for (const scope of scopes.splice(0)) scope.stop();
    vi.useRealTimers();
  });

  it("does nothing and shows the original without a translation language", async () => {
    store.user = { translationLanguage: null };
    const rows = ref([{ id: "a", title: "Refund" }]);
    const { textFor } = inScope(() => useConversationTextTranslations(rows, ["title"]));
    await settle();

    expect(translateTexts).not.toHaveBeenCalled();
    expect(textFor(rows.value[0]!, "title")).toBe("Refund");
  });

  it("batches rows from several components into one request and shows the translations", async () => {
    const a = { id: "a", title: "Refund", summary: "Wants a refund." };
    const b = { id: "b", title: "Shipping", summary: "Asks about shipping." };
    serverTranslates([a, b]);
    const first = inScope(() => useConversationTextTranslations(() => [a], ["summary"]));
    inScope(() => useConversationTextTranslations(() => [b], ["summary"]));
    inScope(() => useConversationTextTranslations(() => [a], ["title"]));

    expect(first.textFor(a, "summary")).toBe("Wants a refund.");
    await settle();

    // One request per field shown.
    expect(translateTexts.mock.calls.map(([input]) => input)).toEqual([
      { conversationIds: ["a", "b"], language: "nl", fields: ["summary"] },
      { conversationIds: ["a"], language: "nl", fields: ["title"] },
    ]);
    expect(first.textFor(a, "summary")).toBe("[nl] Wants a refund.");
    expect(first.textFor(b, "summary")).toBe("[nl] Asks about shipping.");
    expect(first.isTranslated(a, "summary")).toBe(true);
  });

  it("asks once per text, again when the text changes, and never shows a stale translation", async () => {
    const row = ref({ id: "a", title: "Refund" as string | null });
    serverTranslates([row.value]);
    const { textFor } = inScope(() =>
      useConversationTextTranslations(() => [row.value], ["title"]),
    );
    await settle();
    expect(textFor(row.value, "title")).toBe("[nl] Refund");

    // Re-rendering the same text costs nothing.
    inScope(() => useConversationTextTranslations(() => [row.value], ["title"]));
    await settle();
    expect(translateTexts).toHaveBeenCalledTimes(1);

    row.value = { id: "a", title: "Refund for a kettle" };
    serverTranslates([row.value]);
    expect(textFor(row.value, "title")).toBe("Refund for a kettle");
    await settle();
    expect(translateTexts).toHaveBeenCalledTimes(2);
    expect(textFor(row.value, "title")).toBe("[nl] Refund for a kettle");
  });

  it("keeps the original and does not retry by itself when the request fails", async () => {
    translateTexts.mockRejectedValue(new Error("TRANSLATION_FAILED"));
    const rows = ref([{ id: "a", title: "Refund" }]);
    const { textFor } = inScope(() => useConversationTextTranslations(rows, ["title"]));
    await settle();
    rows.value = [...rows.value];
    await settle();

    expect(translateTexts).toHaveBeenCalledTimes(1);
    expect(textFor(rows.value[0]!, "title")).toBe("Refund");
  });

  it("asks again in a new language", async () => {
    const row = { id: "a", title: "Refund" };
    serverTranslates([row]);
    inScope(() => useConversationTextTranslations(() => [row], ["title"]));
    await settle();
    store.user = { translationLanguage: "de" };
    await settle();

    expect(translateTexts).toHaveBeenCalledTimes(2);
    expect(translateTexts.mock.calls[1]![0]).toMatchObject({ language: "de" });
  });

  it("skips empty texts", async () => {
    inScope(() => useConversationTextTranslations(() => [{ id: "a", summary: null }], ["summary"]));
    await settle();
    expect(translateTexts).not.toHaveBeenCalled();
  });
});

describe("useTeamQuestionTranslations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    translateQuestions.mockReset();
    teamQuestionTextBatcher.reset();
    store.user = { translationLanguage: "nl" };
  });

  afterEach(() => {
    for (const scope of scopes.splice(0)) scope.stop();
    vi.useRealTimers();
  });

  it("shows questions and customer messages in the reader's language", async () => {
    const item = { id: "q1", question: "Gift box?", customerMessage: "Is it in a gift box?" };
    translateQuestions.mockResolvedValue([
      {
        questionId: "q1",
        question: { source: "Gift box?", text: "Cadeaudoos?" },
        customerMessage: { source: "Is it in a gift box?", text: "Zit het in een cadeaudoos?" },
      },
    ]);
    const { textFor, isTranslated } = inScope(() => useTeamQuestionTranslations(() => [item]));
    await settle();

    // Both texts of the same questions: one request.
    expect(translateQuestions).toHaveBeenCalledTimes(1);
    expect(translateQuestions).toHaveBeenCalledWith({
      questionIds: ["q1"],
      language: "nl",
      fields: ["question", "customerMessage"],
    });
    expect(textFor(item, "question")).toBe("Cadeaudoos?");
    expect(textFor(item, "customerMessage")).toBe("Zit het in een cadeaudoos?");
    expect(isTranslated(item, "question")).toBe(true);
  });
});
