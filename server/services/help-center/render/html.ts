/**
 * HTML building for the public help center. Pages are plain template strings:
 * the `html` tag escapes every interpolated value, so text from documents,
 * collections, themes and query strings can never become markup. Markup that
 * is already safe (another `html` result, sanitiser output) is wrapped in
 * `SafeHtml` and passes through unchanged.
 */

/** Markup that is safe to put in a page as it is. */
export class SafeHtml {
  constructor(readonly value: string) {}

  toString(): string {
    return this.value;
  }
}

/** Mark markup as already safe. Only for sanitiser output and fixed strings. */
export function raw(markup: string): SafeHtml {
  return new SafeHtml(markup);
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;",
};

/** Escape text for element content and for quoted attribute values (also valid in XML). */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`]/g, (character) => HTML_ESCAPES[character]);
}

export type HtmlValue = SafeHtml | string | number | null | undefined | false | HtmlValue[];

function render(value: HtmlValue): string {
  if (value === null || value === undefined || value === false) return "";
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join("");
  return escapeHtml(String(value));
}

/**
 * Tagged template that escapes every interpolation. Attribute values must be
 * written in double quotes in the template: escaping protects a quoted value,
 * not a bare one.
 */
export function html(strings: TemplateStringsArray, ...values: HtmlValue[]): SafeHtml {
  let out = strings[0];
  values.forEach((value, index) => {
    out += render(value) + strings[index + 1];
  });
  return new SafeHtml(out);
}

/** JSON safe to embed inside a <script> element. */
export function scriptJson(value: unknown): SafeHtml {
  return new SafeHtml(
    JSON.stringify(value)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029"),
  );
}

/**
 * A `<script type="application/ld+json">` block. A data block is never run,
 * so the page's CSP does not apply to it and it needs no nonce.
 */
export function jsonLd(value: unknown): SafeHtml {
  return new SafeHtml(`<script type="application/ld+json">${scriptJson(value).value}</script>`);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntity(entity: string, body: string): string {
  if (body[0] !== "#") return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  const code =
    body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : entity;
}

/**
 * Plain text with whitespace collapsed, cut to `maxLength` characters at a
 * word boundary; null when there is no text.
 */
export function truncateText(value: string, maxLength: number): string | null {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.·-]+$/, "")}…`;
}

/**
 * The text of sanitised markup, truncated: a meta description for a page that
 * has none of its own. Plain text, so it must still go through `html` to
 * reach a page.
 */
export function textExcerpt(markup: string, maxLength: number): string | null {
  return truncateText(
    markup.replace(/<[^>]*>/g, " ").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, decodeEntity),
    maxLength,
  );
}
