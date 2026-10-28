/**
 * Lossless Tiptap JSON → markdown for knowledge documents written in the
 * dashboard editor (StarterKit + Link + Image), used by the knowledge
 * "Improve" flow: the AI edits markdown, the dashboard turns the reviewed
 * markdown back into editor JSON.
 *
 * Only the node and mark types that survive that round trip are supported.
 * Anything else (nested lists, tables, unknown nodes) returns `null` so the
 * caller treats the document as read-only instead of silently dropping
 * content on apply.
 */

interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

class UnsupportedContent extends Error {}

function inline(nodes: TiptapNode[] | undefined): string {
  if (!nodes) return "";
  return nodes
    .map((node) => {
      if (node.type === "hardBreak") return "  \n";
      if (node.type === "image") {
        const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
        const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
        return `![${alt}](${src})`;
      }
      if (node.type !== "text") throw new UnsupportedContent(node.type);
      let text = node.text ?? "";
      let href: string | null = null;
      for (const mark of node.marks ?? []) {
        if (mark.type === "bold") text = `**${text}**`;
        else if (mark.type === "italic") text = `*${text}*`;
        else if (mark.type === "strike") text = `~~${text}~~`;
        else if (mark.type === "code") text = `\`${text}\``;
        else if (mark.type === "link" && typeof mark.attrs?.href === "string") {
          href = mark.attrs.href;
        } else throw new UnsupportedContent(`mark:${mark.type}`);
      }
      return href ? `[${text}](${href})` : text;
    })
    .join("");
}

function listItems(node: TiptapNode, ordered: boolean): string {
  const start = typeof node.attrs?.start === "number" ? node.attrs.start : 1;
  return (node.content ?? [])
    .map((item, index) => {
      if (item.type !== "listItem") throw new UnsupportedContent(item.type);
      const paragraphs = (item.content ?? []).map((child) => {
        // Nested lists and other blocks inside items do not round-trip reliably.
        if (child.type !== "paragraph") throw new UnsupportedContent(`listItem>${child.type}`);
        return inline(child.content);
      });
      const marker = ordered ? `${start + index}.` : "-";
      return `${marker} ${paragraphs.join(" ")}`;
    })
    .join("\n");
}

function block(node: TiptapNode): string {
  switch (node.type) {
    case "paragraph":
      return inline(node.content);
    case "heading": {
      const level = typeof node.attrs?.level === "number" ? node.attrs.level : 1;
      return `${"#".repeat(Math.min(Math.max(level, 1), 6))} ${inline(node.content)}`;
    }
    case "bulletList":
      return listItems(node, false);
    case "orderedList":
      return listItems(node, true);
    case "blockquote":
      return (node.content ?? [])
        .map((child) => {
          if (child.type !== "paragraph") throw new UnsupportedContent(`blockquote>${child.type}`);
          return `> ${inline(child.content)}`;
        })
        .join("\n>\n");
    case "codeBlock": {
      const language = typeof node.attrs?.language === "string" ? node.attrs.language : "";
      const code = (node.content ?? []).map((child) => child.text ?? "").join("");
      return `\`\`\`${language}\n${code}\n\`\`\``;
    }
    case "horizontalRule":
      return "---";
    case "image":
      return inline([node]);
    default:
      throw new UnsupportedContent(node.type);
  }
}

/** Markdown for an editor document, or null when it holds content that would not survive. */
export function tiptapDocumentToMarkdown(json: unknown): string | null {
  const doc = json as TiptapNode | null;
  if (!doc || doc.type !== "doc") return null;
  try {
    return (doc.content ?? [])
      .map(block)
      .filter((text) => text.length > 0)
      .join("\n\n");
  } catch (error) {
    if (error instanceof UnsupportedContent) return null;
    throw error;
  }
}
