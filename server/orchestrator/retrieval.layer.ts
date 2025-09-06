import { Conversation } from "@server/database/entities/conversation.entity";
import { Message } from "@server/database/entities/message.entity";
import { PlaybookRepository } from "@server/repositories/playbook.repository";
import { LLMService } from "@server/services/orchestrator/llm.service";
import { SystemMessageService } from "@server/services/orchestrator/system-message.service";
import { RagPack, PlaybookState, ConversationContext, Perception } from "./types";
import {
  PlaybookStatus,
  Playbook,
} from "@server/database/entities/playbook.entity";
import {
  vectorStoreService,
  SearchResult,
} from "@server/services/vector-store.service";
import { pluginManagerService } from "@server/services/plugin-manager.service";
import { analyzeInstructions, isInstructionsJson } from "@server/utils/instruction-formatter";
import { ContextLayer } from "@server/services/orchestrator/context-layer";
import { ConversationService } from "@server/services/conversation.service";
import { AgentService } from "@server/services/agent.service";
import { PlaybookService } from "@server/services/playbook.service";

export class RetrievalLayer {
  private playbookRepository: PlaybookRepository;
  private llmService: LLMService;
  private contextLayer?: ContextLayer;

  constructor(
    conversationService?: ConversationService,
    agentService?: AgentService,
    playbookService?: PlaybookService
  ) {
    console.log("RetrievalLayer initialized");
    this.playbookRepository = new PlaybookRepository();
    this.llmService = new LLMService();
    
    if (conversationService && agentService && playbookService) {
      this.contextLayer = new ContextLayer(
        conversationService,
        agentService,
        playbookService
      );
    }
  }

  /**
   * Extract referenced actions from playbook instructions using the [action](name) format
   * @param playbook - The playbook object containing instructions
   */
  private extractReferencedActions(playbook: any): string[] {
    if (!playbook) {
      return [];
    }

    const instructions = playbook.instructions || playbook.prompt_template;
    if (!instructions) {
      return [];
    }

    let referencedActions: string[] = [];
    
    if (isInstructionsJson(instructions)) {
      // Use the existing analyzer for JSON instructions
      const analysis = analyzeInstructions(instructions);
      referencedActions = analysis.actions;
    } else if (typeof instructions === 'string') {
      // Parse string instructions for [action](name) patterns
      const actionPattern = /\[action\]\(([^)]+)\)/g;
      let match;
      const actions: string[] = [];
      
      while ((match = actionPattern.exec(instructions)) !== null) {
        actions.push(match[1]);
      }
      
      referencedActions = actions;
    }

