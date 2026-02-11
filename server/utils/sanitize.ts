/**
 * Sanitizes content to remove null bytes and other problematic characters
 * that can cause database encoding issues
 */
export function sanitizeContent(content: string): string {
  if (!content) return "";

  // Remove null bytes (0x00) which cause PostgreSQL UTF-8 encoding errors
  let sanitized = content.replace(/\x00/g, "");

  // Remove other control characters except tab, newline, and carriage return
  sanitized = sanitized.replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // Collapse runs of 3+ blank lines into 2 (preserves markdown structure)
  sanitized = sanitized.replace(/\n{3,}/g, "\n\n");

  // Trim trailing whitespace on each line
  sanitized = sanitized.replace(/[^\S\n]+$/gm, "");

  sanitized = sanitized.trim();

  return sanitized;
}

/**
 * Sanitizes an object recursively, cleaning all string properties
 */
export function sanitizeObject<T extends Record<string, any>>(obj: T): T {
  if (!obj || typeof obj !== "object") return obj;

  const sanitized: any = Array.isArray(obj) ? [] : {};

  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const value = obj[key];

      if (typeof value === "string") {
        sanitized[key] = sanitizeContent(value);
      } else if (typeof value === "object" && value !== null) {
        sanitized[key] = sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }
  }

  return sanitized as T;
}
