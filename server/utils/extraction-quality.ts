const MIN_WORD_COUNT = 20;
const MIN_CONTENT_RATIO = 0.02; // 2% of original HTML length

/**
 * Detect whether content extraction produced poor results.
 * Returns true when extracted content is suspiciously short relative to the HTML source,
 * indicating the page likely requires JavaScript rendering for content extraction.
 *
 * Both conditions must be true to avoid false positives on legitimately short pages.
 */
export function isExtractionPoor(extractedContent: string, originalHtml: string): boolean {
  const wordCount = extractedContent.trim().split(/\s+/).filter(Boolean).length;
  const contentRatio = extractedContent.length / originalHtml.length;

  return wordCount < MIN_WORD_COUNT && contentRatio < MIN_CONTENT_RATIO;
}