    console.log(`[RetrievalLayer] Extracted ${referencedActions.length} referenced actions from playbook '${playbook.title}': [${referencedActions.join(', ')}]`);
    return referencedActions;
  }

  /**
   * Get available tool schemas from all registered plugins, filtered by referenced actions
   * @param referencedActions - Array of action names referenced in playbook instructions
   */
  private getReferencedToolSchemas(referencedActions: string[]): any[] {
    if (!referencedActions || referencedActions.length === 0) {
      console.log(`[RetrievalLayer] No referenced actions found, no tools will be available`);
      return [];
    }

    const allPlugins = pluginManagerService.getAllPlugins();
    const toolSchemas: any[] = [];
    const foundActions: string[] = [];
    
    for (const plugin of allPlugins) {
      const manifest = plugin.manifest as any;
      if (manifest.capabilities?.mcp?.tools && Array.isArray(manifest.capabilities.mcp.tools)) {
        // Filter tools to only include those referenced in the playbook
        // Support both direct tool names (e.g., "create_ticket") and plugin-prefixed names (e.g., "hay-plugin-zendesk_create_ticket")
        const referencedTools = manifest.capabilities.mcp.tools.filter((tool: any) => {
          // Check direct tool name match
          if (referencedActions.includes(tool.name)) {
            return true;
          }
          
          // Check plugin-prefixed name match (e.g., "hay-plugin-zendesk_create_ticket")
          const pluginPrefixedName = `${plugin.manifest.id}_${tool.name}`;
          return referencedActions.includes(pluginPrefixedName);
        });
        
        if (referencedTools.length > 0) {
          // Transform plugin tool schemas to the format expected by the system message
          const pluginTools = referencedTools.map((tool: any) => {
            // Track the action name that was actually referenced (could be prefixed or not)
            const directMatch = referencedActions.find(action => action === tool.name);
            const prefixedMatch = referencedActions.find(action => action === `${plugin.manifest.id}_${tool.name}`);
            const matchedActionName = directMatch || prefixedMatch || tool.name;
            
            foundActions.push(matchedActionName);
            return {
              name: tool.name, // Keep the original tool name for execution
              description: tool.description || tool.label || 'No description available',
              parameters: tool.input_schema || {},
              required: tool.input_schema?.required || []
            };
          });
          
          toolSchemas.push(...pluginTools);
          
          console.log(`[RetrievalLayer] Loaded ${pluginTools.length} referenced tools from plugin '${plugin.name}': [${referencedTools.map((t: { name: string }) => t.name).join(', ')}]`);
        }
      }
    }
    
    // Log any referenced actions that weren't found
    const notFound = referencedActions.filter(action => !foundActions.includes(action));
    if (notFound.length > 0) {
      console.warn(`[RetrievalLayer] Referenced actions not found in any plugin: [${notFound.join(', ')}]`);
    }
    
    console.log(`[RetrievalLayer] Total referenced tools available: ${toolSchemas.length} (${foundActions.join(', ')})`);
    return toolSchemas;
  }

  async retrieve(
    humanMessages: Message[],
    conversation: Conversation,
    perception?: Perception,
    conversationId?: string
  ): Promise<{
    rag: RagPack | null;
    playbookAction: "activate" | "continue" | "change" | "none";
    selectedPlaybook?: Playbook;
    systemMessages: Partial<Message>[];
  }> {
    const systemMessages: Partial<Message>[] = [];

    // Handle RAG with Context Layer if available
    const rag = await this.performRAG(humanMessages, conversation, conversationId);
    if (rag && !this.contextLayer) {
      // Only create old-style system message if Context Layer is not available
      const ragSystemMessage = SystemMessageService.createRagSystemMessage(rag);
      systemMessages.push(ragSystemMessage);
    }

    const playbookResult = await this.handlePlaybookMatching(
      conversation,
      perception,
      conversationId
    );
    if (playbookResult.systemMessage && !this.contextLayer) {
      // Only create old-style system message if Context Layer is not available
      systemMessages.push(playbookResult.systemMessage);
    }

    return {
      rag,
      playbookAction: playbookResult.action,
      selectedPlaybook: playbookResult.playbook,
      systemMessages,
    };
  }

  private async performRAG(
    humanMessages: Message[],
    conversation: Conversation,
    conversationId?: string
  ): Promise<RagPack | null> {
    try {
      const query = this.constructRAGQuery(humanMessages);
      console.log(`[RAG] Constructed query: "${query}"`);

      if (!query.trim()) {
        console.log("[RAG] Empty query, skipping RAG");
        return null;
      }

      // Initialize vector store if not already done
      if (!vectorStoreService.initialized) {
        console.log("[RAG] Initializing vector store...");
        await vectorStoreService.initialize();
      }

      // Perform vector similarity search
      console.log(
        `[RAG] Searching for documents in org: ${conversation.organization_id}`
      );
      const searchResults = await vectorStoreService.search(
        conversation.organization_id,
        query,
        5 // Get top 5 most relevant chunks
      );

      console.log(
        `[RAG] Vector search returned ${searchResults?.length || 0} results`
      );

      // Filter out test data and low relevance results
      const filteredResults = this.filterSearchResults(searchResults);
      console.log(
        `[RAG] After filtering: ${filteredResults.length} results remain`
      );

      if (filteredResults.length === 0) {
        console.log("[RAG] No results after filtering, returning null");
        return null;
      }

      // Log document titles and similarity scores
      console.log("[RAG] Found relevant documents:");
      filteredResults.forEach((result, index) => {
        const title =
          result.metadata?.title ||
          result.metadata?.filename ||
          `Document ${result.id}`;
        const score = (result.similarity || 0).toFixed(3);
        console.log(`  ${index + 1}. "${title}" (similarity: ${score})`);
      });

      // Use Context Layer to add document context if available
      if (this.contextLayer && conversationId) {
        await this.contextLayer.addDocuments(
          conversationId,
          conversation.organization_id,
          filteredResults.map(result => ({
            id: result.id,
            content: this.limitDocumentSize(result.content),
            title: result.metadata?.title || result.metadata?.filename || `Document ${result.id}`,
            source: result.metadata?.sourceUrl || result.metadata?.source,
            similarity: result.similarity
          })),
          query
        );
      }

      return {
        query,
        results: filteredResults.map((result) => ({
          docId: result.metadata?.document_id || result.id,
          chunkId: result.id,
          sim: result.similarity || 0,
          content: this.limitDocumentSize(result.content), // Full document content with size limit
          title:
            result.metadata?.title ||
            result.metadata?.filename ||
            `Document ${result.id}`,
          source: result.metadata?.sourceUrl || result.metadata?.source || "unknown",
        })),
        version: "v1",
      };
    } catch (error) {
      console.error("Error performing RAG:", error);
      return null;
    }
  }

  private constructRAGQuery(humanMessages: Message[]): string {
    return humanMessages
      .slice(-3)
      .map((msg) => msg.content)
      .join(" ")
      .trim();
  }

  private filterSearchResults(results: SearchResult[]): SearchResult[] {
    if (!results) {
      console.log("[RAG] No results to filter");
      return [];
    }

    console.log("[RAG] Filtering results...");
    const filtered = results.filter((result) => {
      const metadata = result.metadata || {};
      const similarity = result.similarity || 0;

      // Filter out results with very low similarity scores
      const hasLowSimilarity = similarity < 0.4;

      const shouldKeep = !hasLowSimilarity;

      if (!shouldKeep) {
        console.log(
          `[RAG] Filtered out document: similarity=${similarity.toFixed(
            3
          )}, title="${metadata.title || metadata.filename || result.id}"`
        );
      }

      return shouldKeep;
    });

    return filtered;
  }

  private limitDocumentSize(content: string): string {
    // Limit document size to prevent token overflow
    // Rough estimate: 1 token ≈ 4 characters, so 8000 chars ≈ 2000 tokens per document
    const MAX_DOCUMENT_SIZE = 8000; // characters

    if (!content || content.length <= MAX_DOCUMENT_SIZE) {
      return content || "";
    }

    // Truncate but try to end on a sentence boundary
    let truncated = content.substring(0, MAX_DOCUMENT_SIZE);
    const lastSentence = Math.max(
      truncated.lastIndexOf("."),
      truncated.lastIndexOf("!"),
      truncated.lastIndexOf("?")
    );

    if (lastSentence > MAX_DOCUMENT_SIZE * 0.8) {
      // If we found a sentence ending in the last 20% of the truncated text, use it
      truncated = truncated.substring(0, lastSentence + 1);
    }

    return truncated + "\n\n[Document truncated for length]";
  }

  private async handlePlaybookMatching(
    conversation: Conversation,
    perception?: Perception,
    conversationId?: string
  ): Promise<{
    action: "activate" | "continue" | "change" | "none";
    playbook?: Playbook;
    systemMessage?: Partial<Message>;
  }> {
    const currentContext =
      conversation.orchestration_status as ConversationContext | null;
    const currentPlaybook = currentContext?.activePlaybook;

    if (!currentPlaybook) {
      return await this.activateNewPlaybook(conversation, perception, conversationId);
    }

    const shouldContinue = await this.shouldContinuePlaybook(
      conversation,
      currentPlaybook
    );
    if (shouldContinue) {
      // We need to fetch the full playbook data if we want to return it
      const fullPlaybook = await this.playbookRepository.findById(
        currentPlaybook.id,
        conversation.organization_id
      );
      return {
        action: "continue",
        playbook: fullPlaybook || undefined,
      };
    }

    const newPlaybook = await this.findBetterPlaybook(
      conversation,
      currentPlaybook
    );
    if (newPlaybook) {
      const playbookData = await this.playbookRepository.findById(
        newPlaybook.id,
        conversation.organization_id
      );
      
      // Use Context Layer to add playbook and tool context if available
      if (this.contextLayer && conversationId && playbookData) {
        // Add playbook context through Context Layer
        await this.contextLayer.addPlaybook(
          conversationId,
          conversation.organization_id,
          playbookData.id,
          this.getReferencedToolSchemas(this.extractReferencedActions(playbookData))
        );
        
        return {
          action: "change",
          playbook: newPlaybook,
          systemMessage: undefined, // Context Layer handles the system message
        };
      } else {
        // Fallback to old system message creation
        const referencedActions = this.extractReferencedActions(playbookData);
        const toolSchemas = this.getReferencedToolSchemas(referencedActions);
        
        console.log(`[RetrievalLayer] Creating playbook system message with ${toolSchemas.length} tool schemas`);
        console.log(`[RetrievalLayer] Tool schemas:`, toolSchemas);
        
        const systemMessage = SystemMessageService.createPlaybookSystemMessage(playbookData, toolSchemas);

        return {
          action: "change",
          playbook: newPlaybook,
          systemMessage,
        };
      }
    }

    return { action: "continue" };
  }

  private async activateNewPlaybook(
    conversation: Conversation,
    perception?: Perception,
    conversationId?: string
  ): Promise<{
    action: "activate" | "none";
    playbook?: Playbook;
    systemMessage?: Partial<Message>;
  }> {
    // If we have perception data with playbook candidates, use those
    if (
      perception?.playbookCandidates &&
      perception.playbookCandidates.length > 0
    ) {
      const bestCandidate = perception.playbookCandidates[0];
      const playbook = await this.playbookRepository.findById(
        bestCandidate.id,
        conversation.organization_id
      );

      if (playbook) {
        // Use Context Layer to add playbook and tool context if available
        if (this.contextLayer && conversationId) {
          // Add playbook context through Context Layer
          await this.contextLayer.addPlaybook(
            conversationId,
            conversation.organization_id,
            playbook.id,
            this.getReferencedToolSchemas(this.extractReferencedActions(playbook))
          );
          
          return {
            action: "activate",
            playbook,
            systemMessage: undefined, // Context Layer handles the system message
          };
        } else {
          // Fallback to old system message creation
          const referencedActions = this.extractReferencedActions(playbook);
          const toolSchemas = this.getReferencedToolSchemas(referencedActions);
          
          console.log(`[RetrievalLayer] Activating new playbook with ${toolSchemas.length} tool schemas`);
          console.log(`[RetrievalLayer] Tool schemas:`, toolSchemas);
          
          const systemMessage = SystemMessageService.createPlaybookSystemMessage(playbook, toolSchemas);
          return {
            action: "activate",
            playbook,
            systemMessage,
          };
        }
      }
    }

    // Fallback to old behavior if no candidates or candidate not found
    const playbooks = await this.playbookRepository.findByStatus(
      conversation.organization_id,
      PlaybookStatus.ACTIVE
    );

    if (playbooks.length === 0) {
      return { action: "none" };
    }

    // Don't activate any playbook if we don't have good candidates
    // This prevents random playbook activation
    return { action: "none" };
  }

  private async shouldContinuePlaybook(
    conversation: Conversation,
    currentPlaybook: PlaybookState
  ): Promise<boolean> {
    const recentMessages = conversation.messages?.slice(-3) || [];
    if (recentMessages.length === 0) return true;

    const continuePrompt = `Based on the recent conversation context, should we continue with the current playbook?

Current Playbook: ${currentPlaybook.id}
Current Step: ${currentPlaybook.stepId}

Recent messages:
${recentMessages.map((m) => `${m.sender}: ${m.content}`).join("\n")}

Return true if we should continue, false if we should consider switching.`;

    try {
      const result = await this.llmService.chat<{ continue: boolean }>({
        message: continuePrompt,
        jsonSchema: {
          type: "object",
          properties: {
            continue: { type: "boolean" },
          },
          required: ["continue"],
        },
      });

      return result.continue;
    } catch (error) {
      console.error("Error checking playbook continuation:", error);
      return true;
    }
  }

  private async findBetterPlaybook(
    conversation: Conversation,
    currentPlaybook: PlaybookState
  ): Promise<Playbook | null> {
    try {
      const allPlaybooks = await this.playbookRepository.findByStatus(
        conversation.organization_id,
        PlaybookStatus.ACTIVE
      );

      const alternativePlaybooks = allPlaybooks.filter(
        (p) => p.id !== currentPlaybook.id
      );

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
