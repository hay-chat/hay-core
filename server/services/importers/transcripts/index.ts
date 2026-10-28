/** Transcript formats Hay.chat can import (D7-8), by source key. */

import { parseGenericCsv } from "./csv";
import { parsePastedTranscripts } from "./paste";
import { parseWhatsAppExport } from "./whatsapp";
import { parseTidioCsv } from "./tidio";
import type { TestTranscript } from "./test-transcript";

/** Per-format hints from the person importing. */
export interface TranscriptFormatOptions {
  /** WhatsApp: the business's name as it appears in the chat. */
  businessName?: string | null;
}

export const TRANSCRIPT_FILE_FORMATS = {
  csv: parseGenericCsv,
  paste: parsePastedTranscripts,
  whatsapp: parseWhatsAppExport,
  tidio: parseTidioCsv,
} satisfies Record<string, (content: string, options: TranscriptFormatOptions) => TestTranscript[]>;

export type TranscriptFileFormat = keyof typeof TRANSCRIPT_FILE_FORMATS;

export * from "./test-transcript";
