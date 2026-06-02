/**
 * ADF (Atlassian Document Format) -> Markdown converter.
 *
 * Confluence Cloud v2 returns page bodies in ADF JSON when requested with
 * `body-format=atlas_doc_format`. This module converts that JSON into a
 * best-effort Markdown string suitable for indexing, RAG ingestion, or
 * display in environments that don't render ADF natively.
 *
 * Spec: https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/
 *
 * Design notes:
 * - Pure function. No external dependencies, no I/O, no network calls.
 * - Defensive: never throws. Missing `attrs`, missing `content`, malformed
 *   nodes — all degrade gracefully.
 * - Unknown node types emit a visible placeholder
 *   (`> [unsupported ADF node: <type>]`) rather than being silently dropped,
 *   so consumers can see fidelity gaps (macros, extensions, etc.).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  marks?: AdfMark[];
}

export interface AdfDocument {
  type: "doc";
  version: number;
  content?: AdfNode[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert an ADF document into a Markdown string.
 *
 * The function is defensive: it never throws. Malformed or partial input
 * produces a best-effort string. Unknown node types are emitted as visible
 * placeholders so callers can detect fidelity gaps.
 *
 * @param adf - The ADF document root (typically `{ type: "doc", version: 1, content: [...] }`).
 * @returns A Markdown string. May be empty if the document has no content.
 *
 * @example
 * ```ts
 * const md = adfToMarkdown({
 *   type: "doc",
 *   version: 1,
 *   content: [
 *     { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Hello" }] },
 *   ],
 * });
 * // -> "# Hello\n\n"
 * ```
 */
export function adfToMarkdown(adf: AdfDocument | null | undefined): string {
  if (!adf || typeof adf !== "object") return "";
  const children = Array.isArray(adf.content) ? adf.content : [];
  const out = renderNodes(children).trimEnd();
  return out.length > 0 ? out + "\n" : "";
}

// ---------------------------------------------------------------------------
// Core renderer
// ---------------------------------------------------------------------------

function renderNodes(nodes: AdfNode[] | undefined): string {
  if (!Array.isArray(nodes)) return "";
  let out = "";
  for (const node of nodes) {
    out += renderNode(node);
  }
  return out;
}

function renderNode(node: AdfNode | null | undefined): string {
  if (!node || typeof node !== "object" || typeof node.type !== "string") {
    return "";
  }

  switch (node.type) {
    // Block nodes -----------------------------------------------------------
    case "doc":
      return renderNodes(node.content);
    case "paragraph":
      return renderInline(node.content) + "\n\n";
    case "heading":
      return renderHeading(node);
    case "bulletList":
      return renderList(node, "bullet") + "\n";
    case "orderedList":
      return renderList(node, "ordered") + "\n";
    case "listItem":
      // listItem is normally entered via renderList; if reached directly,
      // just render children with no prefix.
      return renderNodes(node.content);
    case "codeBlock":
      return renderCodeBlock(node);
    case "blockquote":
      return renderBlockquote(node);
    case "rule":
      return "\n---\n\n";
    case "panel":
      return renderPanel(node);
    case "table":
      return renderTable(node) + "\n";
    case "tableRow":
    case "tableHeader":
    case "tableCell":
      // These are handled by renderTable; if reached directly, render children.
      return renderNodes(node.content);
    case "mediaSingle":
    case "mediaGroup":
      return renderNodes(node.content) + "\n\n";
    case "media":
      return renderMedia(node) + "\n\n";

    // Inline nodes (also valid at block level in some contexts) ------------
    case "text":
    case "hardBreak":
    case "mention":
    case "emoji":
    case "inlineCard":
    case "blockCard":
    case "date":
      return renderInlineNode(node);

    // Unknown ---------------------------------------------------------------
    default:
      return `> [unsupported ADF node: ${node.type}]\n\n`;
  }
}

// ---------------------------------------------------------------------------
// Inline rendering
// ---------------------------------------------------------------------------

function renderInline(nodes: AdfNode[] | undefined): string {
  if (!Array.isArray(nodes)) return "";
  let out = "";
  for (const n of nodes) {
    out += renderInlineNode(n);
  }
  return out;
}

