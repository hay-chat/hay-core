/**
 * Text chunking utilities for document processing
 */

export interface ChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  separator?: string | RegExp;
}

/**
 * Split text into chunks for embedding
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
    // If single sentence is too long, split it further
    if (sentence.length > chunkSize) {
      // Split long sentence by words
      const words = sentence.split(/\s+/);
      let wordChunk = "";

      for (const word of words) {
        if ((wordChunk + " " + word).length > chunkSize && wordChunk) {
          chunks.push(wordChunk.trim());
          // Add overlap from the end of previous chunk
          wordChunk =
            wordChunk
              .split(/\s+/)
              .slice(-Math.floor(chunkOverlap / 10))
              .join(" ") +
            " " +
            word;
        } else {
          wordChunk += (wordChunk ? " " : "") + word;
        }
      }

      if (wordChunk) {
        currentChunk = wordChunk.trim();
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
  documentMetadata: Record<string, any> = {},
): Record<string, any> {
  return {
    ...documentMetadata,
    chunkIndex,
    totalChunks,
    timestamp: new Date().toISOString(),
  };
}
