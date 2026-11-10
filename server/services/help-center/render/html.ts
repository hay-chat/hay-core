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
