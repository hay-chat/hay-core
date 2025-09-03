import { Conversation } from "@server/database/entities/conversation.entity";
import { Message } from "@server/database/entities/message.entity";
import { PlaybookRepository } from "@server/repositories/playbook.repository";
import { LLMService } from "@server/services/orchestrator/llm.service";
import { SystemMessageService } from "@server/services/orchestrator/system-message.service";
import { RagPack, PlaybookState, ConversationContext } from "./types";
import { PlaybookStatus, Playbook } from "@server/database/entities/playbook.entity";
import { vectorStoreService, SearchResult } from "@server/services/vector-store.service";

export class RetrievalLayer {
  private playbookRepository: PlaybookRepository;
  private llmService: LLMService;

  constructor() {
    console.log("RetrievalLayer initialized");
    this.playbookRepository = new PlaybookRepository();
    this.llmService = new LLMService();
  }

  async retrieve(humanMessages: Message[], conversation: Conversation): Promise<{
    rag: RagPack | null;
    playbookAction: 'activate' | 'continue' | 'change' | 'none';
    selectedPlaybook?: any;
    systemMessages: Partial<Message>[];
  }> {
    const systemMessages: Partial<Message>[] = [];
    
    const rag = await this.performRAG(humanMessages, conversation);
    if (rag) {
      const ragSystemMessage = SystemMessageService.createRagSystemMessage(rag);
      systemMessages.push(ragSystemMessage);
    }

    const playbookResult = await this.handlePlaybookMatching(conversation);
    if (playbookResult.systemMessage) {
      systemMessages.push(playbookResult.systemMessage);
    }

    return {
      rag,
      playbookAction: playbookResult.action,
      selectedPlaybook: playbookResult.playbook,
      systemMessages
    };
  }

  private async performRAG(humanMessages: Message[], conversation: Conversation): Promise<RagPack | null> {
    try {
      const query = this.constructRAGQuery(humanMessages);
      if (!query.trim()) {
        return null;
      }

      // Initialize vector store if not already done
      if (!vectorStoreService.initialized) {
        await vectorStoreService.initialize();
      }

      // Perform vector similarity search
      const searchResults = await vectorStoreService.search(
        conversation.organization_id,
        query,
        5 // Get top 5 most relevant chunks
      );

      // Filter out test data and low relevance results
      const filteredResults = this.filterSearchResults(searchResults);
      
      if (filteredResults.length === 0) {
        return null;
      }

      return {
        query,
        results: filteredResults.map((result) => ({
          docId: result.metadata?.document_id || result.id,
          chunkId: result.id,
          sim: result.similarity || 0,
          snippet: this.extractSnippet(result.content, query, 300)
        })),
        version: "v1"
      };
    } catch (error) {
      console.error("Error performing RAG:", error);
      return null;
    }
  }

  private constructRAGQuery(humanMessages: Message[]): string {
    return humanMessages
      .slice(-3)
      .map(msg => msg.content)
      .join(' ')
      .trim();
  }

  private filterSearchResults(results: SearchResult[]): SearchResult[] {
    if (!results) return [];
    
    return results.filter(result => {
      const content = result.content?.toLowerCase() || '';
      const metadata = result.metadata || {};
      
      // Filter out obvious test/example data patterns
      const isFakeData = 
        content.includes('@example.com') ||
        content.includes('1-800-') ||
        content.includes('support@example') ||
        content.includes('test-') ||
        content.includes('example.com') ||
        metadata.source?.toLowerCase().includes('test') ||
        metadata.source?.toLowerCase().includes('example');
      
      // Filter out results with very low similarity scores
      const hasLowSimilarity = (result.similarity || 0) < 0.7;
      
      return !isFakeData && !hasLowSimilarity;
    });
  }