function renderInlineNode(node: AdfNode | null | undefined): string {
  if (!node || typeof node !== "object" || typeof node.type !== "string") {
    return "";
  }

  switch (node.type) {
    case "text":
      return applyMarks(node.text ?? "", node.marks);
    case "hardBreak":
      return "  \n";
    case "mention": {
      const attrs = node.attrs ?? {};
      const label = (attrs.text as string) || (attrs.id as string) || "mention";
      return `@${label}`;
    }
    case "emoji": {
      const attrs = node.attrs ?? {};
      const name =
        (attrs.shortName as string) || (attrs.text as string) || (attrs.id as string) || "emoji";
      // Strip leading/trailing colons if Atlassian already included them.
      const trimmed = name.replace(/^:|:$/g, "");
      return `:${trimmed}:`;
    }
    case "inlineCard":
    case "blockCard": {
      const url = (node.attrs?.url as string) || "";
      return url ? `[${url}](${url})` : "";
    }
    case "date": {
      const ts = node.attrs?.timestamp;
      if (ts === undefined || ts === null) return "";
      const n = typeof ts === "string" ? Number(ts) : (ts as number);
      if (!Number.isFinite(n)) return String(ts);
      const d = new Date(n);
      if (Number.isNaN(d.getTime())) return String(ts);
      return d.toISOString().slice(0, 10);
    }
    // If an inline context receives a block node, fall back to its block form
    // so we never silently drop content.
    default:
      return renderNode(node);
  }
}

