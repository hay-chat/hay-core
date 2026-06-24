/**
 * Split a markdown string into chunks so each image (`![alt](url)`) stands
 * alone. Text runs between images become their own chunks. Used to render an
 * agent message as multiple bubbles — one per image — instead of inlining
 * images inside a single text bubble.
 *
 * Returns the original string as a single chunk when there are no images, so
 * callers can always render `chunks` uniformly.
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
