/**
 * Small, dependency-free helpers for the parts of RFC 5322 the channel needs:
 * address parsing, header maps, Message-ID lists and an HTML → text fallback.
 */

export interface EmailAddress {
  name?: string;
  address: string;
}

/** Lower-cased header name → every value seen, in order. */
export type HeaderMap = Record<string, string[]>;

/** Parse one mailbox: `"Name" <user@host>`, `Name <user@host>`, `<user@host>` or `user@host`. */
export function parseAddress(value: string): EmailAddress | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const angle = trimmed.match(/^(.*?)<\s*([^<>\s"]+@[^<>\s"]+)\s*>$/);
  if (angle) {
    const name = angle[1]
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .trim();
    return { name: name || undefined, address: angle[2].toLowerCase() };
  }
  const bare = trimmed.match(/^([^<>\s"]+@[^<>\s"]+)$/);
  return bare ? { address: bare[1].toLowerCase() } : null;
}

/** Split a comma-separated address list, ignoring commas inside quotes or angle brackets. */
function splitAddressList(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  let depth = 0;
  for (const char of value) {
    if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === "<") {
      depth += 1;
    } else if (!quoted && char === ">") {
      depth = Math.max(0, depth - 1);
    }
    if (char === "," && !quoted && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Parse a header value or an array of mailboxes into addresses, dropping anything unparseable. */
export function parseAddressList(value: unknown): EmailAddress[] {
  const items: string[] = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").flatMap(splitAddressList)
    : typeof value === "string"
      ? splitAddressList(value)
      : [];
  return items.map(parseAddress).filter((address): address is EmailAddress => address !== null);
}

/** Build a header map from a provider's headers object (string or string[] values). */
export function headersFromObject(value: unknown): HeaderMap {
  const headers: HeaderMap = {};
  if (typeof value !== "object" || value === null) {
    return headers;
  }
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    const values = Array.isArray(raw) ? raw : [raw];
    for (const item of values) {
      if (typeof item === "string") {
        addHeader(headers, name, item);
      }
    }
  }
  return headers;
}

/**
 * Parse the header block of a raw RFC 5322 message (everything before the
 * first blank line), unfolding continuation lines.
 */
export function parseHeaderBlock(raw: string): HeaderMap {
  const headers: HeaderMap = {};
  const block = raw.split(/\r?\n\r?\n/, 1)[0] ?? "";
  const unfolded = block.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) {
      continue;
    }
    addHeader(headers, line.slice(0, colon), line.slice(colon + 1).trim());
  }
  return headers;
}

function addHeader(headers: HeaderMap, name: string, value: string): void {
  const key = name.trim().toLowerCase();
  if (!key) {
    return;
  }
  (headers[key] ??= []).push(value);
}

/** First value of a header, or undefined. */
export function headerValue(headers: HeaderMap, name: string): string | undefined {
  return headers[name.toLowerCase()]?.[0];
}

/** Every `<id>` token in a Message-ID / In-Reply-To / References value. */
export function parseMessageIds(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return Array.from(value.matchAll(/<[^<>\s]+>/g), (match) => match[0]);
}

/** Wrap a bare id in angle brackets so ids compare equal however the provider reports them. */
export function normalizeMessageId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.startsWith("<") ? trimmed : `<${trimmed.replace(/^<|>$/g, "")}>`;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Plain-text rendering of an HTML body: block tags become line breaks, the rest is stripped. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|pre|table)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
      if (entity.startsWith("#x") || entity.startsWith("#X")) {
        return String.fromCodePoint(parseInt(entity.slice(2), 16));
      }
      if (entity.startsWith("#")) {
        return String.fromCodePoint(parseInt(entity.slice(1), 10));
      }
      return ENTITIES[entity.toLowerCase()] ?? match;
    });
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Escape text for safe inclusion in an HTML body. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Minimal HTML rendering of a plain-text reply: paragraphs with line breaks. */
export function textToHtml(text: string): string {
  const paragraphs = text
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`);
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2937">${paragraphs.join("")}</div>`;
}
