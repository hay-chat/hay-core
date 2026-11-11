import type { LanguageCode } from "./language.types";

/**
 * Translations of one piece of stored text (a conversation title, a summary,
 * a team question), cached by target language. They belong to the source text
 * whose hash they carry: when the text changes, they are stale.
 */
export interface CachedTextTranslations {
  /** `sourceTextHash` of the text these translations were made from. */
  sourceHash: string;
  /** Language the source text is written in, once known. */
  sourceLanguage: LanguageCode | null;
  /** The text in each language it was translated into. */
  text: Partial<Record<LanguageCode, string>>;
}

/** `conversations.translations` */
export interface ConversationTranslations {
  title?: CachedTextTranslations;
  summary?: CachedTextTranslations;
}

/** `team_questions.translations` */
export interface TeamQuestionTranslations {
  question?: CachedTextTranslations;
  customerMessage?: CachedTextTranslations;
}
