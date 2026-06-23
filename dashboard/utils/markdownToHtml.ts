import { Marked, type Tokens } from "marked";
import { get as getEmoji } from "node-emoji";
import { sanitizeHtml } from "@/utils/sanitize";

/**
 * Isolated marked instance so our options (GFM tables, line breaks, link
 * renderer) don't leak into the global `marked` used by markdownToTiptap.ts.
 *
 * GFM is enabled, which gives us pipe-table support out of the box.
 */
const md = new Marked({ gfm: true, breaks: true });

interface EmojiToken extends Tokens.Generic {
  type: "emoji";
  emoji: string;
}

md.use({
  renderer: {
    // Open links in a new tab; sanitizeHtml enforces rel="noopener noreferrer".
    link(token) {
      const text = this.parser.parseInline(token.tokens);
      const title = token.title ? ` title="${token.title}"` : "";
      return `<a href="${token.href}"${title} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  },
  // Expand GitHub-style emoji shortcodes (e.g. :clipboard: -> 📋). As an inline
  // tokenizer it only fires on text, so shortcodes inside code stay literal.
  extensions: [
    {
      name: "emoji",
      level: "inline",
      start(src: string) {
        return src.indexOf(":");
      },
      tokenizer(src: string): EmojiToken | undefined {
        const match = /^:([a-z0-9_+-]+):/.exec(src);
        if (!match) return undefined;
        const emoji = getEmoji(match[1]);
        if (!emoji) return undefined; // unknown shortcode: leave as plain text
        return { type: "emoji", raw: match[0], emoji };
      },
      renderer(token) {
        return (token as EmojiToken).emoji;
      },
    },
  ],
});

/**
 * Render a markdown string to sanitized HTML.
 *
 * Uses `marked` (GFM) for correct parsing — including tables, blockquotes,
 * nested lists and code fences — then runs the result through sanitizeHtml
 * to strip scripts, event handlers and dangerous protocols.
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown || typeof markdown !== "string") {
    return "";
  }

  const html = md.parse(markdown, { async: false }) as string;
  return sanitizeHtml(html);
}
