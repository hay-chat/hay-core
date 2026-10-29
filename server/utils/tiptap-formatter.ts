/**
 * Tiptap Formatter
 * Converts Tiptap JSON to markdown for AI consumption
 */

interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

interface TiptapDocument {
  type: "doc";
  content?: TiptapNode[];
}

interface InstructionAnalysis {
  formattedText: string;
  actions: string[];
  documents: string[];
  /** The instructions include a "Handoff to human" step (a planned escalation). */
  hasHandoff: boolean;
}

/** Mention `type` for a playbook's "Handoff to human" step. */
export const HANDOFF_MENTION_TYPE = "handoff";

/** Instruction line the handoff step renders into for the planner. */
const HANDOFF_INSTRUCTION = "**Hand off to a human teammate at this point in the process.**";

/** True when the document contains a handoff mention node anywhere in its tree. */
function containsHandoffMention(node: TiptapNode): boolean {
  if (node.type === "mention" && node.attrs?.type === HANDOFF_MENTION_TYPE) {
    return true;
  }
  return (node.content ?? []).some(containsHandoffMention);
}

/**
 * Apply marks (bold, italic, etc.) to text
 */
function applyMarks(text: string, marks?: Array<{ type: string }>): string {
  if (!marks || marks.length === 0) {
    return text;
  }

  let result = text;

  for (const mark of marks) {
    if (mark.type === "bold") {
      result = `**${result}**`;
    } else if (mark.type === "italic") {
      result = `*${result}*`;
    } else if (mark.type === "code") {
      result = `\`${result}\``;
    }
  }

  return result;
}

/**
 * Convert a single Tiptap node to markdown
 */
function convertNodeToMarkdown(
  node: TiptapNode,
  listCounter?: { value: number },
): {
  markdown: string;
  actions: Set<string>;
  documents: Set<string>;
} {
  const actions = new Set<string>();
  const documents = new Set<string>();

  switch (node.type) {
    case "doc": {
      if (!node.content || node.content.length === 0) {
        return { markdown: "", actions, documents };
      }

      const lines: string[] = [];
      const counter = { value: 1 };

      for (const child of node.content) {
        const result = convertNodeToMarkdown(child, counter);
        if (result.markdown) {
          lines.push(result.markdown);
        }
        result.actions.forEach((id) => actions.add(id));
        result.documents.forEach((id) => documents.add(id));
      }

      return { markdown: lines.join("\n\n"), actions, documents };
    }

    case "heading": {
      const level = typeof node.attrs?.level === "number" ? node.attrs.level : 1;
      let text = "";

      if (node.content) {
        for (const child of node.content) {
          const result = convertNodeToMarkdown(child);
          text += result.markdown;
          result.actions.forEach((id) => actions.add(id));
          result.documents.forEach((id) => documents.add(id));
        }
      }

      return {
        markdown: `${"#".repeat(level)} ${text}`,
        actions,
        documents,
      };
    }

    case "paragraph": {
      let text = "";

      if (node.content) {
        for (const child of node.content) {
          const result = convertNodeToMarkdown(child);
          text += result.markdown;
          result.actions.forEach((id) => actions.add(id));
          result.documents.forEach((id) => documents.add(id));
        }
      }

      return { markdown: text, actions, documents };
    }

    case "text": {
      const text = node.text || "";
      const markedText = applyMarks(text, node.marks);
      return { markdown: markedText, actions, documents };
    }

    case "hardBreak": {
      return { markdown: "\n", actions, documents };
    }

    case "orderedList": {
      const items: string[] = [];

      if (node.content) {
        for (const item of node.content) {
          if (item.type === "listItem") {
            const result = convertNodeToMarkdown(item, listCounter);
            items.push(result.markdown);
            result.actions.forEach((id) => actions.add(id));
            result.documents.forEach((id) => documents.add(id));
          }
        }
      }

      return { markdown: items.join("\n"), actions, documents };
    }

    case "bulletList": {
      const items: string[] = [];

      if (node.content) {
        for (const item of node.content) {
          if (item.type === "listItem") {
            const result = convertNodeToMarkdown(item);
            items.push(result.markdown);
            result.actions.forEach((id) => actions.add(id));
            result.documents.forEach((id) => documents.add(id));
          }
        }
      }

      return { markdown: items.join("\n"), actions, documents };
    }

    case "listItem": {
      let text = "";

      if (node.content) {
        for (const child of node.content) {
          const result = convertNodeToMarkdown(child);
          text += result.markdown;
          result.actions.forEach((id) => actions.add(id));
          result.documents.forEach((id) => documents.add(id));
        }
      }

      // Check if this is part of an ordered list
      if (listCounter) {
        const number = listCounter.value++;
        return { markdown: `${number}. ${text}`, actions, documents };
      } else {
        return { markdown: `- ${text}`, actions, documents };
      }
    }

    case "mention": {
      const id = typeof node.attrs?.id === "string" ? node.attrs.id : undefined;
      const type = typeof node.attrs?.type === "string" ? node.attrs.type : undefined;

      // The handoff step carries no id — it is a terminal instruction, not a
      // reference to a tool or document.
      if (type === HANDOFF_MENTION_TYPE) {
        return { markdown: HANDOFF_INSTRUCTION, actions, documents };
      }

      if (id && type) {
        if (type === "action") {
          actions.add(id);
          return { markdown: `[action](${id})`, actions, documents };
        } else if (type === "document") {
          documents.add(id);
          return { markdown: `[document](${id})`, actions, documents };
        }
      }

      // Fallback to just the label
      const label = typeof node.attrs?.label === "string" ? node.attrs.label : "";
      return { markdown: `@${label}`, actions, documents };
    }

    // Keep old format for backward compatibility during migration
    case "actionMergeField": {
      const id = typeof node.attrs?.id === "string" ? node.attrs.id : undefined;
      if (id) {
        actions.add(id);
        return { markdown: `[action](${id})`, actions, documents };
      }
      return { markdown: "", actions, documents };
    }

    case "documentMergeField": {
      const id = typeof node.attrs?.id === "string" ? node.attrs.id : undefined;
      if (id) {
        documents.add(id);
        return { markdown: `[document](${id})`, actions, documents };
      }
      return { markdown: "", actions, documents };
    }

    default:
      // For unknown node types, try to process content
      if (node.content) {
        let text = "";
        for (const child of node.content) {
          const result = convertNodeToMarkdown(child);
          text += result.markdown;
          result.actions.forEach((id) => actions.add(id));
          result.documents.forEach((id) => documents.add(id));
        }
        return { markdown: text, actions, documents };
      }
      return { markdown: "", actions, documents };
  }
}

