/**
 * Tool inputs and outputs often carry JSON as text: a plugin error stored as
 * its JSON string, an MCP `content[0].text`, or a double-encoded value. Unwrap
 * those strings (at any depth) so the viewer can render them as a tree instead
 * of one escaped line.
 */
const MAX_DEPTH = 10;

export type JsonData = string | number | boolean | unknown[] | Record<string, unknown> | null;

function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  const looksLikeJson =
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'));
  if (!looksLikeJson) return text;
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

export function unwrapJsonText(value: unknown, depth = 0): JsonData {
  if (value === undefined) return null;
  if (depth > MAX_DEPTH) return value as JsonData;
  if (typeof value === "string") {
    const parsed = parseJsonText(value);
    return parsed === value ? value : unwrapJsonText(parsed, depth + 1);
  }
  if (Array.isArray(value)) return value.map((item) => unwrapJsonText(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, unwrapJsonText(item, depth + 1)]),
    );
  }
  return value as JsonData;
}
