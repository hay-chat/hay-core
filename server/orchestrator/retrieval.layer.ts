import { Message } from "@server/database/entities/message.entity";
import { Playbook } from "@server/database/entities/playbook.entity";
import { LLMService } from "../services/core/llm.service";
import { vectorStoreService } from "@server/services/vector-store.service";
import { PromptService } from "../services/prompt.service";
import { debugLog } from "@server/lib/debug-logger";

interface Document {
  id: string;
  similarity?: number;
}

export class RetrievalLayer {
  private llmService: LLMService;
  private promptService: PromptService;

  constructor() {
    this.llmService = new LLMService();
    this.promptService = PromptService.getInstance();
    debugLog("retrieval", "RetrievalLayer initialized");
  }

  async getPlaybookCandidate(
    messages: Message[],
    playbooks: Playbook[],
    organizationId?: string,
  ): Promise<Playbook | null> {
    debugLog("retrieval", "Starting playbook candidate selection", {
      messagesCount: messages.length,
      playbooksCount: playbooks.length,
      organizationId,
    });

    if (playbooks.length === 0) {
      debugLog("retrieval", "No playbooks available, returning null");
      return null;
    }

    const conversationContext = messages.map((msg) => msg.content).join(" ");

    // Get playbook selection prompt from PromptService
    const candidatePrompt = await this.promptService.getPrompt(
      "retrieval/playbook-selection",
      {
        conversationContext,
        playbooks: playbooks.map((p) => ({
          id: p.id,
          title: p.title,
          trigger: p.trigger,
          description: p.description,
        })),
      },
      { organizationId },
    );

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

    debugLog("retrieval", "Invoking LLM for playbook selection");

    const result = await this.llmService.invoke({
      prompt: candidatePrompt,
      jsonSchema: candidateSchema,
    });

    const parsed = JSON.parse(result) as {
      candidates: Array<{ id: string; score: number; rationale: string }>;
    };

    debugLog("retrieval", "Playbook candidate analysis complete", {
      candidatesCount: parsed.candidates.length,
      candidates: parsed.candidates.map((c) => ({
        id: c.id,
        score: c.score,
        rationale: c.rationale.substring(0, 100),
      })),
    });

    const topCandidate = parsed.candidates
      .filter((c) => c.score > 0.7)
      .sort((a, b) => b.score - a.score)[0];

    if (!topCandidate) {
      debugLog("retrieval", "No playbook candidate scored above 0.7, returning null");
      return null;
    }

    const selectedPlaybook = playbooks.find((p) => p.id === topCandidate.id) || null;

    if (selectedPlaybook) {
      debugLog("retrieval", "Playbook selected", {
        playbookId: selectedPlaybook.id,
        playbookTitle: selectedPlaybook.title,
        score: topCandidate.score,
        rationale: topCandidate.rationale,
      });
    } else {
      debugLog("retrieval", "Playbook candidate ID not found in available playbooks", {
        candidateId: topCandidate.id,
      });
    }

    return selectedPlaybook;
  }

  async getRelevantDocuments(messages: Message[], organizationId: string): Promise<Document[]> {
    try {
      debugLog("retrieval", "Starting document retrieval", {
        messagesCount: messages.length,
        organizationId,
      });

      // Get customer messages for context
      const customerMessages = messages.filter((msg) => msg.type === "Customer").slice(-3);

      debugLog("retrieval", "Filtered customer messages", {
        customerMessagesCount: customerMessages.length,
        totalMessagesCount: messages.length,
      });

      if (customerMessages.length === 0) {
        debugLog("retrieval", "No customer messages found, skipping document retrieval");
        return [];
      }

      const query = customerMessages
        .map((msg) => msg.content)
        .join(" ")
        .trim();

      debugLog("retrieval", "Built search query", {
        queryLength: query.length,
        queryPreview: query.substring(0, 150),
      });

      if (!query) {
        debugLog("retrieval", "Empty query after trimming, skipping document retrieval");
        return [];
      }

      if (!vectorStoreService.initialized) {
        debugLog("retrieval", "Vector store not initialized, initializing now");
        await vectorStoreService.initialize();
      }

      debugLog("retrieval", "Searching vector store", {
        organizationId,
        topK: 5,
      });

      const searchResults = await vectorStoreService.search(
        organizationId,
        query,
        5, // Get top 5 most relevant chunks
      );

      debugLog("retrieval", "Vector store search complete", {
        resultsCount: searchResults?.length || 0,
        results: searchResults?.map((r) => ({
          documentId: r.documentId,
          similarity: r.similarity,
          contentPreview: r.content?.substring(0, 100),
        })),
      });

      if (!searchResults || searchResults.length === 0) {
        debugLog("retrieval", "No search results found");
        return [];
      }

      // Filter out low relevance results
      const filteredResults = searchResults.filter((result) => (result.similarity || 0) > 0.4);

      debugLog("retrieval", "Filtered documents by similarity threshold", {
        threshold: 0.4,
        beforeCount: searchResults.length,
        afterCount: filteredResults.length,
        filtered: filteredResults.map((r) => ({
          documentId: r.documentId,
          similarity: r.similarity,
        })),
      });

      const documents = filteredResults.map((result) => ({
        id: result.documentId,
        similarity: result.similarity || 0,
      }));

      debugLog("retrieval", "Document retrieval complete", {
        documentsCount: documents.length,
        documents,
      });

      return documents;
    } catch (error) {
      debugLog("retrieval", "Error retrieving documents", {
        level: "error",
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
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
