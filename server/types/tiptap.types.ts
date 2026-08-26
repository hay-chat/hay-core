import { z } from "zod";

/**
 * Rich-text instruction fields (agent instructions, human-handoff instructions) are
 * authored in the dashboard's Tiptap editor and persisted verbatim into jsonb columns.
 * The on-the-wire and at-rest shape is a Tiptap document node: `{ type: "doc", content: [...] }`.
 *
 * Node contents stay opaque on purpose — the server never interprets the tree, it only
 * stores it and renders it back. Only the document envelope is validated so a malformed
 * payload (e.g. a bare array, or Editor.js's legacy `{ blocks: [] }`) is rejected at the
 * boundary instead of corrupting the column.
 */
export const tiptapDocSchema = z
  .object({
    type: z.literal("doc"),
    content: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type TiptapDoc = z.infer<typeof tiptapDocSchema>;

/**
 * True when a document carries authored content. An untouched editor still submits a
 * document envelope (`{ type: "doc", content: [] }`), so presence of the column value
 * alone does not mean the user wrote anything.
 */
export function hasTiptapContent(value: TiptapDoc | null | undefined): value is TiptapDoc {
  return Boolean(value?.content?.length);
}
