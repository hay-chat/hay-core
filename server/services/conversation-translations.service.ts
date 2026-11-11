/**
 * Multilingual inbox: a conversation's title and hand-off summary in a team
 * member's translation language. Translations are cached on
 * `conversations.translations` (one entry per field, tied to the text it was
 * made from), so each title or summary is translated once per language.
 *
 * The column is read and written with raw SQL only: a plain UPDATE does not
 * bump `updated_at` or broadcast, so translating never reorders the inbox.
 */

import { AppDataSource } from "@server/database/data-source";
import { translationService, sourceTextHash } from "@server/services/translation.service";
import type { LanguageCode } from "@server/types/language.types";
import type {
  CachedTextTranslations,
  ConversationTranslations,
} from "@server/types/translation-cache.types";

export const CONVERSATION_TEXT_FIELDS = ["title", "summary"] as const;
export type ConversationTextField = (typeof CONVERSATION_TEXT_FIELDS)[number];

export interface ConversationTextTranslation {
  conversationId: string;
  /** Per requested field with text: the stored text and the reader's version of it. */
  title?: { source: string; text: string };
  summary?: { source: string; text: string };
}

interface Row {
  id: string;
  title: string | null;
  summary: string | null;
  translations: ConversationTranslations | null;
}

/**
 * Title and/or summary of `conversationIds` (only those in `organizationId`)
 * in `language`. Missing translations are made in one batch and cached.
 * Throws when the translation fails.
 */
export async function translateConversationTexts(input: {
  organizationId: string;
  conversationIds: string[];
  language: LanguageCode;
  fields: readonly ConversationTextField[];
}): Promise<ConversationTextTranslation[]> {
  const { organizationId, conversationIds, language, fields } = input;
  if (!conversationIds.length || !fields.length) return [];

  const rows: Row[] = await AppDataSource.query(
    `SELECT id, title, summary, translations
       FROM conversations
      WHERE organization_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
    [organizationId, conversationIds],
  );

  const items = rows.flatMap((row) =>
    fields
      .filter((field) => row[field]?.trim())
      .map((field) => ({
        id: `${row.id}:${field}`,
        text: row[field]!,
        cached: row.translations?.[field] ?? null,
      })),
  );
  const results = await translationService.translateCachedTexts({
    organizationId,
    items,
    targetLanguage: language,
  });

  // One UPDATE for every conversation whose caches changed: { id: { field: cache } }.
  const patches: Record<
    string,
    Partial<Record<ConversationTextField, CachedTextTranslations>>
  > = {};
  for (const [key, result] of results) {
    if (!result.changed) continue;
    const [id, field] = key.split(":") as [string, ConversationTextField];
    (patches[id] ??= {})[field] = result.cache;
  }
  if (Object.keys(patches).length) {
    await AppDataSource.query(
      `UPDATE conversations c
          SET translations = COALESCE(c.translations, '{}'::jsonb) || p.patch
         FROM jsonb_each($2::jsonb) AS p(id, patch)
        WHERE c.id = p.id::uuid AND c.organization_id = $1`,
      [organizationId, JSON.stringify(patches)],
    );
  }

  return rows.map((row) => {
    const view: ConversationTextTranslation = { conversationId: row.id };
    for (const field of fields) {
      const result = results.get(`${row.id}:${field}`);
      if (result) view[field] = { source: row[field]!, text: result.text };
    }
    return view;
  });
}

/**
 * A freshly written summary: record the language it was written in, so no
 * reader who reads that language ever has it translated, and drop the old
 * summary's translations. Best effort (the caller logs failures).
 */
export async function resetSummaryTranslations(params: {
  conversationId: string;
  organizationId: string;
  summary: string;
  language: LanguageCode | null;
}): Promise<void> {
  const cache: CachedTextTranslations = {
    sourceHash: sourceTextHash(params.summary),
    sourceLanguage: params.language,
    text: {},
  };
  await AppDataSource.query(
    `UPDATE conversations
        SET translations = COALESCE(translations, '{}'::jsonb) || jsonb_build_object('summary', $3::jsonb)
      WHERE id = $1 AND organization_id = $2`,
    [params.conversationId, params.organizationId, JSON.stringify(cache)],
  );
}
