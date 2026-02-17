import { marked } from "marked";
import { generateJSON } from "@tiptap/html";
import StarterKit from "@tiptap/starter-kit";
import type { JSONContent } from "@tiptap/vue-3";

export interface MentionReferences {
  actions: Array<{ id: string; name: string; pluginId: string; pluginName: string }>;
  documents: Array<{ id: string; title: string }>;
}

const MENTION_TOKEN_REGEX = /<<(action|document):([^>]+)>>/g;

/**
 * Converts a markdown string into TipTap-compatible ProseMirror JSON.
 *
 * Uses the same StarterKit configuration as BaseTiptap.vue so the output
 * is guaranteed to be compatible with the playbook instructions editor.
 *
 * When `references` is provided, inline tokens like `<<action:pluginId:toolName>>`
 * and `<<document:uuid>>` are converted into Tiptap `mention` nodes.
 */
export function markdownToTiptapJSON(
  markdown: string,
  references?: MentionReferences,
): JSONContent {
  const html = marked.parse(markdown, { async: false }) as string;
  const doc = generateJSON(html, [
    StarterKit.configure({
      heading: { levels: [1, 2] },
    }),
  ]);

  if (references) {
    return injectMentionNodes(doc, references);
  }
  return doc;
}

/**
 * Walk the Tiptap JSON tree and replace `<<action:...>>` / `<<document:...>>`
 * text tokens with proper `mention` nodes.
 */
function injectMentionNodes(doc: JSONContent, references: MentionReferences): JSONContent {
  const actionMap = new Map(references.actions.map((a) => [a.id, a]));
  const documentMap = new Map(references.documents.map((d) => [d.id, d]));

  return walkAndReplace(doc, actionMap, documentMap);
}

type ActionRef = MentionReferences["actions"][number];
type DocRef = MentionReferences["documents"][number];

function walkAndReplace(
  node: JSONContent,
  actionMap: Map<string, ActionRef>,
  documentMap: Map<string, DocRef>,
): JSONContent {
  if (!node.content) return node;

  const newContent: JSONContent[] = [];

  for (const child of node.content) {
    if (child.type === "text" && child.text && MENTION_TOKEN_REGEX.test(child.text)) {
      // Reset regex lastIndex since we used .test()
      MENTION_TOKEN_REGEX.lastIndex = 0;
      const expanded = splitTextNode(child, actionMap, documentMap);
      newContent.push(...expanded);
    } else if (child.content) {
      newContent.push(walkAndReplace(child, actionMap, documentMap));
    } else {
      newContent.push(child);
    }
  }

  return { ...node, content: newContent };
}

/**
 * Split a text node containing `<<...>>` tokens into an array of
 * text nodes and mention nodes.
 */
function splitTextNode(
  textNode: JSONContent,
  actionMap: Map<string, ActionRef>,
  documentMap: Map<string, DocRef>,
): JSONContent[] {
  const text = textNode.text || "";
  const marks = textNode.marks;
  const result: JSONContent[] = [];

  let lastIndex = 0;
  const regex = /<<(action|document):([^>]+)>>/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Text before the token
    if (match.index > lastIndex) {
      result.push({ type: "text", text: text.slice(lastIndex, match.index), marks });
    }

    const tokenType = match[1]; // "action" or "document"
    const payload = match[2]; // "pluginId:toolName" or "docId"

    if (tokenType === "action") {
      const actionRef = actionMap.get(payload);
      if (actionRef) {
        result.push({
          type: "mention",
          attrs: {
            id: actionRef.id,
            type: "action",
            label: actionRef.name,
            pluginId: actionRef.pluginId,
          },
        });
      } else {
        // Graceful fallback: keep the payload as plain text
        result.push({ type: "text", text: payload, marks });
      }
    } else if (tokenType === "document") {
      const docRef = documentMap.get(payload);
      if (docRef) {
        result.push({
          type: "mention",
          attrs: {
            id: docRef.id,
            type: "document",
            label: docRef.title,
            pluginId: null,
          },
        });
      } else {
        result.push({ type: "text", text: payload, marks });
      }
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last token
  if (lastIndex < text.length) {
    result.push({ type: "text", text: text.slice(lastIndex), marks });
  }

  return result.length > 0 ? result : [textNode];
}

/**
 * Replace `<<action:...>>` and `<<document:...>>` tokens in a markdown string
 * with styled HTML spans for preview rendering.
 */
export function renderTokensForPreview(markdown: string, references: MentionReferences): string {
  const actionMap = new Map(references.actions.map((a) => [a.id, a]));
  const documentMap = new Map(references.documents.map((d) => [d.id, d]));

  return markdown.replace(/<<(action|document):([^>]+)>>/g, (_, type, payload) => {
    if (type === "action") {
      const ref = actionMap.get(payload);
      const label = ref ? ref.name : payload;
      return `<span class="mention-token mention-action">${label}</span>`;
    } else {
      const ref = documentMap.get(payload);
      const label = ref ? ref.title : payload;
      return `<span class="mention-token mention-document">${label}</span>`;
    }
  });
}