  private extractSnippet(content: string, query: string, maxLength: number): string {
    const queryWords = query.toLowerCase().split(/\s+/);
    const contentLower = content.toLowerCase();
    
    let bestStart = 0;
    let bestScore = 0;
    const windowSize = Math.floor(maxLength / 2);
    
    for (let i = 0; i < content.length - windowSize; i += 50) {
      const window = contentLower.slice(i, i + windowSize);
      const score = queryWords.reduce((acc, word) => 
        acc + (window.includes(word) ? 1 : 0), 0
      );
      
      if (score > bestScore) {
        bestScore = score;
        bestStart = i;
      }
    }
    
    const snippet = content.slice(bestStart, bestStart + maxLength);
    return bestStart > 0 ? '...' + snippet + '...' : snippet + '...';
  }

  private async handlePlaybookMatching(conversation: Conversation): Promise<{
    action: 'activate' | 'continue' | 'change' | 'none';
    playbook?: Playbook;
    systemMessage?: Partial<Message>;
  }> {
    const currentContext = conversation.orchestration_status as ConversationContext | null;
    const currentPlaybook = currentContext?.activePlaybook;

    if (!currentPlaybook) {
      return await this.activateNewPlaybook(conversation);
    }

    const shouldContinue = await this.shouldContinuePlaybook(conversation, currentPlaybook);
    if (shouldContinue) {
      // We need to fetch the full playbook data if we want to return it
      const fullPlaybook = await this.playbookRepository.findById(currentPlaybook.id, conversation.organization_id);
      return {
        action: 'continue',
        playbook: fullPlaybook || undefined
      };
    }

    const newPlaybook = await this.findBetterPlaybook(conversation, currentPlaybook);
    if (newPlaybook) {
      const playbookData = await this.playbookRepository.findById(newPlaybook.id, conversation.organization_id);
      const systemMessage = SystemMessageService.createPlaybookSystemMessage(playbookData);
      
      return {
        action: 'change',
        playbook: newPlaybook,
        systemMessage
      };
    }

    return { action: 'continue' };
  }

  private async activateNewPlaybook(conversation: Conversation): Promise<{
    action: 'activate' | 'none';
    playbook?: Playbook;
    systemMessage?: Partial<Message>;
  }> {
    const playbooks = await this.playbookRepository.findByStatus(
      conversation.organization_id,
      PlaybookStatus.ACTIVE
    );

    if (playbooks.length === 0) {
      return { action: 'none' };
    }

    const bestPlaybook = playbooks[0];
    const systemMessage = SystemMessageService.createPlaybookSystemMessage(bestPlaybook);

    return {
      action: 'activate',
      playbook: bestPlaybook,
      systemMessage
    };
  }

  private async shouldContinuePlaybook(conversation: Conversation, currentPlaybook: PlaybookState): Promise<boolean> {
    const recentMessages = conversation.messages?.slice(-3) || [];
    if (recentMessages.length === 0) return true;

    const continuePrompt = `Based on the recent conversation context, should we continue with the current playbook?

Current Playbook: ${currentPlaybook.id}
Current Step: ${currentPlaybook.stepId}

Recent messages:
${recentMessages.map(m => `${m.sender}: ${m.content}`).join('\n')}

Return true if we should continue, false if we should consider switching.`;

    try {
      const result = await this.llmService.chat<{ continue: boolean }>({
        message: continuePrompt,
        jsonSchema: {
          type: "object",
          properties: {
            continue: { type: "boolean" }
          },
          required: ["continue"]
        }
      });

      return result.continue;
    } catch (error) {
      console.error("Error checking playbook continuation:", error);
      return true;
    }
  }

  private async findBetterPlaybook(conversation: Conversation, currentPlaybook: PlaybookState): Promise<Playbook | null> {
    try {
      const allPlaybooks = await this.playbookRepository.findByStatus(
        conversation.organization_id,
        PlaybookStatus.ACTIVE
      );
      
      const alternativePlaybooks = allPlaybooks.filter(p => p.id !== currentPlaybook.id);

      if (alternativePlaybooks.length === 0) {
        return null;
      }

      return alternativePlaybooks[0];
    } catch (error) {
      console.error("Error finding better playbook:", error);
      return null;
    }
  }
}
