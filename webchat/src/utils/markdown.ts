/**
 * Minimal markdown parser for webchat messages.
 * Escapes HTML first (XSS-safe), then applies markdown transforms.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The URL if it is an absolute http(s) URL, otherwise undefined (for `:href` from tools). */
export function safeHttpUrl(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

// Finished tags wait behind these private-use marks until every markdown pass
// has run, so no later pass can match text inside an attribute.
const HELD_START = "\uE000";
const HELD_END = "\uE001";

/** Takes already-escaped text: an absolute http(s) URL, with no whitespace. */
function isSafeLinkUrl(url: string): boolean {
  return /^https?:\/\/\S+$/i.test(url);
}

export function parseMarkdown(text: string, approvedImages?: readonly string[]): string {
  const held: string[] = [];
  const hold = (tag: string): string => {
    held.push(tag);
    return `${HELD_START}${held.length - 1}${HELD_END}`;
  };

  // Escape HTML to prevent XSS. URLs stay escaped too: `&amp;` is correct in an attribute.
  let html = escapeHtml(text.replace(/[\uE000\uE001]/g, ""));

  // Images ![alt](url) — must run BEFORE links (an image contains link syntax).
  // An image the server did not approve stays a link, so opening the chat doesn't request it.
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
    if (!isSafeLinkUrl(url)) return "";
    if (approvedImages && !approvedImages.includes(url.replace(/&amp;/g, "&"))) {
      return `[${alt || url}](${url})`;
    }
    return hold(`<img src="${url}" alt="${alt}" loading="lazy" />`);
  });

  // Links [text](url). The label stays in the text so bold and code still apply to it.
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) =>
    isSafeLinkUrl(url)
      ? `${hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">`)}${label}</a>`
      : label,
  );

  // Inline code `code`
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold **text**
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic *text* (not inside bold markers)
  html = html.replace(/(?<![*\\])\*([^*]+)\*(?!\*)/g, "<em>$1</em>");

  // Process block-level elements (lists)
  html = processBlocks(html);

  return html.replace(/\uE000(\d+)\uE001/g, (_, index) => held[Number(index)]);
}

/**
 * Split a markdown string into chunks so each image (`![alt](url)`) stands
 * alone. Text runs between images become their own chunks. Lets the message
 * list render an agent reply as multiple bubbles — one per image — instead of
 * inlining images inside a single text bubble. Returns the original string as a
 * single chunk when there are no images.
 */
const IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g;

export function splitMarkdownImages(markdown: string): string[] {
  if (!markdown) return [markdown];

  const chunks: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  IMAGE_RE.lastIndex = 0;
  while ((match = IMAGE_RE.exec(markdown)) !== null) {
    const before = markdown.slice(lastIndex, match.index).trim();
    if (before) chunks.push(before);
    chunks.push(match[0]);
    lastIndex = match.index + match[0].length;
  }

  const tail = markdown.slice(lastIndex).trim();
  if (tail) chunks.push(tail);

  return chunks.length ? chunks : [markdown];
}

function processBlocks(html: string): string {
  const lines = html.split("\n");
  // Collect block-level chunks: each chunk is either a list HTML string or
  // an array of inline text lines that form a paragraph.
  const blocks: string[] = [];
  let paragraphLines: string[] = [];
  let i = 0;

  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      blocks.push(`<p>${paragraphLines.join("<br>")}</p>`);
      paragraphLines = [];
    }
  };

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    // Blank line — flush current paragraph (starts a new one)
    if (trimmed === "") {
      flushParagraph();
      i++;
      continue;
    }

    // Unordered list
    if (/^[-*•]\s/.test(trimmed)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ""));
        i++;
      }
      blocks.push(`<ul>${items.map((it) => `<li>${it}</li>`).join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+[.)]\s/.test(trimmed)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push(`<ol>${items.map((it) => `<li>${it}</li>`).join("")}</ol>`);
      continue;
    }

    paragraphLines.push(lines[i]);
    i++;
  }

  flushParagraph();

  return blocks.join("");
}

/**
 * Wraps visible text words inside an HTML string with animated spans.
 * HTML tags are preserved as-is; only text nodes get word-wrapped.
 */
export function wrapWordsForAnimation(
  html: string,
  staggerMs = 20,
): { html: string; wordCount: number } {
  let wordIndex = 0;

  // Split by HTML tags — captured tags stay in the array
  const parts = html.split(/(<[^>]+>)/);

  const wrapped = parts
    .map((part) => {
      // HTML tag — keep as-is
      if (part.startsWith("<")) return part;

      // Text node — wrap each word
      return part.replace(/(\S+)/g, (word) => {
        const delay = wordIndex * staggerMs;
        wordIndex++;
        return `<span class="hay-word" style="animation-delay:${delay}ms">${word}</span>`;
      });
    })
    .join("");

  return { html: wrapped, wordCount: wordIndex };
}
