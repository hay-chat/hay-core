import { Eye, PenLine, Trash2 } from "lucide-vue-next";
import type { Component } from "vue";

/**
 * Shared MCP tool classification.
 *
 * Classifies a tool as read / write / destructive using the MCP annotation
 * hints when present, falling back to name-token heuristics for servers that
 * don't ship annotations (e.g. Klaviyo). Annotations are advisory hints per
 * the MCP spec, not security guarantees.
 *
 * Used by the plugin detail page (read/write/destructive badges) and the
 * playbook actions panel (read/write/destructive icons) so both stay in sync.
 */

export type ToolClassification = "read" | "write" | "destructive";

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  title?: string;
}

export interface ClassifiableTool {
  name: string;
  annotations?: ToolAnnotations;
}

const DESTRUCTIVE_TOKENS = new Set(["delete", "destroy", "remove", "drop", "archive", "purge"]);

const READ_TOKENS = new Set([
  "get",
  "list",
  "find",
  "show",
  "describe",
  "read",
  "search",
  "fetch",
  "query",
  "retrieve",
  "inspect",
]);

export function classifyTool(tool: ClassifiableTool): ToolClassification {
  const ann = tool.annotations;
  if (ann) {
    if (ann.destructiveHint === true) return "destructive";
    if (ann.readOnlyHint === true) return "read";
    if (ann.readOnlyHint === false) return "write";
  }
  const segments = tool.name.toLowerCase().split(/[_\-:.]/);
  for (const seg of segments) {
    if (DESTRUCTIVE_TOKENS.has(seg)) return "destructive";
  }
  for (const seg of segments) {
    if (READ_TOKENS.has(seg)) return "read";
  }
  return "write";
}

/** Lucide icon representing a classification: read → Eye, write → Pen, destructive → Trash. */
export function getToolClassificationIcon(classification: ToolClassification): Component {
  if (classification === "read") return Eye;
  if (classification === "destructive") return Trash2;
  return PenLine;
}
