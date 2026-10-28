/** Transcript formats Hay.chat can import (D7-8), by source key. */

import { parseGenericCsv } from "./csv";
import { parsePastedTranscripts } from "./paste";
import type { TestTranscript } from "./test-transcript";

export const TRANSCRIPT_FILE_FORMATS = {
  csv: parseGenericCsv,
  paste: parsePastedTranscripts,
} satisfies Record<string, (content: string) => TestTranscript[]>;

export type TranscriptFileFormat = keyof typeof TRANSCRIPT_FILE_FORMATS;

export * from "./test-transcript";
