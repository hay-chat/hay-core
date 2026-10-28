import { generateHTML, generateJSON } from "@tiptap/html";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import type { JSONContent } from "@tiptap/vue-3";
import { markdownToHtml } from "@/utils/markdownToHtml";

// Same schema as DocumentTiptap.vue, so the result opens in the document editor.
const documentExtensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
  Link.configure({ protocols: ["http", "https", "mailto"] }),
  Image.configure({ inline: false }),
];

/**
 * Markdown (from the knowledge "Improve" suggestion) → the editor JSON and
 * HTML a document saved from the dashboard editor stores.
 */
export function markdownToDocumentContent(markdown: string): {
  json: JSONContent;
  html: string;
} {
  const json = generateJSON(markdownToHtml(markdown), documentExtensions) as JSONContent;
  return { json, html: generateHTML(json, documentExtensions) };
}
