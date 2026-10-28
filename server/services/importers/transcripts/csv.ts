/**
 * Generic CSV transcripts (D7-8). One row per message:
 *
 *   conversation_id,role,text,timestamp,order_ref
 *
 * `role` is customer or agent (aliases like visitor, shopper, operator,
 * atendente work too); `timestamp` and `order_ref` are optional. Rows of one
 * conversation stay in file order unless every row has a timestamp.
 */

import {
  roleFromLabel,
  toIsoTimestamp,
  TranscriptImportError,
  type TestTranscript,
  type TestTranscriptTurn,
} from "./test-transcript";

/** RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const text = content.replace(/^\uFEFF/, "");

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((value) => value.trim() !== ""));
}

/** Header names to column indexes, matching any of the aliases given. */
export function findColumns<K extends string>(
  header: string[],
  aliases: Record<K, string[]>,
): Record<K, number> {
  const normalized = header.map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_"),
  );
  const columns = {} as Record<K, number>;
  for (const key of Object.keys(aliases) as K[]) {
    columns[key] = normalized.findIndex((h) => aliases[key].includes(h));
  }
  return columns;
}

export function parseGenericCsv(content: string): TestTranscript[] {
  const [header, ...rows] = parseCsv(content);
  if (!header) throw new TranscriptImportError("The file is empty");

  const columns = findColumns(header, {
    conversationId: ["conversation_id", "conversation", "thread_id", "ticket_id", "chat_id"],
    role: ["role", "author_type", "sender_type", "from"],
    text: ["text", "message", "content", "body"],
    timestamp: ["timestamp", "date", "time", "created_at", "sent_at"],
    orderRef: ["order_ref", "order", "order_id", "order_number"],
  });
  if (columns.conversationId < 0 || columns.role < 0 || columns.text < 0) {
    throw new TranscriptImportError(
      "The CSV needs conversation_id, role and text columns (timestamp and order_ref are optional)",
    );
  }

  const byConversation = new Map<string, TestTranscript>();
  rows.forEach((row, index) => {
    const id = (row[columns.conversationId] ?? "").trim();
    const roleLabel = row[columns.role] ?? "";
    const role = roleFromLabel(roleLabel);
    if (!id) throw new TranscriptImportError(`Row ${index + 2} has no conversation_id`);
    if (!role) {
      throw new TranscriptImportError(
        `Row ${index + 2}: role "${roleLabel.trim()}" is not customer or agent`,
      );
    }
    let transcript = byConversation.get(id);
    if (!transcript) {
      transcript = { externalId: id, orderRef: null, turns: [] };
      byConversation.set(id, transcript);
    }
    const orderRef = columns.orderRef >= 0 ? row[columns.orderRef]?.trim() : "";
    if (orderRef && !transcript.orderRef) transcript.orderRef = orderRef;
    transcript.turns.push({
      role,
      text: row[columns.text] ?? "",
      timestamp: columns.timestamp >= 0 ? toIsoTimestamp(row[columns.timestamp]) : null,
    });
  });

  return [...byConversation.values()].map((t) => ({ ...t, turns: sortIfTimed(t.turns) }));
}

/** Sort by time only when every turn has one (a stable sort keeps file order on ties). */
export function sortIfTimed(turns: TestTranscriptTurn[]): TestTranscriptTurn[] {
  if (!turns.every((t) => t.timestamp)) return turns;
  return [...turns].sort((a, b) => a.timestamp!.localeCompare(b.timestamp!));
}
