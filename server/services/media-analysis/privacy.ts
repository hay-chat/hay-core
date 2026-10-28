/**
 * What the AI may see of a customer's file (D8-12).
 *
 * - Payment cards are always withheld: no description, fields or text are kept.
 * - ID documents are withheld unless the store owner allowed them.
 * - Anything the model flagged as showing an ID or card (whatever the class)
 *   is withheld the same way; cards win when unsure.
 * - Card numbers are removed from every text that is kept.
 *
 * Withholding happens when the result is stored, so nothing sensitive reaches
 * the database, the AI, the handoff transcript or the case email.
 *
 * @module services/media-analysis/privacy
 */

import type { AttachmentAnalysis, MediaClass } from "@server/database/entities/message.entity";
import type { VisionResult } from "./vision.service";
import { redactCardNumbers } from "./redact";

export interface PrivacySettings {
  allowIdDocuments: boolean;
}

/** Why a file is withheld, or null when the AI may read it. */
export function withheldClass(
  result: Pick<VisionResult, "class" | "sensitive">,
  settings: PrivacySettings,
): MediaClass | null {
  if (result.class === "card") return "card";
  if (result.class === "id_document") return settings.allowIdDocuments ? null : "id_document";
  // Flagged as showing an ID or card somewhere: we can't tell which, so treat
  // it as a card when IDs are allowed (never readable) and as an ID otherwise.
  if (result.sensitive) return settings.allowIdDocuments ? "card" : "id_document";
  return null;
}

/** Turn a vision result into the stored analysis, applying the rules above. */
export function toStoredAnalysis(
  result: VisionResult,
  settings: PrivacySettings,
  text?: string,
): AttachmentAnalysis {
  const analyzedAt = new Date().toISOString();
  const withheld = withheldClass(result, settings);
  if (withheld) return { status: "done", class: withheld, withheld: true, analyzedAt };

  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(result.fields)) {
    fields[name] = redactCardNumbers(value);
  }
  return {
    status: "done",
    class: result.class,
    description: redactCardNumbers(result.description),
    fields,
    ...(text ? { text: redactCardNumbers(text) } : {}),
    analyzedAt,
  };
}
