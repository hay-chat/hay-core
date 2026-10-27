/**
 * Tool risk classification (D7-2 / D4-2).
 *
 * Plugins describe each MCP tool with standard annotations plus a Hay.chat
 * write category in `_meta["chat.hay/category"]` (see @hay/plugin-sdk/tool-risk).
 * Core never knows plugin ids: it only reads those fields. A tool that does not
 * say it is read-only is treated as a write, so an unclassified tool is held
 * or simulated rather than run blind.
 */

export const TOOL_CATEGORY_META_KEY = "chat.hay/category";

export const WRITE_CATEGORIES = [
  "refund",
  "cancel",
  "discount",
  "return",
  "address_change",
  "customer_update",
  "note",
  "other_write",
] as const;

export type WriteCategory = (typeof WRITE_CATEGORIES)[number];

/** Writes that move money or undo a sale. */
export const MONEY_CATEGORIES: ReadonlySet<WriteCategory> = new Set(["refund", "cancel", "discount"]);

export type ToolRisk =
  | { readOnly: true; category: null; classified: true }
  | { readOnly: false; category: WriteCategory; classified: boolean };

export interface ToolRiskSource {
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } | null;
  _meta?: Record<string, unknown> | null;
}

/**
 * Classify a tool from its cached MCP descriptor.
 *  - readOnlyHint === true -> read
 *  - a known category -> that write category
 *  - anything else -> unclassified write ("other_write", classified: false)
 */
export function classifyTool(tool: ToolRiskSource | null | undefined): ToolRisk {
  if (tool?.annotations?.readOnlyHint === true) {
    return { readOnly: true, category: null, classified: true };
  }
  const raw = tool?._meta?.[TOOL_CATEGORY_META_KEY];
  if (typeof raw === "string" && (WRITE_CATEGORIES as readonly string[]).includes(raw)) {
    return { readOnly: false, category: raw as WriteCategory, classified: true };
  }
  return { readOnly: false, category: "other_write", classified: false };
}

/** Core tools are built in and read-only (today: product recommendations). */
export const CORE_TOOL_RISK: ToolRisk = { readOnly: true, category: null, classified: true };
