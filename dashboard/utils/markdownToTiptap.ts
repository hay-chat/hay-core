import { marked } from "marked";
import { generateJSON } from "@tiptap/html";
import StarterKit from "@tiptap/starter-kit";
import type { JSONContent } from "@tiptap/vue-3";

/**
 * Converts a markdown string into TipTap-compatible ProseMirror JSON.
 *
 * Uses the same StarterKit configuration as BaseTiptap.vue so the output
 * is guaranteed to be compatible with the playbook instructions editor.
 */
export function markdownToTiptapJSON(markdown: string): JSONContent {
  const html = marked.parse(markdown, { async: false }) as string;
  return generateJSON(html, [
    StarterKit.configure({
      heading: { levels: [1, 2] },
    }),
  ]);
}