/**
 * Analyze Tiptap instructions and convert to markdown
 *
 * @param tiptapData - Tiptap JSON output data
 * @returns Analysis object with formatted markdown text and extracted references
 */
export function analyzeTiptapInstructions(
  tiptapData: TiptapDocument | null | undefined,
): InstructionAnalysis {
  if (
    !tiptapData ||
    tiptapData.type !== "doc" ||
    !tiptapData.content ||
    tiptapData.content.length === 0
  ) {
    return {
      formattedText: "",
      actions: [],
      documents: [],
      hasHandoff: false,
    };
  }

  const result = convertNodeToMarkdown(tiptapData);

  return {
    formattedText: result.markdown,
    actions: Array.from(result.actions),
    documents: Array.from(result.documents),
    hasHandoff: containsHandoffMention(tiptapData),
  };
}

/**
 * Convert the formatter's `[action](id)` / `[document](id)` mention links into
 * the `<<action:id>>` / `<<document:id>>` token form consumed by the dashboard's
 * markdownToTiptap converter and used as the LLM-facing reference format.
 */
export function normalizeMentionTokens(markdown: string): string {
  return markdown
    .replace(/\[action\]\(([^)\s]+)\)/g, "<<action:$1>>")
    .replace(/\[document\]\(([^)\s]+)\)/g, "<<document:$1>>");
}

/**
 * Format instructions for display - handles Tiptap format
 *
 * @param instructions - Instructions in Tiptap format or null
 * @returns Formatted markdown string ready for display
 */
export function formatTiptapInstructions(instructions: TiptapDocument | null | undefined): string {
  if (!instructions) {
    return "No specific instructions provided.";
  }

  const analysis = analyzeTiptapInstructions(instructions);
  return analysis.formattedText || "No specific instructions provided.";
}
