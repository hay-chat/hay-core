/**
 * Tidio conversation CSV exports (D7-8): one row per message.
 *
 * TODO: checked against Tidio's documented columns only, not a real export.
 * The aliases are deliberately loose (conversation/chat id, sender or author
 * type, message, date); confirm with a real file and tighten.
 */

import { GENERIC_CSV_COLUMNS, parseMessageCsv } from "./csv";
import type { TestTranscript } from "./test-transcript";

const TIDIO_COLUMNS = {
  conversationId: [...GENERIC_CSV_COLUMNS.conversationId, "chat", "thread", "id_conversation"],
  role: [...GENERIC_CSV_COLUMNS.role, "sender", "author", "type", "message_type", "sent_by"],
  text: [...GENERIC_CSV_COLUMNS.text, "message_content", "message_text"],
  timestamp: [...GENERIC_CSV_COLUMNS.timestamp, "message_date", "date_time", "datetime"],
  orderRef: GENERIC_CSV_COLUMNS.orderRef,
};

/** Tidio events and notes, not part of the conversation. */
const IGNORED_SENDERS = ["system", "event", "note", "internal_note", "internal note"];

export function parseTidioCsv(content: string): TestTranscript[] {
  return parseMessageCsv(content, TIDIO_COLUMNS, IGNORED_SENDERS);
}
