import { PlaybookService } from "./playbook.service";
import { PromptService } from "./prompt.service";
import { LLMService } from "./core/llm.service";
import { conversationRepository } from "../repositories/conversation.repository";
import { formatTiptapInstructions, normalizeMentionTokens } from "../utils/tiptap-formatter";
import type {
  PlaybookInstructions,
  TiptapDocument,
  InstructionItem,
} from "../database/entities/playbook.entity";
import { Message, MessageType } from "../database/entities/message.entity";

export interface MentionReferences {
  actions: Array<{ id: string; name: string; pluginId: string; pluginName: string }>;
  documents: Array<{ id: string; title: string }>;
}

export interface SuggestEditsInput {
  organizationId: string;
  playbookId: string;
  conversationId?: string;
  feedback?: string;
  selection?: string;
}

export interface SuggestEditsResult {
  currentMarkdown: string;
  revisedMarkdown: string;
  analysis: string;
  changes: Array<{
    section: string;
    changeType: "added" | "modified" | "removed";
    rationale: string;
  }>;
  noChangesNeeded: boolean;
  references: MentionReferences;
  baseVersionId: string | null;
}

const MENTION_TOKEN_REGEX = /<<(action|document):([^>]+)>>/g;
const MAX_TRANSCRIPT_MESSAGES = 60;
const MAX_TRANSCRIPT_CHARS = 12_000;
const MAX_TOOL_OUTPUT_CHARS = 600;

function stripWrappingCodeFence(markdown: string): string {
  const trimmed = markdown.trim();
  const match = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return match ? match[1].trim() : markdown;
}

const PLAYBOOK_SENTINEL_REGEX = /<<<BEGIN_PLAYBOOK>>>\s*([\s\S]*?)\s*<<<END_PLAYBOOK>>>/;

// Prompt-only section headings that must never survive into the playbook.
const PROMPT_SCAFFOLD_HEADINGS = [
  "## Available Actions (allowlist)",
  "## Available Documents (allowlist)",
  "## Conversation to Analyze",
  "## User Feedback",
  "## Scope Restriction",
  "## Your Task",
];

/**
 * Defensive cleanup for the LLM echoing prompt scaffolding into its output:
 * keep only the content between the playbook sentinels when present, cut any
 * echoed prompt sections, and drop an echoed preamble before the document's
 * first line.
 */
export function sanitizeRevisedMarkdown(revised: string, currentMarkdown: string): string {
  let out = revised;

  const sentinel = PLAYBOOK_SENTINEL_REGEX.exec(out);
  if (sentinel) out = sentinel[1];
  out = out.replace(/<<<(BEGIN|END)_PLAYBOOK>>>/g, "").trim();

  for (const heading of PROMPT_SCAFFOLD_HEADINGS) {
    const index = out.indexOf(heading);
    if (index !== -1) out = out.slice(0, index).trimEnd();
  }

  const firstLine = currentMarkdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine) {
    const index = out.indexOf(firstLine);
    if (index > 0 && /## (Playbook:|Current Instructions)/.test(out.slice(0, index))) {
      out = out.slice(index);
    }
  }

  return out.trim();
}

function isTiptapDocument(instructions: PlaybookInstructions): instructions is TiptapDocument {
  return (
    typeof instructions === "object" &&
    instructions !== null &&
    !Array.isArray(instructions) &&
    (instructions as TiptapDocument).type === "doc"
  );
}

/**
 * Walk a Tiptap document and collect mention nodes into a references map so
 * `<<action:...>>` / `<<document:...>>` tokens can be resolved back into chips.
 */
function collectMentionReferences(instructions: PlaybookInstructions): MentionReferences {
  const references: MentionReferences = { actions: [], documents: [] };
  if (!isTiptapDocument(instructions)) return references;

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
  walk(instructions);
  return references;
}

