/**
 * Text chunking utilities for document processing
 */

export interface ChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  separator?: string | RegExp;
}

/**
 * Split a single oversized segment at character boundaries.
 * Guarantees every returned chunk is <= chunkSize.
 */
function splitAtCharBoundary(text: string, chunkSize: number, chunkOverlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start = end - chunkOverlap;
    // Prevent infinite loop if overlap >= chunkSize
    if (start <= chunks.length * chunkSize - text.length && end === text.length) break;
    if (end === text.length) break;
  }
  return chunks;
}

/**
 * Split text into chunks for embedding.
 * Tries sentence boundaries first, then word boundaries, then raw character slicing.
 * Guarantees no chunk exceeds chunkSize.
 *
 * @param text Text to split
 * @param options Chunking options
 * @returns Array of text chunks
 */
export function splitTextIntoChunks(text: string, options: ChunkOptions = {}): string[] {
  const { chunkSize = 1000, chunkOverlap = 200, separator = /(?<=[.!?])\s+/ } = options;

  // First, try to split by sentences
  const sentences = text.split(separator);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    // If single sentence is too long, split it further by words
    if (sentence.length > chunkSize) {
      // Flush current chunk before processing the long sentence
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = "";
      }

      const words = sentence.split(/\s+/);

      for (const word of words) {
        // If a single word exceeds chunkSize, force-split at character boundaries
        if (word.length > chunkSize) {
          if (currentChunk) {
            chunks.push(currentChunk.trim());
            currentChunk = "";
          }
          chunks.push(...splitAtCharBoundary(word, chunkSize, chunkOverlap));
          continue;
        }

        if ((currentChunk + " " + word).length > chunkSize && currentChunk) {
          chunks.push(currentChunk.trim());
          // Add overlap from the end of previous chunk
          currentChunk =
            currentChunk
              .split(/\s+/)
              .slice(-Math.floor(chunkOverlap / 10))
              .join(" ") +
            " " +
            word;
        } else {
          currentChunk += (currentChunk ? " " : "") + word;
        }
      }
    } else if ((currentChunk + " " + sentence).length > chunkSize && currentChunk) {
      chunks.push(currentChunk.trim());
      // Add overlap from the end of previous chunk
      const overlapText = currentChunk
        .split(/\s+/)
        .slice(-Math.floor(chunkOverlap / 10))
        .join(" ");
      currentChunk = overlapText + " " + sentence;
    } else {
      currentChunk += (currentChunk ? " " : "") + sentence;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

/**
 * Create metadata for each chunk
 * @param chunkIndex Index of the chunk
 * @param totalChunks Total number of chunks
 * @param documentMetadata Original document metadata
 * @returns Chunk metadata
 */
export function createChunkMetadata(
  chunkIndex: number,
  totalChunks: number,
  documentMetadata: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...documentMetadata,
    chunkIndex,
    totalChunks,
    timestamp: new Date().toISOString(),
  };
}
