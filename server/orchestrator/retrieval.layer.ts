import { Message } from "@server/database/entities/message.entity";
import { Playbook } from "@server/database/entities/playbook.entity";
import { LLMService } from "../services/core/llm.service";
import { vectorStoreService } from "@server/services/vector-store.service";

interface Document {
  id: string;
  content: string;
  title?: string;
  source?: string;
  similarity?: number;
}

export class RetrievalLayer {
  private llmService: LLMService;

  constructor() {
    // console.log("RetrievalLayer initialized");
    this.llmService = new LLMService();
  }

  async getPlaybookCandidate(
    messages: Message[],
    playbooks: Playbook[]
  ): Promise<Playbook | null> {
    if (playbooks.length === 0) {
      return null;
    }

    const conversationContext = messages.map((msg) => msg.content).join(" ");

    const candidatePrompt = `Given the conversation context below, score how relevant each playbook is (0-1 scale).
      Consider the trigger phrases, descriptions, and overall context match.

      Conversation context: "${conversationContext}"

      Available playbooks:
      ${playbooks
        .map(
          (p) =>
            `- ID: ${p.id}, Title: "${p.title}", Trigger: "${
              p.trigger
            }", Description: "${p.description || "No description"}"`
        )
        .join("\n")}

      For each playbook, provide a relevance score and brief rationale.`;

    const candidateSchema = {
      type: "object",
      properties: {
        candidates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              score: { type: "number", minimum: 0, maximum: 1 },
              rationale: { type: "string" },
            },
            required: ["id", "score", "rationale"],
          },
        },
      },
      required: ["candidates"],
    };

    const result = await this.llmService.invoke({
      prompt: candidatePrompt,
      jsonSchema: candidateSchema,
    });

    const parsed = JSON.parse(result) as {
      candidates: Array<{ id: string; score: number; rationale: string }>;
    };

    const topCandidate = parsed.candidates
      .filter((c) => c.score > 0.7)
      .sort((a, b) => b.score - a.score)[0];

    if (!topCandidate) {
      return null;
    }

    return playbooks.find((p) => p.id === topCandidate.id) || null;
  }

  async getRelevantDocuments(
    messages: Message[],
    organizationId: string
  ): Promise<Document[]> {
    try {
      // Get customer messages for context
      const customerMessages = messages
        .filter((msg) => msg.type === "Customer")
        .slice(-3);

      if (customerMessages.length === 0) {
        return [];
      }

      const query = customerMessages
        .map((msg) => msg.content)
        .join(" ")
        .trim();

      if (!query) {
        return [];
      }

      if (!vectorStoreService.initialized) {
        await vectorStoreService.initialize();
      }
      const searchResults = await vectorStoreService.search(
        organizationId,
        query,
        5 // Get top 5 most relevant chunks
      );

      if (!searchResults || searchResults.length === 0) {
        return [];
      }

      // Filter out low relevance results
      const filteredResults = searchResults.filter(
        (result) => (result.similarity || 0) > 0.4
      );

      console.log(
        `[RetrievalLayer] After filtering: ${filteredResults.length} results remain`
      );

      return filteredResults.map((result) => ({
        id: result.metadata?.document_id || result.id,
        content: this.limitDocumentSize(result.content),
        title:
          result.metadata?.title ||
          result.metadata?.filename ||
          `Document ${result.id}`,
        source:
          result.metadata?.sourceUrl || result.metadata?.source || "unknown",
        similarity: result.similarity || 0,
      }));
    } catch (error) {
      console.error("[RetrievalLayer] Error retrieving documents:", error);
      return [];
    }
  }

  private limitDocumentSize(content: string, maxSize: number = 8000): string {
    if (content.length <= maxSize) {
      return content;
    }
    return content.substring(0, maxSize) + "...";
  }
}
