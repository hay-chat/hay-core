/**
 * Front-matter parsing and a small markdown → Tiptap converter for the Hay.chat seed.
 *
 * Only the subset the knowledge and playbook files use is supported: `#`/`##` headings (deeper
 * levels become `##`, the playbook editor only has two), paragraphs, flat `-`/`*` and `1.` lists,
 * `**bold**`, `*italic*`, `` `code` `` and `{{action:<tool>}}` placeholders. A placeholder becomes the
 * same `mention` node the dashboard editor saves (dashboard/utils/markdownToTiptap.ts), so the
 * seeded playbook renders action chips and the server's validateReferencedActions sees the tool.
 */

export type FrontMatterValue = string | string[];

export interface ParsedFile {
  data: Record<string, FrontMatterValue>;
  body: string;
}

export interface TiptapMark {
  type: string;
}

export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: TiptapMark[];
  text?: string;
}

export interface TiptapDoc {
  type: "doc";
  content: TiptapNode[];
}

/** Resolves a placeholder's tool name to its plugin id, or throws for an unknown tool. */
export type ActionResolver = (toolName: string) => string;

export const ACTION_PLACEHOLDER = /\{\{action:([a-z0-9_]+)\}\}/g;

function unquote(value: string): string {
  return value.replace(/^(["'])(.*)\1$/, "$2");
}

/**
 * Parses a leading `---` YAML block. Supports `key: value`, `key: [a, b]` and `key:` followed by
 * `  - item` lines; that's all the content files use.
 */
export function parseFrontMatter(source: string): ParsedFile {
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) return { data: {}, body: text.trim() };

  const data: Record<string, FrontMatterValue> = {};
  let listKey: string | null = null;
  for (const line of match[1].split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (data[listKey] as string[]).push(unquote(item[1].trim()));
      continue;
    }
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!pair) throw new Error(`Unreadable front-matter line: "${line}"`);
    const [, key, raw] = pair;
    const value = raw.trim();
    if (value === "") {
      data[key] = [];
      listKey = key;
    } else if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = value
        .slice(1, -1)
        .split(",")
        .map((v) => unquote(v.trim()))
        .filter(Boolean);
      listKey = null;
    } else {
      data[key] = unquote(value);
      listKey = null;
    }
  }
  return { data, body: text.slice(match[0].length).trim() };
}

const INLINE = /\{\{action:([a-z0-9_]+)\}\}|\*\*(.+?)\*\*|`([^`]+)`|\*([^*\s][^*]*)\*/g;

function withMark(nodes: TiptapNode[], mark: string): TiptapNode[] {
  return nodes.map((node) =>
    node.type === "text" ? { ...node, marks: [...(node.marks ?? []), { type: mark }] } : node,
  );
}

/** Inline markdown → text and mention nodes. */
export function parseInline(text: string, resolve: ActionResolver): TiptapNode[] {
  const nodes: TiptapNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push({ type: "text", text: text.slice(last, index) });
    const [, action, bold, code, italic] = match;
    if (action) {
      nodes.push({
        type: "mention",
        attrs: {
          id: `${resolve(action)}:${action}`,
          label: action,
          type: "action",
          pluginId: resolve(action),
        },
      });
    } else if (bold) {
      nodes.push(...withMark(parseInline(bold, resolve), "bold"));
    } else if (code) {
      nodes.push({ type: "text", text: code, marks: [{ type: "code" }] });
    } else if (italic) {
      nodes.push(...withMark(parseInline(italic, resolve), "italic"));
    }
    last = index + match[0].length;
  }
  if (last < text.length) nodes.push({ type: "text", text: text.slice(last) });
  return nodes;
}

function paragraph(text: string, resolve: ActionResolver): TiptapNode {
  const content = parseInline(text, resolve);
  return content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" };
}

type ListKind = "bulletList" | "orderedList";

/** Block markdown → a Tiptap document. */
export function markdownToTiptap(markdown: string, resolve: ActionResolver): TiptapDoc {
  const content: TiptapNode[] = [];
  let paragraphLines: string[] = [];
  let list: { kind: ListKind; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraphLines.length > 0) content.push(paragraph(paragraphLines.join(" "), resolve));
    paragraphLines = [];
  };
  const flushList = () => {
    if (list) {
      content.push({
        type: list.kind,
        ...(list.kind === "orderedList" && { attrs: { start: 1 } }),
        content: list.items.map((item) => ({
          type: "listItem",
          content: [paragraph(item, resolve)],
        })),
      });
    }
    list = null;
  };

  for (const rawLine of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const ordered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      content.push({
        type: "heading",
        attrs: { level: Math.min(heading[1].length, 2) },
        content: parseInline(heading[2].trim(), resolve),
      });
    } else if (bullet || ordered) {
      flushParagraph();
      const kind: ListKind = bullet ? "bulletList" : "orderedList";
      if (list && list.kind !== kind) flushList();
      list ??= { kind, items: [] };
      list.items.push(((bullet ?? ordered) as RegExpExecArray)[1].trim());
    } else if (list && /^\s+\S/.test(rawLine)) {
      // An indented line continues the previous list item.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      flushList();
      paragraphLines.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return { type: "doc", content };
}

/** Every `{{action:…}}` tool name in a markdown string, in order of appearance. */
export function actionPlaceholders(markdown: string): string[] {
  return [...markdown.matchAll(ACTION_PLACEHOLDER)].map((m) => m[1]);
}