function applyMarks(text: string, marks: AdfMark[] | undefined): string {
  if (!text) return "";
  if (!Array.isArray(marks) || marks.length === 0) return text;

  let out = text;
  // Apply in a stable order: code first (so other marks wrap around it),
  // then emphasis layers, then link last so URL syntax wraps everything.
  const has = (type: string): AdfMark | undefined => marks.find((m) => m && m.type === type);

  if (has("code")) out = "`" + out + "`";
  if (has("strike")) out = "~~" + out + "~~";
  if (has("em")) out = "_" + out + "_";
  if (has("strong")) out = "**" + out + "**";
  // underline: Markdown has no native form — emit text as-is.
  const link = has("link");
  if (link) {
    const href = (link.attrs?.href as string) || "";
    if (href) out = `[${out}](${href})`;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Block helpers
// ---------------------------------------------------------------------------

function renderHeading(node: AdfNode): string {
  const rawLevel = Number(node.attrs?.level);
  const level = Number.isFinite(rawLevel) ? Math.min(6, Math.max(1, Math.trunc(rawLevel))) : 1;
  return "#".repeat(level) + " " + renderInline(node.content) + "\n\n";
}

function renderList(node: AdfNode, kind: "bullet" | "ordered", depth = 0): string {
  const items = Array.isArray(node.content) ? node.content : [];
  const startRaw = node.attrs?.order;
  let counter = 1;
  if (kind === "ordered" && startRaw !== undefined && startRaw !== null) {
    const n = Number(startRaw);
    if (Number.isFinite(n) && n > 0) counter = Math.trunc(n);
  }

  const indent = "  ".repeat(depth);
  let out = "";

  for (const item of items) {
    if (!item || item.type !== "listItem") continue;
    const marker = kind === "bullet" ? "- " : `${counter}. `;
    counter += 1;

    const rendered = renderListItem(item, depth);
    // Prefix the first line with the marker; subsequent lines get hanging indent.
    const lines = rendered.split("\n");
    const firstNonEmpty = lines.findIndex((l) => l.length > 0);
    if (firstNonEmpty === -1) {
      out += indent + marker + "\n";
      continue;
    }
    lines[firstNonEmpty] = indent + marker + lines[firstNonEmpty];
    // Indent continuation lines (non-first non-empty lines) by marker width.
    const hang = " ".repeat(marker.length);
    for (let i = firstNonEmpty + 1; i < lines.length; i++) {
      if (lines[i].length > 0) lines[i] = indent + hang + lines[i];
    }
    out += lines.join("\n").replace(/\n*$/, "") + "\n";
  }
  return out;
}

function renderListItem(node: AdfNode, depth: number): string {
  const children = Array.isArray(node.content) ? node.content : [];
  let out = "";
  for (const child of children) {
    if (!child || typeof child.type !== "string") continue;
    if (child.type === "bulletList") {
      out += "\n" + renderList(child, "bullet", depth + 1);
    } else if (child.type === "orderedList") {
      out += "\n" + renderList(child, "ordered", depth + 1);
    } else if (child.type === "paragraph") {
      out += renderInline(child.content) + "\n";
    } else {
      // Render block child; trim trailing newlines so list packing stays tight.
      out += renderNode(child).replace(/\n+$/, "") + "\n";
    }
  }
  return out;
}

function renderCodeBlock(node: AdfNode): string {
  const lang = (node.attrs?.language as string) || "";
  const text = collectText(node.content);
  return "```" + lang + "\n" + text + "\n```\n\n";
}

function renderBlockquote(node: AdfNode): string {
  const inner = renderNodes(node.content).replace(/\n+$/, "");
  if (!inner) return "> \n\n";
  const quoted = inner
    .split("\n")
    .map((line) => (line.length > 0 ? "> " + line : ">"))
    .join("\n");
  return quoted + "\n\n";
}

function renderPanel(node: AdfNode): string {
  const panelType = (node.attrs?.panelType as string) || "info";
  const inner = renderNodes(node.content).replace(/\n+$/, "");
  const header = `**[panel: ${panelType}]**`;
  const body = inner ? header + "\n" + inner : header;
  const quoted = body
    .split("\n")
    .map((line) => (line.length > 0 ? "> " + line : ">"))
    .join("\n");
  return quoted + "\n\n";
}

function renderMedia(node: AdfNode): string {
  const attrs = node.attrs ?? {};
  const id = (attrs.id as string) || (attrs.collection as string) || "unknown";
  const url = (attrs.url as string) || `media:${id}`;
  return `![media:${id}](${url})`;
}

// ---------------------------------------------------------------------------
// Tables (GFM)
// ---------------------------------------------------------------------------

function renderTable(node: AdfNode): string {
  const rows = Array.isArray(node.content)
    ? node.content.filter((r) => r && r.type === "tableRow")
    : [];
  if (rows.length === 0) return "";

  // Render every cell into a single-line string.
  const grid: string[][] = [];
  const headerFlags: boolean[][] = [];
  let maxCols = 0;

  for (const row of rows) {
    const cells = Array.isArray(row.content) ? row.content : [];
    const rendered: string[] = [];
    const flags: boolean[] = [];
    for (const cell of cells) {
      if (!cell || (cell.type !== "tableCell" && cell.type !== "tableHeader")) continue;
      rendered.push(renderCell(cell));
      flags.push(cell.type === "tableHeader");
    }
    if (rendered.length > 0) {
      grid.push(rendered);
      headerFlags.push(flags);
      if (rendered.length > maxCols) maxCols = rendered.length;
    }
  }

  if (grid.length === 0 || maxCols === 0) return "";

  // Determine whether the first row is a header row.
  const firstRowIsHeader = headerFlags[0]?.every((f) => f) ?? false;

  // Pad rows to maxCols.
  for (const row of grid) {
    while (row.length < maxCols) row.push("");
  }

  const lines: string[] = [];
  const headerRow = firstRowIsHeader ? grid[0] : new Array(maxCols).fill("");
  lines.push("| " + headerRow.join(" | ") + " |");
  lines.push("| " + new Array(maxCols).fill("---").join(" | ") + " |");

  const bodyStart = firstRowIsHeader ? 1 : 0;
  for (let i = bodyStart; i < grid.length; i++) {
    lines.push("| " + grid[i].join(" | ") + " |");
  }

  return lines.join("\n") + "\n";
}

function renderCell(node: AdfNode): string {
  const inner = renderNodes(node.content).replace(/\n+$/, "");
  // Cells must be single-line in GFM — collapse line breaks to <br>.
  // Escape pipes so they don't break the table.
  return inner
    .replace(/\|/g, "\\|")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("<br>");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectText(nodes: AdfNode[] | undefined): string {
  if (!Array.isArray(nodes)) return "";
  let out = "";
  for (const n of nodes) {
    if (!n) continue;
    if (typeof n.text === "string") out += n.text;
    if (Array.isArray(n.content)) out += collectText(n.content);
  }
  return out;
}
