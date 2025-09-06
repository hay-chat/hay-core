import type { ExecutionResult } from "./types";
import { VectorStoreService } from "../vector-store.service";
import { Hay } from "../hay.service";
import { ContextLayer } from "./context-layer";
import { ConversationService } from "../conversation.service";
import { AgentService } from "../agent.service";
import { PlaybookService } from "../playbook.service";

/**
 * Handles document retrieval and question answering using vector search.
 * Retrieves relevant documents and generates AI responses based on them.
 */
export class DocumentRetrieval {
  private contextLayer?: ContextLayer;

  /**
   * Creates a new DocumentRetrieval instance.
   * @param vectorStoreService - Service for vector-based document search
   * @param conversationService - Optional service for conversation management
   * @param agentService - Optional service for agent management
   * @param playbookService - Optional service for playbook management
   */
  constructor(
    private vectorStoreService: VectorStoreService,
    conversationService?: ConversationService,
    agentService?: AgentService,
    playbookService?: PlaybookService
  ) {
    if (conversationService && agentService && playbookService) {
      this.contextLayer = new ContextLayer(
        conversationService,
        agentService,
        playbookService
      );
    }
  }

  /**
   * Executes document retrieval and generates an answer based on found documents.
   * Filters out test data and formats results with citations.
   * @param query - The user's query to answer
   * @param organizationId - The ID of the organization
   * @param conversationId - Optional conversation ID for context tracking
   * @returns Execution result with generated answer and metadata
   */
  async execute(
    query: string,
    organizationId: string,
    conversationId?: string
  ): Promise<ExecutionResult> {
    try {
      // Search for relevant documents
      const results = await this.vectorStoreService.search(
        organizationId,
        query,
        5
      );

      // Filter out test data and potentially fake information
      const filteredResults = this.filterTestData(results);

      if (!filteredResults || filteredResults.length === 0) {
        return {
          content:
            "I don't have specific information about that in my knowledge base. I'd be happy to help you with other questions, or I can connect you with a human representative who might have more details.",
          includeEnder: false,
          metadata: {
            path: "docqa",
            confidence: 0,
          },
        };
      }

      // Use Context Layer to add document context if conversation ID is provided
      if (this.contextLayer && conversationId) {
        await this.contextLayer.addDocuments(
          conversationId,
          organizationId,
          filteredResults.map(result => ({
            id: result.id,
            content: result.content,
            title: result.title || `Document`,
            source: result.metadata?.source,
            similarity: result.similarity
          })),
          query
        );
      }

      // Format results with citations
      const formattedResults = this.formatResultsWithCitations(filteredResults);

      const prompt = `Based on the following information, answer the user's question: "${query}"\n\nRelevant information:\n${formattedResults}\n\nProvide a concise, helpful answer with citations.`;

      // Use Hay service to generate response
      const response = await Hay.invoke(prompt);

      return {
        content: response.content,
        metadata: {
          path: "docqa",
          confidence: results[0]?.similarity || 0,
          model: response.model,
        },
      };
    } catch (error) {
      console.error("Document retrieval error:", error);
      return {
        content:
          "I encountered an issue while searching for information. Would you like to speak with a human representative?",
        includeEnder: false,
        metadata: {
          path: "docqa",
          confidence: 0,
        },
      };
    }
  }

  /**
   * Filters out test and example data from search results.
   * Removes entries containing example domains or test patterns.
   * @param results - Array of search results to filter
   * @returns Filtered array excluding test data
   */
  private filterTestData(results: any[]): any[] {
    if (!results) return [];
    
    return results.filter(r => {
      const content = r.content?.toLowerCase() || '';
      const metadata = r.metadata || {};
      
      // Check for obvious test/example data patterns
      const isFakeData = 
        content.includes('@example.com') ||
        content.includes('1-800-') ||
        content.includes('support@example') ||
        content.includes('test-') ||
        content.includes('example.com') ||
        metadata.source?.toLowerCase().includes('test') ||
        metadata.source?.toLowerCase().includes('example');
      
      return !isFakeData;
    });
  }

  /**
   * Formats search results with numbered citations.
   * Includes content and source information for each result.
   * @param results - Array of search results to format
   * @returns Formatted string with numbered citations
   */
  private formatResultsWithCitations(results: any[]): string {
    return results
      .map(
        (r, i) =>
          `[${i + 1}] ${r.content} (${
            r.metadata?.source || "Unknown source"
          })`
      )
      .join("\n\n");
  }
}