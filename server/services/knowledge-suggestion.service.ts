/**
 * Knowledge "Improve" (D3-6): the suggest-edits flow for knowledge-only
 * answers. From a conversation (and/or the owner's feedback) the AI proposes
 * either an edit to one of the documents the AI used, or a new Q&A document.
 * Nothing is written here: the dashboard shows the diff and the owner saves
 * it through the regular documents.update / documents.create procedures.
 *
 * Only documents written in the dashboard editor can be edited (uploaded,
 * crawled and synced documents are re-imported from their source, so an edit
 * would be lost); for those the AI proposes a Q&A instead.
 */
import { In, Not } from "typeorm";
import { AppDataSource } from "@server/database/data-source";
import { Document, DocumentationStatus, ImportMethod } from "@server/entities/document.entity";
import { conversationRepository } from "@server/repositories/conversation.repository";
import { PromptService } from "./prompt.service";
import { LLMService } from "./core/llm.service";
import { PlaybookSuggestionService } from "./playbook-suggestion.service";
import { tiptapDocumentToMarkdown } from "@server/utils/tiptap-document-markdown";

export interface SuggestKnowledgeInput {
  organizationId: string;
  conversationId?: string;
  /** Restrict the suggestion to this document (the document page's "Improve"). */
  documentId?: string;
  feedback?: string;
}

export interface KnowledgeSuggestionResult {
  mode: "edit" | "add";
  noChangesNeeded: boolean;
  analysis: string;
  changes: Array<{
    section: string;
    changeType: "added" | "modified" | "removed";
    rationale: string;
  }>;
  /** Edit: the document to update. Add: null. */
  documentId: string | null;
  /** Edit: the document's title. Add: the proposed question/title. */
  title: string;
  /** "" for a new Q&A. */
  currentMarkdown: string;
  revisedMarkdown: string;
  /** Edit: the document's updatedAt when the suggestion was made (staleness check). */
  baseUpdatedAt: string | null;
}

interface Candidate {
  id: string;
  title: string;
  editable: boolean;
  markdown: string;
  updatedAt: Date;
}

const MAX_CANDIDATES = 5;
const MAX_DOCUMENT_CHARS = 8000;

export class KnowledgeSuggestionError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "BAD_REQUEST",
  ) {
    super(message);
  }
}

function toCandidate(doc: Document): Candidate {
  const markdown =
    doc.importMethod === ImportMethod.EDITOR && !doc.documentSourceId
      ? tiptapDocumentToMarkdown(doc.contentJson)
      : null;
  return {
    id: doc.id,
    title: doc.title || "Untitled",
    editable: markdown !== null && markdown.trim().length > 0,
    markdown: markdown ?? doc.content ?? "",
    updatedAt: doc.updatedAt,
  };
}

/** Drop a wrapping code fence and echoed document markers. */
function cleanRevised(markdown: string): string {
  const trimmed = markdown.replace(/<<<(BEGIN|END)_DOCUMENT>>>/g, "").trim();
  const match = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return match ? match[1].trim() : trimmed;
}

export class KnowledgeSuggestionService {
  private async loadCandidates(input: SuggestKnowledgeInput): Promise<Candidate[]> {
    const documents = AppDataSource.getRepository(Document);
    if (input.documentId) {
      const doc = await documents.findOneBy({
        id: input.documentId,
        organizationId: input.organizationId,
      });
      if (!doc) throw new KnowledgeSuggestionError("Document not found", "NOT_FOUND");
      const candidate = toCandidate(doc);
      if (!candidate.editable) {
        throw new KnowledgeSuggestionError("Document cannot be edited", "BAD_REQUEST");
      }
      return [candidate];
    }
    return [];
  }

