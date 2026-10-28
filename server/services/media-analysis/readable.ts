/**
 * Which customer files the vision pass reads (D8-11). Kept dependency-free so
 * the LLM serialiser can import it without pulling in storage or the pass.
 *
 * @module services/media-analysis/readable
 */

import type { MessageAttachment } from "@server/database/entities/message.entity";
import { isUuid } from "@server/services/media-url.service";

export const READABLE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
export const PDF_TYPE = "application/pdf";

/** A photo or PDF stored by Hay.chat (upload id), i.e. something the pass can read. */
export function isAnalyzable(attachment: Pick<MessageAttachment, "id" | "type">): boolean {
  return (
    isUuid(attachment.id) &&
    (READABLE_IMAGE_TYPES.has(attachment.type) || attachment.type === PDF_TYPE)
  );
}
