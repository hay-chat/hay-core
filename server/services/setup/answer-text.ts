/**
 * Converts between the plain text a customer types for an answer and the editor document that
 * Knowledge opens. Pure, so the round trip is testable without a database.
 *
 * One line of text is one paragraph; an empty line is an empty paragraph.
 *
 * @module services/setup/answer-text
 */

import type { SetupAnswerText } from "@server/types/setup.types";
import { sanitizeEditorHtml } from "@server/utils/sanitize-html";
import { sanitizeContent } from "@server/utils/sanitize";

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const linesOf = (text: string) => sanitizeContent(text).replace(/\r\n?/g, "\n").split("\n");

/** Tiptap rejects empty text nodes, so an empty line is a paragraph with no content. */
export function answerToTiptapJson(text: string): Record<string, unknown> {
  return {
    type: "doc",
    content: linesOf(text).map((line) =>
      line ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph" },
    ),
  };
}

export function answerToHtml(text: string): string {
  return sanitizeEditorHtml(
    linesOf(text)
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join(""),
  );
}

const ANY_TAG = /<\/?[a-z][^>]*>/i;
const PARAGRAPH_AND_BREAK_TAGS = /<\/?p(\s[^>]*)?>|<br\s*\/?>/gi;

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Text of stored content, which is HTML for editor documents and plain text before that. */
export function plainTextOf(content: string | null | undefined): string {
  if (!content) return "";
  if (!ANY_TAG.test(content)) return content;
  const text = content
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h[1-6]|div|blockquote|pre|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(text).replace(/\n$/, "");
}

/** An answer's text for the edit panel, and whether a plain text field can edit it without loss. */
export function answerTextOf(content: string | null | undefined): SetupAnswerText {
  const html = content ?? "";
  const formatted = ANY_TAG.test(html) && ANY_TAG.test(html.replace(PARAGRAPH_AND_BREAK_TAGS, ""));
  return { text: plainTextOf(html), editable: !formatted };
}
