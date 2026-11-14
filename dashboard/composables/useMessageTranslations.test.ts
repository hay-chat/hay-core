import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, reactive, ref } from "vue";
import type { TranslatableMessage } from "@/composables/useMessageTranslations";

const translateMessages = vi.fn();
vi.mock("@/utils/api", () => ({
  Hay: { conversations: { translateMessages: { mutate: translateMessages } } },
}));

const store = reactive<{ user: { translationLanguage: string | null } | null }>({
  user: { translationLanguage: "nl" },
});
vi.mock("@/stores/user", () => ({ useUserStore: () => store }));

const { useMessageTranslations } = await import("@/composables/useMessageTranslations");

const DEBOUNCE = 50;
const scopes: Array<ReturnType<typeof effectScope>> = [];

const message = (
  id: string,
  overrides: Partial<TranslatableMessage> = {},
): TranslatableMessage => ({
  id,
  type: "Customer",
  content: `text ${id}`,
  ...overrides,
});

/** A pending request the test resolves when it wants. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const answer = (...ids: string[]) =>
  ids.map((id) => ({ messageId: id, text: `vertaald ${id}`, sourceLanguage: "pt" }));

function setup(initial: TranslatableMessage[], conversationId = "c1") {
  const messages = ref<TranslatableMessage[]>(initial);
  const id = ref<string | null>(conversationId);
  const scope = effectScope();
  scopes.push(scope);
  const api = scope.run(() => useMessageTranslations(id, messages, { debounceMs: DEBOUNCE }))!;
  return { messages, id, scope, api };
}

/** Run the debounce and let the request's promise settle. */
async function settle() {
  await nextTick();
  await vi.advanceTimersByTimeAsync(DEBOUNCE);
  await nextTick();
}

describe("useMessageTranslations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    translateMessages.mockReset();
    store.user = { translationLanguage: "nl" };
  });

  afterEach(() => {
    for (const scope of scopes.splice(0)) scope.stop();
    vi.useRealTimers();
  });

  it("does nothing when the team member has no translation language", async () => {
    store.user = { translationLanguage: null };
    const { api, messages } = setup([message("a")]);
    messages.value.push(message("b"));
    await settle();

    expect(translateMessages).not.toHaveBeenCalled();
    expect(api.translationFor(messages.value[0]!)).toBeNull();
  });

  it("translates the whole conversation on open, then batches later arrivals by id", async () => {
    translateMessages.mockResolvedValueOnce(answer("a", "b"));
    const { api, messages } = setup([message("a"), message("b", { type: "BotAgent" })]);
    await settle();

    expect(translateMessages).toHaveBeenCalledTimes(1);
    expect(translateMessages).toHaveBeenLastCalledWith({ conversationId: "c1", language: "nl" });
    expect(api.translationFor(messages.value[0]!)).toEqual({
      text: "vertaald a",
      sourceLanguage: "pt",
      language: "nl",
    });

    translateMessages.mockResolvedValueOnce(answer("c", "d"));
    messages.value.push(message("c"));
    await nextTick();
    messages.value.push(message("d", { type: "HumanAgent" }));
    await settle();

    expect(translateMessages).toHaveBeenCalledTimes(2);
    expect(translateMessages).toHaveBeenLastCalledWith({
      conversationId: "c1",
      language: "nl",
      messageIds: ["c", "d"],
    });
  });

  it("never requests the same message twice while a request is in flight", async () => {
    const pending = deferred<ReturnType<typeof answer>>();
    translateMessages.mockReturnValueOnce(pending.promise);
    const { api, messages } = setup([message("a")]);
    await settle();
    expect(api.isTranslating("a")).toBe(true);

    // A websocket update replaces the message object while it is being translated.
    messages.value = [{ ...messages.value[0]! }];
    await settle();
    expect(translateMessages).toHaveBeenCalledTimes(1);

    pending.resolve(answer("a"));
    await settle();
    expect(api.isTranslating("a")).toBe(false);
    expect(api.translations.value.a?.text).toBe("vertaald a");

    messages.value = [{ ...messages.value[0]! }];
    await settle();
    expect(translateMessages).toHaveBeenCalledTimes(1);
  });

  it("uses translations the server already cached and skips what needs none", async () => {
    const { api, messages } = setup([
      message("cached", { translations: { nl: "al vertaald" }, detectedLanguage: "pt" }),
      message("dutch", { detectedLanguage: "nl" }),
      message("tool", { type: "Tool" }),
      message("temp-1", { type: "HumanAgent", deliveryState: "pending" }),
      message("photo", {
        content: "[Customer sent a photo]",
        metadata: { mediaPlaceholder: true },
      }),
    ]);
    await settle();

    expect(translateMessages).not.toHaveBeenCalled();
    expect(api.translationFor(messages.value[0]!)).toEqual({
      text: "al vertaald",
      sourceLanguage: "pt",
      language: "nl",
    });
    expect(api.translationFor(messages.value[2]!)).toBeNull();
  });

  it("records a failure and does not retry it until asked", async () => {
    translateMessages.mockRejectedValueOnce(new Error("TRANSLATION_FAILED"));
    const { api, messages } = setup([message("a")]);
    await settle();

    expect(api.error.value).toBeInstanceOf(Error);
    expect(api.isTranslating("a")).toBe(false);

    messages.value = [{ ...messages.value[0]! }];
    await settle();
    expect(translateMessages).toHaveBeenCalledTimes(1);

    translateMessages.mockResolvedValueOnce(answer("a"));
    api.retry();
    await settle();
    expect(translateMessages).toHaveBeenCalledTimes(2);
    expect(api.error.value).toBeNull();
    expect(api.translations.value.a?.text).toBe("vertaald a");
  });

  it("translates a message again when its content changes", async () => {
    translateMessages.mockResolvedValueOnce(answer("a"));
    const { messages } = setup([message("a")]);
    await settle();

    translateMessages.mockResolvedValueOnce(answer("a"));
    messages.value = [{ ...messages.value[0]!, content: "edited before approval" }];
    await settle();

    expect(translateMessages).toHaveBeenCalledTimes(2);
    expect(translateMessages).toHaveBeenLastCalledWith({
      conversationId: "c1",
      language: "nl",
      messageIds: ["a"],
    });
  });

  it("starts over when the translation language changes", async () => {
    translateMessages.mockResolvedValue(answer("a"));
    const { api } = setup([message("a")]);
    await settle();

    store.user = { translationLanguage: "de" };
    await settle();

    expect(translateMessages).toHaveBeenCalledTimes(2);
    expect(translateMessages).toHaveBeenLastCalledWith({ conversationId: "c1", language: "de" });
    expect(api.language.value).toBe("de");
  });
});
