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

export function parseMarkdown(text: string): string {
  // Escape HTML to prevent XSS
  let html = escapeHtml(text);

  // Inline code `code`
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold **text**
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic *text* (not inside bold markers)
  html = html.replace(/(?<![*\\])\*([^*]+)\*(?!\*)/g, "<em>$1</em>");

  // Links [text](url) — only allow http/https
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const safeUrl = url.replace(/&amp;/g, "&");
    if (!/^https?:\/\//i.test(safeUrl)) return label;
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // Process block-level elements (lists)
  html = processBlocks(html);

  return html;
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
