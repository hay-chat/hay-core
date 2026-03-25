import { Message } from "@server/database/entities/message.entity";
import { Playbook } from "@server/database/entities/playbook.entity";
import { LLMService } from "../services/core/llm.service";
import { vectorStoreService } from "@server/services/vector-store.service";
import { PromptService } from "../services/prompt.service";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("retrieval");

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
    logger.debug("RetrievalLayer initialized");
  }

  async getPlaybookCandidate(
    messages: Message[],
    playbooks: Playbook[],
    organizationId?: string,
  ): Promise<Playbook | null> {
    logger.debug({
      messagesCount: messages.length,
      playbooksCount: playbooks.length,
      organizationId
    }, "Starting playbook candidate selection");

    if (playbooks.length === 0) {
      logger.debug("No playbooks available, returning null");
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
            additionalProperties: false,
          },
        },
      },
      required: ["candidates"],
      additionalProperties: false,
    };

    logger.debug("Invoking LLM for playbook selection");

    const result = await this.llmService.invoke({
      prompt: candidatePrompt,
      jsonSchema: candidateSchema,
    });

    const parsed = JSON.parse(result) as {
      candidates: Array<{ id: string; score: number; rationale: string }>;
    };

    logger.debug({
      candidatesCount: parsed.candidates.length,
      candidates: parsed.candidates.map((c) => ({
        id: c.id,
        score: c.score,
        rationale: c.rationale.substring(0, 100)
      }))
    }, "Playbook candidate analysis complete");

    const topCandidate = parsed.candidates
      .filter((c) => c.score > 0.7)
      .sort((a, b) => b.score - a.score)[0];

    if (!topCandidate) {
      logger.debug("No playbook candidate scored above 0.7, returning null");
      return null;
    }

    const selectedPlaybook = playbooks.find((p) => p.id === topCandidate.id) || null;

    if (selectedPlaybook) {
      logger.debug({
        playbookId: selectedPlaybook.id,
        playbookTitle: selectedPlaybook.title,
        score: topCandidate.score,
        rationale: topCandidate.rationale
      }, "Playbook selected");
    } else {
      logger.debug({
        candidateId: topCandidate.id
      }, "Playbook candidate ID not found in available playbooks");
    }

    return selectedPlaybook;
  }

  async getRelevantDocuments(messages: Message[], organizationId: string): Promise<Document[]> {
    try {
      logger.debug({
        messagesCount: messages.length,
        organizationId
      }, "Starting document retrieval");

      // Get customer messages for context
      const customerMessages = messages.filter((msg) => msg.type === "Customer").slice(-3);

      logger.debug({
        customerMessagesCount: customerMessages.length,
        totalMessagesCount: messages.length
      }, "Filtered customer messages");

      if (customerMessages.length === 0) {
        logger.debug("No customer messages found, skipping document retrieval");
        return [];
      }

      const query = customerMessages
        .map((msg) => msg.content)
        .join(" ")
        .trim();

      logger.debug({
        queryLength: query.length,
        queryPreview: query.substring(0, 150)
      }, "Built search query");

      if (!query) {
        logger.debug("Empty query after trimming, skipping document retrieval");
        return [];
      }

      if (!vectorStoreService.initialized) {
        logger.debug("Vector store not initialized, initializing now");
        await vectorStoreService.initialize();
      }

      logger.debug({
        organizationId,
        topK: 5
      }, "Searching vector store");

      const searchResults = await vectorStoreService.search(
        organizationId,
        query,
        5, // Get top 5 most relevant chunks
      );

      logger.debug({
        resultsCount: searchResults?.length || 0,
        results: searchResults?.map((r) => ({
          documentId: r.documentId,
          similarity: r.similarity,
          contentPreview: r.content?.substring(0, 100)
        }))
      }, "Vector store search complete");

      if (!searchResults || searchResults.length === 0) {
        logger.debug("No search results found");
        return [];
      }

      // Filter out low relevance results
      const filteredResults = searchResults.filter((result) => (result.similarity || 0) > 0.4);

      logger.debug({
        threshold: 0.4,
        beforeCount: searchResults.length,
        afterCount: filteredResults.length,
        filtered: filteredResults.map((r) => ({
          documentId: r.documentId,
          similarity: r.similarity
        }))
      }, "Filtered documents by similarity threshold");

      const documents = filteredResults.map((result) => ({
        id: result.documentId,
        similarity: result.similarity || 0,
      }));

      logger.debug({
        documentsCount: documents.length,
        documents
      }, "Document retrieval complete");

      return documents;
    } catch (error) {
      logger.error({ err: error }, "Error retrieving documents");
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
