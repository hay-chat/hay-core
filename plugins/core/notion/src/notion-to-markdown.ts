/**
 * Notion blocks -> Markdown converter.
 *
 * The Notion API returns page bodies as a tree of typed blocks (fetched by
 * NotionClient.getBlockTree, which eagerly populates each block's `children`).
 * This module converts that tree into a best-effort Markdown string suitable
 * for indexing, RAG ingestion, or display.
 *
 * Spec: https://developers.notion.com/reference/block
 *
 * Design notes:
 * - Pure function. No external dependencies, no I/O, no network calls.
 * - Defensive: never throws. Missing payloads / malformed nodes degrade
 *   gracefully.
 * - Unknown block types emit a visible placeholder
 *   (`> [unsupported Notion block: <type>]`) rather than being silently
 *   dropped, so consumers can see fidelity gaps.
 */

import type { NotionBlock, NotionRichText } from "./notion-client.js";

const INDENT = "  ";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a Notion block tree into a Markdown string. Never throws; partial or
 * malformed input produces a best-effort result.
 */
export function notionBlocksToMarkdown(blocks: NotionBlock[]): string {
  if (!Array.isArray(blocks) || blocks.length === 0) return "";
  return renderBlocks(blocks, 0)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Inline rich text
// ---------------------------------------------------------------------------

function escapeText(s: string): string {
  // Escape the markdown control chars most likely to corrupt rendering.
  return s.replace(/([\\`*_[\]])/g, "\\$1");
}

function renderRichText(rt?: NotionRichText[]): string {
  if (!Array.isArray(rt)) return "";
  return rt
    .map((node) => {
      if (node.equation?.expression) {
        return `$${node.equation.expression}$`;
      }
      let text = node.plain_text ?? "";
      if (text.length === 0) return "";
      const a = node.annotations ?? {};
      // `code` wins over escaping — backticks render literally inside.
      if (a.code) {
        text = `\`${text}\``;
      } else {
        text = escapeText(text);
        if (a.bold) text = `**${text}**`;
        if (a.italic) text = `*${text}*`;
        if (a.strikethrough) text = `~~${text}~~`;
      }
      if (node.href) {
        text = `[${text}](${node.href})`;
      }
      return text;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Block rendering
// ---------------------------------------------------------------------------

interface RichTextPayload {
  rich_text?: NotionRichText[];
}

function payloadOf(block: NotionBlock): Record<string, unknown> {
  const p = block[block.type];
  return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
}

function richTextOf(block: NotionBlock): NotionRichText[] | undefined {
  return (payloadOf(block) as RichTextPayload).rich_text;
}

function indentLines(text: string, level: number): string {
  if (level <= 0) return text;
  const pad = INDENT.repeat(level);
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : line))
    .join("\n");
}

/**
 * Render a list of sibling blocks into an array of Markdown segments. Numbered
 * list items are counted across consecutive runs; any non-numbered block resets
 * the counter.
 */
function renderBlocks(blocks: NotionBlock[], level: number): string[] {
  const out: string[] = [];
  let orderedIndex = 0;

  for (const block of blocks) {
    if (!block || typeof block.type !== "string") continue;
    if (block.type === "numbered_list_item") {
      orderedIndex += 1;
    } else {
      orderedIndex = 0;
    }
    const rendered = renderBlock(block, level, orderedIndex);
    if (rendered.length > 0) out.push(rendered);
  }

  return out;
}

/** Render a single block (and its children) to a Markdown segment. */
function renderBlock(block: NotionBlock, level: number, orderedIndex: number): string {
  const type = block.type;
  const rt = renderRichText(richTextOf(block));
  const children = Array.isArray(block.children) ? block.children : [];
  const childMd = children.length > 0 ? renderBlocks(children, level + 1).join("\n\n") : "";

  const withChildren = (line: string): string => {
    const base = indentLines(line, level);
    return childMd.length > 0 ? `${base}\n\n${childMd}` : base;
  };

  switch (type) {
    case "paragraph":
      return withChildren(rt);

    case "heading_1":
      return withChildren(`# ${rt}`);
    case "heading_2":
      return withChildren(`## ${rt}`);
    case "heading_3":
      return withChildren(`### ${rt}`);

    case "bulleted_list_item":
      return renderListItem(`- ${rt}`, childMd, level);
    case "numbered_list_item":
      return renderListItem(`${orderedIndex}. ${rt}`, childMd, level);
    case "to_do": {
      const checked = (payloadOf(block).checked as boolean) === true;
      return renderListItem(`- [${checked ? "x" : " "}] ${rt}`, childMd, level);
    }
    case "toggle":
      // No native Markdown toggle; render the summary as a bullet with nested body.
      return renderListItem(`- ${rt}`, childMd, level);

    case "quote":
      return withChildren(rt ? `> ${rt.replace(/\n/g, "\n> ")}` : "> ");

    case "callout": {
      const icon = calloutIcon(payloadOf(block));
      const prefix = icon ? `${icon} ` : "";
      return withChildren(`> ${prefix}${rt}`);
    }

    case "code": {
      const payload = payloadOf(block);
      const lang = typeof payload.language === "string" ? payload.language : "";
      const code = renderPlain(richTextOf(block));
      return indentLines("```" + lang + "\n" + code + "\n```", level);
    }

    case "divider":
      return indentLines("---", level);

    case "child_page":
      return indentLines(
        `- 📄 ${renderPlain([{ plain_text: stringField(block, "title") }])}`,
        level,
      );
    case "child_database":
      return indentLines(
        `- 🗂 ${renderPlain([{ plain_text: stringField(block, "title") }])} (database)`,
        level,
      );

    case "image":
      return indentLines(renderFile(block, "image"), level);
    case "video":
    case "audio":
    case "file":
    case "pdf":
      return indentLines(renderFile(block, "file"), level);

    case "bookmark":
    case "embed":
    case "link_preview": {
      const url = stringField(block, "url");
      const caption = renderRichText((payloadOf(block).caption as NotionRichText[]) ?? []);
      if (!url) return "";
      return indentLines(`[${caption || url}](${url})`, level);
    }

    case "equation": {
      const expr = stringField(block, "expression");
      return expr ? indentLines(`$$\n${expr}\n$$`, level) : "";
    }

    case "table":
      return indentLines(renderTable(children), level);

    case "table_row":
      // Rendered by the parent `table`; standalone rows are meaningless.
      return "";

    case "column_list":
    case "column":
    case "synced_block":
      // Structural containers — just emit their children.
      return childMd;

    case "table_of_contents":
    case "breadcrumb":
      // No content of their own; skip silently.
      return "";

    default:
      return indentLines(`> [unsupported Notion block: ${type}]`, level);
  }
}

/** A list item with its (already-rendered) nested body indented beneath it. */
function renderListItem(line: string, childMd: string, level: number): string {
  const base = indentLines(line, level);
  if (childMd.length === 0) return base;
  // childMd was rendered at level+1, so it's already indented relative to us.
  return `${base}\n${childMd}`;
}

function renderPlain(rt?: NotionRichText[]): string {
  if (!Array.isArray(rt)) return "";
  return rt.map((t) => t.plain_text ?? "").join("");
}

function stringField(block: NotionBlock, field: string): string {
  const v = payloadOf(block)[field];
  return typeof v === "string" ? v : "";
}

function calloutIcon(payload: Record<string, unknown>): string {
  const icon = payload.icon as { type?: string; emoji?: string } | undefined;
  if (icon?.type === "emoji" && typeof icon.emoji === "string") return icon.emoji;
  return "";
}

function renderFile(block: NotionBlock, kind: "image" | "file"): string {
  const payload = payloadOf(block);
  const fileObj = payload as {
    type?: string;
    external?: { url?: string };
    file?: { url?: string };
    caption?: NotionRichText[];
  };
  const url = fileObj.external?.url ?? fileObj.file?.url ?? "";
  const caption = renderRichText(fileObj.caption ?? []);
  if (!url) return "";
  if (kind === "image") return `![${caption}](${url})`;
  return `[${caption || "file"}](${url})`;
}

/** Render a Notion table block's rows (`table_row` children) as a Markdown table. */
function renderTable(rows: NotionBlock[]): string {
  const tableRows = rows.filter((r) => r.type === "table_row");
  if (tableRows.length === 0) return "";

  const matrix: string[][] = tableRows.map((row) => {
    const cells = (payloadOf(row).cells as NotionRichText[][]) ?? [];
    return cells.map((cell) => renderRichText(cell).replace(/\|/g, "\\|").replace(/\n/g, " "));
  });

  const width = matrix.reduce((max, r) => Math.max(max, r.length), 0);
  if (width === 0) return "";

  const pad = (r: string[]): string[] => {
    const copy = [...r];
    while (copy.length < width) copy.push("");
    return copy;
  };

  const header = pad(matrix[0]);
  const separator = new Array(width).fill("---");
  const bodyRows = matrix.slice(1).map(pad);

  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...bodyRows.map((r) => `| ${r.join(" | ")} |`),
  ];
  return lines.join("\n");
}
