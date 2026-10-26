/**
 * Strip quoted history and signatures from an email reply so the orchestrator
 * sees only what the shopper typed this time.
 *
 * Heuristics cover the common clients (Gmail, Apple Mail, Outlook desktop and
 * web, mobile apps) in English, Portuguese, Spanish, French and German. When
 * everything would be stripped, the original text is returned instead —
 * losing a message is worse than quoting one.
 */

/** Attribution line that introduces quoted text, possibly wrapped over 2–3 lines. */
const ATTRIBUTION =
  /^(On|Em|El|Le|Am|Il)\s.{3,240}?\s(wrote|escreveu|escribió|a écrit|schrieb|ha scritto)\s?:\s*$/i;

/** Single-line markers that start a quoted block or a signature. */
const CUT_LINE_PATTERNS: RegExp[] = [
  /^-{2,}\s*(Original|Forwarded) Message\s*-{2,}\s*$/i,
  /^-{2,}\s*Mensagem (original|encaminhada)\s*-{2,}\s*$/i,
  /^-{2,}\s*Mensaje (original|reenviado)\s*-{2,}\s*$/i,
  /^-{2,}\s*Message (d'origine|transféré)\s*-{2,}\s*$/i,
  /^-{2,}\s*(Ursprüngliche|Weitergeleitete) Nachricht\s*-{2,}\s*$/i,
  /^_{10,}\s*$/,
  /^-- \s*$/,
  /^Sent from my (iPhone|iPad|Android|Galaxy|Samsung|Huawei|Pixel)/i,
  /^Enviado d[oe] meu (iPhone|iPad|Android|Galaxy|Samsung)/i,
  /^Get Outlook for (iOS|Android)/i,
];

/** Outlook-style header block: `From:` followed within a few lines by `Sent:`/`Date:`/`To:`. */
const OUTLOOK_FROM = /^\*?(From|De|Von)\s*:\*?\s.+$/i;
const OUTLOOK_FOLLOWER = /^\*?(Sent|Date|To|Enviad[oa]|Para|Gesendet|An|Envoyé|À)\s*:/i;

function isQuoted(line: string): boolean {
  return /^\s*>/.test(line);
}

/** Index of the first line where the quoted / signature part starts, or -1. */
function cutIndex(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();

    if (CUT_LINE_PATTERNS.some((pattern) => pattern.test(line))) {
      return i;
    }

    if (/^(On|Em|El|Le|Am|Il)\s/i.test(line)) {
      for (let span = 1; span <= 3 && i + span <= lines.length; span++) {
        const joined = lines
          .slice(i, i + span)
          .map((part) => part.trim())
          .join(" ");
        if (ATTRIBUTION.test(joined)) {
          return i;
        }
      }
    }

    if (OUTLOOK_FROM.test(line)) {
      const window = lines.slice(i + 1, i + 5);
      if (window.some((next) => OUTLOOK_FOLLOWER.test(next.trim()))) {
        return i;
      }
    }

    if (isQuoted(line)) {
      const rest = lines.slice(i);
      if (rest.every((next) => isQuoted(next) || next.trim() === "")) {
        return i;
      }
    }
  }
  return -1;
}

/** The part of `text` the sender typed, without quoted history or signature. */
export function extractReply(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const cut = cutIndex(lines);
  const kept = (cut === -1 ? lines : lines.slice(0, cut)).join("\n").trim();
  return kept || normalized.trim();
}
