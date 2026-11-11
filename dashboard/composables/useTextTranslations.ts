import { computed, reactive, toValue, watch, type MaybeRefOrGetter } from "vue";
import { Hay } from "@/utils/api";
import { useUserStore } from "@/stores/user";
import type { LanguageCode } from "@/utils/languages";

/**
 * Stored text (conversation titles and hand-off summaries, team questions) in
 * the signed-in team member's translation language (multilingual inbox).
 *
 * Every component on screen that shows such text registers what it shows;
 * requests are batched across components (one per kind of text, language and
 * field, or fields wanted for the same rows; at most MAX_IDS ids) after a
 * short debounce, so a list of rows costs one request per field shown. The server caches translations and skips text
 * already in the reader's language, so asking again is cheap. A text is
 * requested once per version: a failure is not retried automatically, and
 * an edited text is requested again. Until a translation arrives, or when the
 * reader has no translation language, the original is shown.
 */

const DEBOUNCE_MS = 50;
const MAX_IDS = 100;

/** A text as stored (`source`) and in the reader's language (`text`). */
export interface TranslatedField {
  source: string;
  text: string;
}

type Fetch<F extends string> = (
  ids: string[],
  fields: F[],
  language: LanguageCode,
) => Promise<Array<{ id: string } & Partial<Record<F, TranslatedField | null>>>>;

/** One kind of text: its endpoint, its translations so far and its request queue. */
export function createTranslationBatcher<F extends string>(fetchTranslations: Fetch<F>) {
  /** `language|id|field` → the translation of the text it was made for. */
  const cache = reactive(new Map<string, TranslatedField>());
  /** `language|id|field` → the text last requested (or being requested). */
  const requested = new Map<string, string>();
  /** language → field → ids to request. */
  const queue = new Map<LanguageCode, Map<F, Set<string>>>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const key = (language: LanguageCode, id: string, field: F) => `${language}|${id}|${field}`;

  async function send(language: LanguageCode, ids: string[], fields: F[]) {
    try {
      const results = await fetchTranslations(ids, fields, language);
      for (const result of results) {
        for (const field of fields) {
          const translated = result[field];
          if (translated) cache.set(key(language, result.id, field), translated);
        }
      }
    } catch {
      // The original stays on screen; this version of the text is not asked for again.
    }
  }

  function flush() {
    timer = null;
    for (const [language, byField] of queue) {
      // One request per field, and fields wanted for the same ids share one.
      const requests = new Map<string, { ids: string[]; fields: F[] }>();
      for (const [field, idSet] of byField) {
        const ids = [...idSet].sort();
        const group = requests.get(ids.join()) ?? { ids, fields: [] };
        group.fields.push(field);
        requests.set(ids.join(), group);
      }
      for (const { ids, fields } of requests.values()) {
        for (let start = 0; start < ids.length; start += MAX_IDS) {
          void send(language, ids.slice(start, start + MAX_IDS), fields);
        }
      }
    }
    queue.clear();
  }

  /** Ask for `source` of `id`'s `field` in `language`, unless it was already asked for. */
  function request(language: LanguageCode, id: string, field: F, source: string) {
    const entry = key(language, id, field);
    if (requested.get(entry) === source) return;
    requested.set(entry, source);
    let byField = queue.get(language);
    if (!byField) queue.set(language, (byField = new Map()));
    let ids = byField.get(field);
    if (!ids) byField.set(field, (ids = new Set()));
    ids.add(id);
    if (!timer) timer = setTimeout(flush, DEBOUNCE_MS);
  }

  /** The translation of exactly `source`, if one has arrived. */
  function lookup(language: LanguageCode, id: string, field: F, source: string): string | null {
    const cached = cache.get(key(language, id, field));
    return cached && cached.source === source ? cached.text : null;
  }

  /** Forget everything (tests, sign-out). */
  function reset() {
    if (timer) clearTimeout(timer);
    timer = null;
    cache.clear();
    requested.clear();
    queue.clear();
  }

  return { request, lookup, reset };
}

/**
 * Registers the texts of `items` the component shows and returns `textFor`,
 * the text to display: the reader's translation once it has arrived,
 * otherwise the original.
 */
function useBatchedTranslations<T extends { id: string }, F extends string>(
  batcher: ReturnType<typeof createTranslationBatcher<F>>,
  items: MaybeRefOrGetter<readonly T[] | null | undefined>,
  fields: readonly F[],
  sourceOf: (item: T, field: F) => string | null | undefined,
) {
  const userStore = useUserStore();
  const language = computed<LanguageCode | null>(() => userStore.user?.translationLanguage ?? null);

  // Re-runs when the language, the items or their texts change; `request`
  // skips what was already asked for.
  watch(
    () => ({
      lang: language.value,
      texts: (toValue(items) ?? []).flatMap((item) =>
        fields.map((field) => ({ id: item.id, field, source: sourceOf(item, field) ?? "" })),
      ),
    }),
    ({ lang, texts }) => {
      if (!lang) return;
      for (const { id, field, source } of texts) {
        if (source.trim()) batcher.request(lang, id, field, source);
      }
    },
    { immediate: true },
  );

  /** `item`'s `field` in the reader's language, or as stored. */
  function textFor(item: T, field: F): string | null {
    const source = sourceOf(item, field);
    const lang = language.value;
    if (!lang || !source) return source ?? null;
    return batcher.lookup(lang, item.id, field, source) ?? source;
  }

  /** The text shown for `item`'s `field` is a translation (it differs from the original). */
  function isTranslated(item: T, field: F): boolean {
    const source = sourceOf(item, field);
    return !!source && textFor(item, field) !== source;
  }

  return { language, textFor, isTranslated };
}

// ---------------------------------------------------------------------------
// Conversations: titles and hand-off summaries
// ---------------------------------------------------------------------------

export type ConversationTextField = "title" | "summary";

export interface TranslatableConversation {
  id: string;
  title?: string | null;
  summary?: string | null;
}

export const conversationTextBatcher = createTranslationBatcher<ConversationTextField>(
  async (ids, fields, language) =>
    (await Hay.conversations.translateTexts.mutate({ conversationIds: ids, language, fields })).map(
      ({ conversationId, ...texts }) => ({ id: conversationId, ...texts }),
    ),
);

/** Titles and/or summaries of the conversations on screen, in the reader's language. */
export function useConversationTextTranslations<T extends TranslatableConversation>(
  conversations: MaybeRefOrGetter<readonly T[] | null | undefined>,
  fields: readonly ConversationTextField[],
) {
  return useBatchedTranslations(
    conversationTextBatcher,
    conversations,
    fields,
    (conversation, field) => conversation[field],
  );
}

// ---------------------------------------------------------------------------
// Team questions (quick check with the team)
// ---------------------------------------------------------------------------

export type TeamQuestionTextField = "question" | "customerMessage";

export interface TranslatableTeamQuestion {
  id: string;
  question: string;
  customerMessage: string | null;
}

export const teamQuestionTextBatcher = createTranslationBatcher<TeamQuestionTextField>(
  async (ids, fields, language) =>
    (await Hay.teamQuestions.translate.mutate({ questionIds: ids, language, fields })).map(
      ({ questionId, ...texts }) => ({ id: questionId, ...texts }),
    ),
);

/** The questions on screen and the customer messages behind them, in the reader's language. */
export function useTeamQuestionTranslations<T extends TranslatableTeamQuestion>(
  questions: MaybeRefOrGetter<readonly T[] | null | undefined>,
) {
  return useBatchedTranslations(
    teamQuestionTextBatcher,
    questions,
    ["question", "customerMessage"],
    (question, field) => question[field],
  );
}