  async suggest(input: SuggestKnowledgeInput): Promise<KnowledgeSuggestionResult> {
    const { organizationId, conversationId, feedback } = input;
    let candidates = await this.loadCandidates(input);

    let transcript = "";
    if (conversationId) {
      const conversation = await conversationRepository.findByIdAndOrganization(
        conversationId,
        organizationId,
      );
      if (!conversation) throw new KnowledgeSuggestionError("Conversation not found", "NOT_FOUND");
      const messages = await conversationRepository.getMessages(conversationId);
      transcript = new PlaybookSuggestionService().buildTranscript(messages);

      if (!input.documentId) {
        // The documents retrieval attached to this conversation, newest first.
        const ids = (conversation.document_ids ?? []).slice(-MAX_CANDIDATES).reverse();
        if (ids.length > 0) {
          const docs = await AppDataSource.getRepository(Document).findBy({
            id: In(ids),
            organizationId,
            status: Not(DocumentationStatus.ARCHIVED),
          });
          candidates = ids
            .map((id) => docs.find((doc) => doc.id === id))
            .filter((doc): doc is Document => !!doc)
            .map(toCandidate);
        }
      }
    }

    const editable = candidates.filter((c) => c.editable);
    const prompt = await PromptService.getInstance().getPrompt(
      "knowledge/suggest-edits",
      {
        transcript,
        feedback: feedback || "",
        documentOnly: input.documentId ? "yes" : "",
        documents: candidates.map((c) => ({
          id: c.id,
          title: c.title,
          editable: c.editable ? "yes" : "no",
          content:
            c.markdown.length > MAX_DOCUMENT_CHARS
              ? `${c.markdown.slice(0, MAX_DOCUMENT_CHARS)}… [truncated]`
              : c.markdown,
        })),
      },
      { organizationId },
    );

    const jsonSchema = {
      type: "object",
      properties: {
        analysis: { type: "string" },
        mode: { type: "string", enum: input.documentId ? ["edit"] : ["edit", "add"] },
        documentId: { type: "string", enum: [...editable.map((c) => c.id), ""] },
        title: { type: "string" },
        revisedContent: { type: "string" },
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
      required: [
        "analysis",
        "mode",
        "documentId",
        "title",
        "revisedContent",
        "changes",
        "noChangesNeeded",
      ],
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
    return this.toResult(JSON.parse(response), candidates, Boolean(input.documentId));
  }

  /** Validate the model's answer against the candidates. Exposed for tests. */
  toResult(
    parsed: {
      analysis?: string;
      mode?: string;
      documentId?: string;
      title?: string;
      revisedContent?: string;
      changes?: KnowledgeSuggestionResult["changes"];
      noChangesNeeded?: boolean;
    },
    candidates: Candidate[],
    documentOnly: boolean,
  ): KnowledgeSuggestionResult {
    const analysis = String(parsed.analysis ?? "");
    const changes = Array.isArray(parsed.changes) ? parsed.changes : [];
    const revised = cleanRevised(String(parsed.revisedContent ?? ""));
    const target =
      parsed.mode === "edit"
        ? candidates.find((c) => c.editable && c.id === parsed.documentId)
        : undefined;

    if (target) {
      const noChanges = Boolean(parsed.noChangesNeeded) || !revised;
      return {
        mode: "edit",
        noChangesNeeded: noChanges,
        analysis,
        changes: noChanges ? [] : changes,
        documentId: target.id,
        title: target.title,
        currentMarkdown: target.markdown,
        revisedMarkdown: noChanges ? target.markdown : revised,
        baseUpdatedAt: target.updatedAt.toISOString(),
      };
    }

    // An edit of a document we cannot edit (or that does not exist) is not
    // turned into a new document: its text would duplicate the original.
    const invalidEdit = parsed.mode === "edit";
    const title = String(parsed.title ?? "")
      .trim()
      .slice(0, 255);
    const noChanges =
      documentOnly || invalidEdit || Boolean(parsed.noChangesNeeded) || !revised || !title;
    return {
      mode: "add",
      noChangesNeeded: noChanges,
      analysis,
      changes: noChanges ? [] : changes,
      documentId: null,
      title,
      currentMarkdown: "",
      revisedMarkdown: noChanges ? "" : revised,
      baseUpdatedAt: null,
    };
  }
}
