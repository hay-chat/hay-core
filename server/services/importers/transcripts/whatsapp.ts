/**
 * WhatsApp chat exports (D7-8): the .txt from "Export chat > Without media",
 * one conversation per file. Both layouts are read:
 *
 *   Android: 31/12/2025, 22:15 - Maria: Hi, where is my order?
 *   iOS:     [31/12/2025, 22:15:03] Maria: Hi, where is my order?
 *
 * The sender named `businessName` is the agent; everyone else is the
 * customer. Without a business name, whoever wrote first is the customer
 * and every other sender is the agent (shoppers start these chats).
 * System lines (encryption notice, joins) and media placeholders are skipped.
 */

import { TranscriptImportError, type TestTranscript, type TranscriptRole } from "./test-transcript";

const LINE =
  /^\[?(\d{1,4})[./-](\d{1,2})[./-](\d{1,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp]\.?\s?[Mm]\.?)?\]?\s*(?:-\s)?(.*)$/;

const MEDIA_PLACEHOLDER =
  /^(<[^>]*(omitted|oculta|ocultada|omitido)[^>]*>|(image|video|audio|sticker|GIF|document|imagem|vídeo|áudio|figurinha|documento) (omitted|ocultad[oa]|omitid[oa]))$/i;

interface RawMessage {
  sender: string;
  text: string;
  parts: number[];
  meridiem: string | undefined;
}

export interface WhatsAppOptions {
  businessName?: string | null;
}

export function parseWhatsAppExport(
  content: string,
  options: WhatsAppOptions = {},
): TestTranscript[] {
  const messages: RawMessage[] = [];
  for (const rawLine of content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .split("\n")) {
    const line = rawLine.replace(/[\u200e\u200f\u202a-\u202e]/g, "");
    const match = LINE.exec(line);
    if (match) {
      const rest = match[8];
      const separator = rest.indexOf(": ");
      // A line with no "Sender: " is a system line (encryption notice, someone joined...).
      if (separator <= 0) {
        messages.push({ sender: "", text: "", parts: [], meridiem: undefined });
        continue;
      }
      messages.push({
        sender: rest.slice(0, separator).trim(),
        text: rest.slice(separator + 2),
        parts: match.slice(1, 7).map((v) => (v === undefined ? 0 : Number(v))),
        meridiem: match[7],
      });
      continue;
    }
    const current = messages[messages.length - 1];
    if (current?.sender) current.text += `\n${line}`;
  }

  const real = messages.filter((m) => m.sender);
  if (real.length === 0) {
    throw new TranscriptImportError("This does not look like a WhatsApp chat export");
  }

  const business = options.businessName?.trim().toLowerCase();
  if (business && !real.some((m) => m.sender.toLowerCase() === business)) {
    throw new TranscriptImportError(`Nobody named "${options.businessName}" wrote in this chat`);
  }
  const firstSender = real[0].sender;
  const roleOf = (sender: string): TranscriptRole =>
    business
      ? sender.toLowerCase() === business
        ? "agent"
        : "customer"
      : sender === firstSender
        ? "customer"
        : "agent";

  const dayFirst = guessDayFirst(real.map((m) => m.parts));
  return [
    {
      title: business ? null : firstSender,
      turns: real
        .filter((m) => !MEDIA_PLACEHOLDER.test(m.text.trim()))
        .map((m) => ({
          role: roleOf(m.sender),
          text: m.text,
          timestamp: toIso(m.parts, m.meridiem, dayFirst),
        })),
    },
  ];
}

/** DD/MM or MM/DD: decided by any value above 12; day first when nothing tells. */
function guessDayFirst(dates: number[][]): boolean {
  if (dates.some(([a]) => a > 12 && a <= 31)) return true;
  if (dates.some(([, b]) => b > 12)) return false;
  return true;
}

function toIso(parts: number[], meridiem: string | undefined, dayFirst: boolean): string | null {
  const [a, b, c, , minute, second] = parts;
  let hour = parts[3];
  let year: number;
  let month: number;
  let day: number;
  if (a > 31) {
    [year, month, day] = [a, b, c];
  } else {
    [day, month] = dayFirst ? [a, b] : [b, a];
    year = c < 100 ? 2000 + c : c;
  }
  if (meridiem) {
    const pm = /p/i.test(meridiem);
    if (pm && hour < 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
  }
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (Number.isNaN(date.getTime()) || date.getUTCMonth() !== month - 1) return null;
  // Exports carry the phone's local time with no zone; it is stored as if UTC.
  return date.toISOString();
}
