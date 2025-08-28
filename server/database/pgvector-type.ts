import { ValueTransformer } from "typeorm";

/**
 * Custom transformer for pgvector column type
 * Converts between JavaScript number arrays and PostgreSQL vector format
 */
export const VectorTransformer: ValueTransformer = {
  to: (value: number[] | null | undefined): string | null => {
    if (!value || !Array.isArray(value)) return null;
    return `[${value.join(',')}]`;
  },
  from: (value: string | number[] | null): number[] | null => {
    if (!value) return null;
    
    // If already an array, return it
    if (Array.isArray(value)) return value;
    
    // Parse pgvector format: [1,2,3] or (1,2,3)
    if (typeof value === 'string') {
      // Remove brackets or parentheses and split by comma
      const cleaned = value.replace(/[\[\]\(\)]/g, '');
      if (cleaned.length === 0) return null;
      
      return cleaned.split(',').map(v => parseFloat(v.trim()));
    }
    
    return null;
  }
};

/**
 * Helper to format embedding for raw SQL queries
 */
export function formatEmbeddingForQuery(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * Helper to parse embedding from query result
 */
export function parseEmbeddingFromQuery(value: any): number[] | null {
  if (!value) return null;
  
  if (Array.isArray(value)) return value;
  
  if (typeof value === 'string') {
    const cleaned = value.replace(/[\[\]\(\)]/g, '');
    if (cleaned.length === 0) return null;
    return cleaned.split(',').map(v => parseFloat(v.trim()));
  }
  
  return null;
}