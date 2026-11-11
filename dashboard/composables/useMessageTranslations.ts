import { computed, onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter } from "vue";
import { Hay } from "@/utils/api";
import { useUserStore } from "@/stores/user";
import type { LanguageCode } from "@/utils/languages";

/** A message's team-facing text in the reader's language. */
export interface MessageTranslation {
  text: string;
  sourceLanguage: LanguageCode | null;
}

/** What a chat bubble needs to show a translation: the text and both languages. */
export interface DisplayTranslation extends MessageTranslation {
  /** The reader's language (the language of `text`). */
  language: LanguageCode;
}

/** The message fields this composable reads. */
export interface TranslatableMessage {
  id: string;
  type: string;
  content: string;
  translations?: Partial<Record<LanguageCode, string>> | null;
  detectedLanguage?: string | null;
  deliveryState?: string;
  metadata?: object | null;
}

const TRANSLATABLE_TYPES = new Set(["Customer", "BotAgent", "HumanAgent"]);
const DEFAULT_DEBOUNCE_MS = 250;

/** Sent text messages from the customer, the AI or a team member. */
const isTranslatable = (message: TranslatableMessage): boolean =>
  TRANSLATABLE_TYPES.has(message.type) &&
  !message.id.startsWith("temp-") &&
  message.deliveryState !== "pending" &&
  message.deliveryState !== "failed" &&
  (message.metadata as { mediaPlaceholder?: unknown } | null | undefined)?.mediaPlaceholder !==
    true &&
  message.content.trim() !== "";

/**
 * Translates a conversation's messages into the signed-in team member's
 * translation language (D: multilingual inbox). Translations the server has
 * already cached arrive on `message.translations`; the rest are requested with
 * `conversations.translateMessages`: the whole conversation on the first
 * request, then only the ids of messages that arrive later, batched with a
 * short debounce. An id is never requested twice at once, and an id the server
 * left untranslated (or that failed) is not retried automatically.
 *
 * Does nothing when the team member has no translation language.
 */
export function useMessageTranslations(
  conversationId: MaybeRefOrGetter<string | null | undefined>,
  messages: MaybeRefOrGetter<readonly TranslatableMessage[] | null | undefined>,
  options: { debounceMs?: number } = {},
) {
  const userStore = useUserStore();
  const language = computed<LanguageCode | null>(() => userStore.user?.translationLanguage ?? null);
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  /** messageId → translation fetched in this session. */
  const translations = ref<Record<string, MessageTranslation>>({});
  /** Ids with a request in flight. */
  const translating = ref(new Set<string>());
  /** The last request's failure, cleared by the next successful one. */
  const error = ref<unknown>(null);

  // Ids already requested (answered, skipped by the server or failed), with the
  // content they were requested for, so an edited message is translated again.
  const requestedContent = new Map<string, string>();
  const queued = new Set<string>();
  let hasRequested = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Bumped on reset so answers for an old conversation or language are dropped.
  let generation = 0;

  const cachedTranslation = (message: TranslatableMessage, lang: LanguageCode): string | null =>
    message.translations?.[lang] ?? null;

  const needsTranslation = (message: TranslatableMessage, lang: LanguageCode): boolean => {
    if (!isTranslatable(message)) return false;
    if (message.detectedLanguage === lang) return false;
    if (cachedTranslation(message, lang) !== null) return false;
    if (translating.value.has(message.id) || queued.has(message.id)) return false;
    const requestedFor = requestedContent.get(message.id);
    if (requestedFor === undefined) return true;
    if (requestedFor === message.content) return false;
    // The content changed (e.g. edited before approval): drop the stale translation.
    delete translations.value[message.id];
    return true;
  };

  const flush = async () => {
    timer = null;
    const lang = language.value;
    const id = toValue(conversationId);
    if (!lang || !id || queued.size === 0) return;

    const ids = [...queued];
    queued.clear();
    const contentById = new Map(
      (toValue(messages) ?? []).map((message) => [message.id, message.content]),
    );
    for (const messageId of ids) {
      translating.value.add(messageId);
      requestedContent.set(messageId, contentById.get(messageId) ?? "");
    }
    // The first request covers the whole conversation; later ones name their messages.
    const wholeConversation = !hasRequested;
    hasRequested = true;
    const requestGeneration = generation;

    try {
      const results = await Hay.conversations.translateMessages.mutate({
        conversationId: id,
        language: lang,
        ...(wholeConversation ? {} : { messageIds: ids }),
      });
      if (requestGeneration !== generation) return;
      for (const result of results) {
        translations.value[result.messageId] = {
          text: result.text,
          sourceLanguage: result.sourceLanguage,
        };
      }
      error.value = null;
    } catch (caught) {
      if (requestGeneration !== generation) return;
      error.value = caught;
    } finally {
      if (requestGeneration === generation) {
        for (const messageId of ids) translating.value.delete(messageId);
      }
    }
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), debounceMs);
  };

  const scan = () => {
    const lang = language.value;
    if (!lang || !toValue(conversationId)) return;
    let added = false;
    for (const message of toValue(messages) ?? []) {
      if (needsTranslation(message, lang)) {
        queued.add(message.id);
        added = true;
      }
    }
    if (added) schedule();
  };

  const reset = () => {
    generation++;
    if (timer) clearTimeout(timer);
    timer = null;
    translations.value = {};
    translating.value = new Set();
    error.value = null;
    requestedContent.clear();
    queued.clear();
    hasRequested = false;
  };

  watch([language, () => toValue(conversationId)], () => {
    reset();
    scan();
  });
  watch(
    () =>
      (toValue(messages) ?? []).map(
        (message) => `${message.id}:${message.deliveryState ?? ""}:${message.content}`,
      ),
    scan,
    { immediate: true },
  );
  onScopeDispose(() => {
    if (timer) clearTimeout(timer);
  });

  /** The reader's translation of a message, or null when none applies. */
  const translationFor = (message: TranslatableMessage): DisplayTranslation | null => {
    const lang = language.value;
    if (!lang || !TRANSLATABLE_TYPES.has(message.type)) return null;
    const cached = cachedTranslation(message, lang);
    if (cached !== null) {
      return {
        text: cached,
        sourceLanguage: (message.detectedLanguage as LanguageCode | null | undefined) ?? null,
        language: lang,
      };
    }
    const fetched = translations.value[message.id];
    return fetched ? { ...fetched, language: lang } : null;
  };

  const isTranslating = (messageId: string): boolean => translating.value.has(messageId);

  /** Try the messages that failed or were left untranslated again. */
  const retry = () => {
    for (const messageId of [...requestedContent.keys()]) {
      if (!translations.value[messageId]) requestedContent.delete(messageId);
    }
    error.value = null;
    scan();
  };

  return {
    language,
    translations,
    translating,
    error,
    translationFor,
    isTranslating,
    retry,
  };
}
