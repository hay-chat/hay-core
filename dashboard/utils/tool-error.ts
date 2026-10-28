/**
 * Pull the structured error out of a failed tool call's output (D6-6), so the
 * dashboard can say why in plain language. Plugins fail with the MCP error
 * text `{ code, retryable, message, details: { reason } }` (from
 * @hay/plugin-sdk/tool-errors); core stores it on the TOOL message either as
 * that JSON string, the parsed object, or inside an MCP `content` array.
 */
export interface ToolErrorInfo {
  /** A tool-errors code (BAD_INPUT, PRECONDITION, ...) or a core code. */
  code: string | null;
  /** `details.reason`, e.g. ALREADY_SHIPPED. */
  reason: string | null;
}

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,40}$/;

function parse(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const pick = (value: unknown) =>
  typeof value === "string" && CODE_PATTERN.test(value) ? value : null;

export function parseToolError(toolOutput: unknown, toolErrorCode?: string | null): ToolErrorInfo {
  let output = asRecord(parse(toolOutput));
  const content = output?.content;
  if (Array.isArray(content)) {
    output = asRecord(parse((content[0] as { text?: unknown } | undefined)?.text));
  }
  const details = asRecord(parse(output?.details));
  return {
    code: pick(output?.code) ?? pick(toolErrorCode),
    reason: pick(details?.reason),
  };
}
