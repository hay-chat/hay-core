/**
 * Playbook instructions as diffable markdown (D7-6), plus the mention
 * references the dashboard's InstructionsDiff needs to render
 * `<<action:...>>` / `<<document:...>>` tokens back as chips.
 *
 * TODO: playbook-suggestion.service.ts keeps private copies of these two
 * helpers; point it here once lane L12a (which owns that file) has merged.
 */

import { formatTiptapInstructions, normalizeMentionTokens } from "../utils/tiptap-formatter";
import type {
  PlaybookInstructions,
  TiptapDocument,
  InstructionItem,
} from "../database/entities/playbook.entity";

export interface MentionReferences {
  actions: Array<{ id: string; name: string; pluginId: string; pluginName: string }>;
  documents: Array<{ id: string; title: string }>;
}

function isTiptapDocument(instructions: PlaybookInstructions): instructions is TiptapDocument {
  return (
    typeof instructions === "object" &&
    instructions !== null &&
    !Array.isArray(instructions) &&
    (instructions as TiptapDocument).type === "doc"
  );
}

export function instructionsToMarkdown(instructions: PlaybookInstructions | null): string {
  if (!instructions) return "";
  if (typeof instructions === "string") return normalizeMentionTokens(instructions);
  if (Array.isArray(instructions)) {
    return (instructions as InstructionItem[]).map((item) => item.instructions).join("\n\n");
  }
  return normalizeMentionTokens(
    formatTiptapInstructions(
      instructions as unknown as Parameters<typeof formatTiptapInstructions>[0],
    ),
  );
}

/** Mentions found in any of the given instructions, each listed once. */
export function collectMentionReferences(
  ...all: Array<PlaybookInstructions | null>
): MentionReferences {
  const references: MentionReferences = { actions: [], documents: [] };
  const seen = new Set<string>();
  const walk = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    const n = node as {
      type?: string;
      attrs?: { id?: string; type?: string; label?: string; pluginId?: string };
      content?: unknown[];
    };
    if (n.type === "mention" && n.attrs?.id && n.attrs.type && !seen.has(n.attrs.id)) {
      seen.add(n.attrs.id);
      if (n.attrs.type === "action") {
        references.actions.push({
          id: n.attrs.id,
          name: n.attrs.label || n.attrs.id.split(":").pop() || n.attrs.id,
          pluginId: n.attrs.pluginId || n.attrs.id.split(":")[0],
          pluginName: n.attrs.pluginId || n.attrs.id.split(":")[0],
        });
      } else if (n.attrs.type === "document") {
        references.documents.push({ id: n.attrs.id, title: n.attrs.label || "Document" });
      }
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  for (const instructions of all) {
    if (instructions && isTiptapDocument(instructions)) walk(instructions);
  }
  return references;
}
