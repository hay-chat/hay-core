/**
 * Helpers for reading what a tool call stored on its TOOL message. Plugin
 * tools answer with an MCP `content` array whose first text item is JSON;
 * core may also store the parsed object or a JSON string. Nothing here knows
 * a plugin id: only generic field names are read.
 */

export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** The tool's answer as plain JSON (object, array or null). */
export function parseToolOutput(toolOutput: unknown): unknown {
  const parsed = parseJson(toolOutput);
  const content = asRecord(parsed)?.content ?? (Array.isArray(parsed) ? parsed : null);
  if (Array.isArray(content)) {
    const text = content.find(
      (item): item is { type: string; text: string } =>
        asRecord(item)?.type === "text" && typeof asRecord(item)?.text === "string",
    );
    if (text) return parseJson(text.text);
    if (Array.isArray(parsed)) return parsed;
    return null;
  }
  return parsed;
}

/** `pluginId:tool_name` -> { pluginId, toolName }; a bare name has no plugin. */
export function splitToolName(fullName: string): { pluginId: string | null; toolName: string } {
  const colon = fullName.lastIndexOf(":");
  if (colon === -1) return { pluginId: null, toolName: fullName };
  return { pluginId: fullName.slice(0, colon), toolName: fullName.slice(colon + 1) };
}

/**
 * A tool name in words, without the platform prefix plugins put on their
 * tools ("shopify_add_order_note" from plugin ".../shopify" -> "add order note").
 */
export function toolPhrase(pluginId: string | null, toolName: string): string {
  const platform = pluginId?.split("/").pop()?.toLowerCase();
  let name = toolName;
  if (platform && name.toLowerCase().startsWith(`${platform}_`)) {
    name = name.slice(platform.length + 1);
  }
  return name.replace(/[_-]+/g, " ").trim();
}

/** Last path segment of a provider id ("gid://shopify/Order/123" -> "123"). */
export function shortId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  const last = trimmed.split("/").pop() ?? trimmed;
  return last.split("?")[0] || null;
}
