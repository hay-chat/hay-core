/**
 * Helper functions for pgvector type handling
 */

/**
 * Format a number array to PostgreSQL vector string format
 * @param embedding Array of numbers
 * @returns Formatted string for PostgreSQL vector type
 */
export function formatEmbeddingForQuery(embedding: number[]): string {
  if (!embedding || !Array.isArray(embedding)) {
    return "[]";
  }
  return `[${embedding.join(",")}]`;
}

/**
 * Parse PostgreSQL vector result back to number array
 * @param value Raw vector value from database
 * @returns Array of numbers
 */
export function parseEmbeddingFromQuery(value: unknown): number[] | null {
  if (!value) return null;

  // If already an array, return it
  if (Array.isArray(value)) return value;

  // If it's a string, parse it
  if (typeof value === "string") {
    const cleaned = value.replace(/[[\]]/g, "");
    if (!cleaned) return null;

    return cleaned.split(",").map((v) => parseFloat(v.trim()));
  }

  return null;
}