function instructionsToMarkdown(instructions: PlaybookInstructions): string {
  if (!instructions) return "";
  if (typeof instructions === "string") return normalizeMentionTokens(instructions);
  if (Array.isArray(instructions)) {
    return (instructions as InstructionItem[]).map((item) => item.instructions).join("\n\n");
  }
  // The formatter declares its own stricter TiptapDocument shape; the guard
  // above already ensured type === "doc".
  return normalizeMentionTokens(
    formatTiptapInstructions(
      instructions as unknown as Parameters<typeof formatTiptapInstructions>[0],
    ),
  );
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}… [truncated]` : value;
}

function formatToolMessage(message: Message): string {
  const meta = message.metadata || {};
  const name = meta.toolName || "unknown_tool";
  const input = meta.toolInput ? JSON.stringify(meta.toolInput) : "{}";
  const isError = (meta.toolStatus || "").toUpperCase() !== "SUCCESS";
  const output =
    typeof meta.toolOutput === "string" ? meta.toolOutput : JSON.stringify(meta.toolOutput ?? "");
  const prefix = isError ? "[TOOL ERROR]" : "[Tool call]";
  return `${prefix} ${name}(${truncate(input, 300)}) → ${meta.toolStatus || "UNKNOWN"}: ${truncate(
    output,
    MAX_TOOL_OUTPUT_CHARS,
  )}`;
}

export class PlaybookSuggestionService {
  private playbookService = new PlaybookService();

  /**
   * Build a plain-text transcript of the conversation for LLM analysis,
   * including tool executions (with errors flagged) and handoff events.
   */
  buildTranscript(messages: Message[]): string {
    const lines: string[] = [];

    for (const message of messages.slice(-MAX_TRANSCRIPT_MESSAGES)) {
      switch (message.type) {
        case MessageType.CUSTOMER:
          lines.push(`Customer: ${message.content}`);
          break;
        case MessageType.BOT_AGENT: {
          lines.push(`Agent: ${message.content}`);
          if (message.metadata?.isHandoffMessage) {
            lines.push("[Conversation handed off to a human agent]");
          }
          break;
        }
        case MessageType.TOOL:
          lines.push(formatToolMessage(message));
          break;
        // System prompt and playbook content are provided separately.
        default:
          break;
      }
    }

    let transcript = lines.join("\n");
    if (transcript.length > MAX_TRANSCRIPT_CHARS) {
      transcript = `[earlier messages omitted]\n${transcript.slice(-MAX_TRANSCRIPT_CHARS)}`;
    }
    return transcript;
  }

  /**
   * Strip any `<<action:...>>` / `<<document:...>>` token the LLM produced that
   * is not in the references allowlist (the model must not invent tools),
   * replacing it with its plain payload text.
   */
  private stripUnknownTokens(markdown: string, references: MentionReferences): string {
    const known = new Set([
      ...references.actions.map((a) => `action:${a.id}`),
      ...references.documents.map((d) => `document:${d.id}`),
    ]);
    return markdown.replace(MENTION_TOKEN_REGEX, (token, type: string, payload: string) => {
      return known.has(`${type}:${payload}`) ? token : payload;
    });
  }

  async suggestEdits(input: SuggestEditsInput): Promise<SuggestEditsResult> {
    const { organizationId, playbookId, conversationId, feedback, selection } = input;

    const playbook = await this.playbookService.getPlaybook(organizationId, playbookId);
    if (!playbook) {
      throw new Error("Playbook not found");
    }

    // Suggestions are computed against the draft when one exists (that's what
    // apply writes to), falling back to the active version / playbook row.
    const draft = await this.playbookService.getDraft(organizationId, playbookId);
    const baseInstructions: PlaybookInstructions = draft?.instructions ?? playbook.instructions;
    const baseVersionId = draft?.id ?? playbook.active_version_id;

    const currentMarkdown = instructionsToMarkdown(baseInstructions);
    if (!currentMarkdown.trim()) {
      throw new Error("Playbook has no instructions");
    }
    const references = collectMentionReferences(baseInstructions);

    let transcript = "";
    if (conversationId) {
      const conversation = await conversationRepository.findByIdAndOrganization(
        conversationId,
        organizationId,
      );
      if (!conversation) {
        throw new Error("Conversation not found");
      }
      const messages = await conversationRepository.getMessages(conversationId);
      transcript = this.buildTranscript(messages);
    }

    const prompt = await PromptService.getInstance().getPrompt(
      "playbook/suggest-edits",
      {
        playbookTitle: playbook.title,
        playbookTrigger: playbook.trigger,
        currentInstructions: currentMarkdown,
        transcript,
        feedback: feedback || "",
        selection: selection || "",
        actions: references.actions,
        documents: references.documents,
      },
      { organizationId },
    );

    const jsonSchema = {
      type: "object",
      properties: {
        analysis: { type: "string" },
        revisedInstructions: { type: "string" },
        changes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              section: { type: "string" },
              changeType: { type: "string", enum: ["added", "modified", "removed"] },
              rationale: { type: "string" },
            },
            required: ["section", "changeType", "rationale"],
            additionalProperties: false,
          },
        },
        noChangesNeeded: { type: "boolean" },
      },
      required: ["analysis", "revisedInstructions", "changes", "noChangesNeeded"],
      additionalProperties: false,
    };

    const response = await new LLMService().invoke({
      history: prompt,
      jsonSchema,
      tier: "hard",
      temperature: 0.3,
      max_tokens: 8000,
      organizationId,
    });

    const parsed = JSON.parse(response) as {
      analysis: string;
      revisedInstructions: string;
      changes: SuggestEditsResult["changes"];
      noChangesNeeded: boolean;
    };

    const revisedMarkdown = this.stripUnknownTokens(
      sanitizeRevisedMarkdown(stripWrappingCodeFence(parsed.revisedInstructions), currentMarkdown),
      references,
    );

    return {
      currentMarkdown,
      revisedMarkdown: parsed.noChangesNeeded ? currentMarkdown : revisedMarkdown,
      analysis: parsed.analysis,
      changes: parsed.changes,
      noChangesNeeded: parsed.noChangesNeeded,
      references,
      baseVersionId,
    };
  }
}
