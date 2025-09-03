import type { ExecutionResult, OrchestrationPlan, DocumentUsed, PlaybookStatus as PlaybookStatusType } from "./types";
import { PlaybookService } from "../playbook.service";
import { VectorStoreService } from "../vector-store.service";
import { AgentService } from "../agent.service";
import { Hay } from "../hay.service";
import { MessageType } from "../../database/entities/message.entity";
import { StatusManager } from "./status-manager";
import { ConversationService } from "../conversation.service";

/**
 * Handles the execution of playbooks and AI-driven conversation responses.
 * Integrates RAG (Retrieval-Augmented Generation) with conversation context.
 */
export class PlaybookExecution {
  private statusManager?: StatusManager;

  /**
   * Creates a new PlaybookExecution instance.
   * @param playbookService - Service for managing playbooks
   * @param vectorStoreService - Service for vector-based document retrieval
   * @param agentService - Service for managing agents
   * @param conversationService - Optional service for conversation management
   */
  constructor(
    private playbookService: PlaybookService,
    private vectorStoreService: VectorStoreService,
    private agentService: AgentService,
    private conversationService?: ConversationService
  ) {
    if (conversationService) {
      this.statusManager = new StatusManager(conversationService);
    }
  }

  /**
   * Executes a playbook or default AI response based on the orchestration plan.
   * Incorporates RAG context and conversation history for enhanced responses.
   * @param plan - The orchestration plan determining execution path
   * @param conversation - The current conversation object
   * @param messages - Array of conversation messages
   * @param organizationId - The ID of the organization
   * @param userMessage - Optional specific user message to process
   * @returns Execution result with content and metadata
   */
  async execute(
    plan: OrchestrationPlan,
    conversation: any,
    messages: any[],
    organizationId: string,
    userMessage?: string
  ): Promise<ExecutionResult> {
    console.log(`[Orchestrator] Looking for playbook ${plan.playbookId}`);
    const playbook = plan.playbookId
      ? await this.playbookService.getPlaybook(plan.playbookId, organizationId)
      : null;

    // Update status with current playbook
    if (this.statusManager && playbook) {
      await this.statusManager.startPlaybookExecution(
        conversation.id,
        organizationId,
        {
          id: playbook.id,
          title: playbook.title,
          trigger: playbook.trigger
        }
      );
    }

    // Fetch agent if available
    const agent = plan.agentId
      ? await this.agentService.getAgent(organizationId, plan.agentId)
      : null;

    // Initialize Hay service
    Hay.init();

    // Build conversation history for context
    const conversationHistory = this.buildConversationHistory(messages);

    // Use the provided user message or get the last one from messages
    const userPromptContent = userMessage || 
      messages.filter(m => m.type === MessageType.HUMAN_MESSAGE).pop()?.content;
    
    if (!userPromptContent) {
      return {
        content: "I'm ready to help. What can I assist you with today?",
        metadata: { path: "playbook" },
      };
    }

    // RAG: Search for relevant documents
    const { context: ragContext, documents } = await this.searchRelevantDocuments(
      conversation.id, 
      organizationId, 
      userPromptContent
    );
    
    // Update status with documents used
    if (this.statusManager && documents.length > 0) {
      await this.statusManager.setDocumentsUsed(
        conversation.id,
        organizationId,
        documents
      );
    }

    // Construct the prompt
    const { systemPrompt, userPrompt } = this.constructPrompts(
      playbook,
      agent,
      userPromptContent,
      conversationHistory,
      messages,
      ragContext
    );

    try {
      console.log(`[Orchestrator] Generating AI response...`);
      console.log(`[Orchestrator] System prompt length: ${systemPrompt.length} chars`);
      console.log(`[Orchestrator] User prompt: "${userPrompt.substring(0, 100)}..."`);

      // Use Hay service to generate AI response
      const response = await Hay.invokeWithSystemPrompt(
        systemPrompt,
        userPrompt
      );

      console.log(`[Orchestrator] AI response generated: "${response.content.substring(0, 100)}..."`);

      return {
        content: response.content,
        metadata: {
          path: "playbook",
          playbook_id: playbook?.id,
          model: response.model || "gpt-4-turbo-preview",
          prompt_tokens: response.usage_metadata?.prompt_tokens,
          completion_tokens: response.usage_metadata?.completion_tokens,
          total_tokens: response.usage_metadata?.total_tokens,
        },
      };
    } catch (error) {
      console.error(`[Orchestrator] Error generating AI response:`, error);
      
      // Fallback response if AI fails
      return {
        content: "I apologize, but I'm having trouble processing your request at the moment. Please try again or let me connect you with a human representative who can assist you better.",
        metadata: {
          path: "playbook",
          playbook_id: playbook?.id,
        },
      };
    }
  }

  /**
   * Builds a formatted conversation history string from messages.
   * @param messages - Array of conversation messages
   * @returns Formatted conversation history string
   */
  private buildConversationHistory(messages: any[]): string {
    return messages.map(msg => {
      if (msg.type === MessageType.HUMAN_MESSAGE) {
        return `User: ${msg.content}`;
      } else if (msg.type === MessageType.AI_MESSAGE) {
        return `Assistant: ${msg.content}`;
      }
      return null;
    }).filter(Boolean).join('\n');
  }

  /**
   * Searches for relevant documents using vector similarity search.
   * Filters out test data and formats results for context injection.
   * @param conversationId - The conversation ID
   * @param organizationId - The ID of the organization
   * @param userMessage - The user's query for document search
   * @returns Object with formatted context and document list
   */
  private async searchRelevantDocuments(
    conversationId: string,
    organizationId: string, 
    userMessage: string
  ): Promise<{ context: string; documents: DocumentUsed[] }> {
    let ragContext = "";
    const documents: DocumentUsed[] = [];
    
    try {
      // Update status to searching documents
      if (this.statusManager) {
        await this.statusManager.startDocumentSearch(conversationId, organizationId);
      }
      console.log(`[Orchestrator] Searching for relevant documents for query: "${userMessage.substring(0, 100)}..."`);
      
      // Initialize vector store if not already initialized
      if (!this.vectorStoreService.initialized) {
        await this.vectorStoreService.initialize();
      }
      
      // Search for relevant documents
      const searchResults = await this.vectorStoreService.search(
        organizationId,
        userMessage,
        5 // Get top 5 most relevant documents
      );
      
      // Filter out test data
      const filteredSearchResults = this.filterTestData(searchResults);
      
      if (filteredSearchResults && filteredSearchResults.length > 0) {
        console.log(`[Orchestrator] Found ${filteredSearchResults.length} relevant documents (filtered from ${searchResults?.length || 0})`);
        
        // Format the retrieved documents as context
        ragContext = "\n\n## Relevant Information from Knowledge Base:\n";
        filteredSearchResults.forEach((result, index) => {
          ragContext += `\n[Document ${index + 1}] (Relevance: ${(result.similarity || 0).toFixed(2)}):\n`;
          ragContext += result.content;
          if (result.metadata?.source) {
            ragContext += `\n(Source: ${result.metadata.source})`;
          }
          ragContext += "\n";
          
          // Add to documents array for status tracking
          documents.push({
            id: result.id,
            content: result.content.substring(0, 200), // First 200 chars for status
            relevance: result.similarity || 0,
            source: result.metadata?.source
          });
        });
        
        console.log(`[Orchestrator] RAG context added: ${ragContext.length} characters`);
      } else {
        console.log(`[Orchestrator] No relevant documents found in knowledge base`);
      }
    } catch (error) {
      console.error(`[Orchestrator] Error during RAG search:`, error);
      // Continue without RAG context if search fails
    }
    
    return { context: ragContext, documents };
  }

  /**
   * Filters out test/example data from search results.
   * Removes entries containing example domains, test patterns, or fake data.
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
   * Constructs system and user prompts for AI generation.
   * Combines playbook instructions, agent settings, RAG context, and anti-hallucination guidelines.
   * @param playbook - The playbook containing instructions (if any)
   * @param agent - The agent with tone, avoid, and trigger settings
   * @param userPromptContent - The user's message content
   * @param conversationHistory - Formatted conversation history
   * @param messages - Array of conversation messages
   * @param ragContext - Retrieved document context from vector search
   * @returns Object containing system and user prompts
   */
  private constructPrompts(
    playbook: any,
    agent: any,
    userPromptContent: string,
    conversationHistory: string,
    messages: any[],
    ragContext: string
  ): { systemPrompt: string; userPrompt: string } {
    let systemPrompt = "";
    let userPrompt = userPromptContent;

    if (playbook) {
      console.log(`[Orchestrator] Using playbook: ${playbook.title}`);
      // Use playbook instructions if available
      systemPrompt = playbook.prompt_template || playbook.description || "You are a helpful AI assistant.";
      
      // Add any additional context from playbook
      if (playbook.instructions) {
        // Handle both JSON object and string formats for instructions
        const instructionText = typeof playbook.instructions === 'object' 
          ? playbook.instructions.text || JSON.stringify(playbook.instructions)
          : playbook.instructions;
        systemPrompt += `\n\nInstructions:\n${instructionText}`;
      }
    } else {
      console.log(`[Orchestrator] No playbook found, using default AI assistant`);
      // Default system prompt with anti-hallucination instructions
      systemPrompt = `You are a helpful AI assistant. Your role is to assist users with their requests in a friendly and professional manner.
      
      Guidelines:
      - Be helpful and informative based ONLY on information you have been provided
      - Ask clarifying questions when needed
      - Provide clear and concise answers
      - Be polite and professional
      - NEVER make up contact information, URLs, or specific details you don't have
      - When you don't know something, say "I don't have that specific information"
      - For human assistance requests, acknowledge and say you'll help connect them without providing fake contact details`;
    }

    // Add agent-specific instructions if available
    if (agent) {
      if (agent.instructions) {
        systemPrompt += `\n\n## Agent Instructions:\n${agent.instructions}`;
      }
      
      if (agent.tone) {
        systemPrompt += `\n\n## Communication Tone:\n${agent.tone}`;
      }
      
      if (agent.avoid) {
        systemPrompt += `\n\n## Things to Avoid:\n${agent.avoid}`;
      }
      
      if (agent.trigger) {
        systemPrompt += `\n\n## Trigger Conditions:\n${agent.trigger}`;
      }
    }

    // Add conversation flow instructions
    systemPrompt += this.getConversationFlowInstructions(userPromptContent, messages);

    // Add RAG context to system prompt if available
    if (ragContext) {
      systemPrompt += ragContext;
      systemPrompt += "\n\nIMPORTANT: Use ONLY the above information from the knowledge base when answering questions. If the information needed is not available above, you MUST say you don't have that information rather than making something up.";
    }

    // Add strict anti-hallucination instructions
    systemPrompt += this.getAntiHallucinationInstructions();

    // Add conversation context if there's history
    if (conversationHistory && messages.length > 1) {
      systemPrompt += `\n\nConversation history:\n${conversationHistory}`;
    }

    return { systemPrompt, userPrompt };
  }

  /**
   * Generates conversation flow instructions based on user signals.
   * Detects satisfaction, closing signals, and conversation state to guide responses.
   * @param userMessage - The user's current message
   * @param messages - Array of conversation messages for context
   * @returns Conversation flow instructions string
   */
  private getConversationFlowInstructions(userMessage: string, messages: any[]): string {
    const lowerMessage = userMessage.toLowerCase();
    
    // Check if user is expressing satisfaction or completion
    const satisfactionSignals = [
      /thank you|thanks|thx/i,
      /that('s| is) (helpful|great|perfect|all)/i,
      /perfect|awesome|great|excellent/i,
      /that helps|that helped/i,
      /got it|understood|makes sense/i,
      /okay|ok|alright/i,
      /obrigad[oa]|valeu/i,
      /perfeito|ótimo|excelente/i,
      /entendi|compreendi/i,
    ];

    const isSatisfied = satisfactionSignals.some(pattern => pattern.test(userMessage));
    
    // Check if user is saying goodbye or they're done
    const closingSignals = [
      /that('s| is) all/i,
      /no(thing)? (else|more)/i,
      /i('m| am) (good|done|finished)/i,
      /bye|goodbye|see you/i,
      /é só isso|só isso/i,
      /nada mais|mais nada/i,
      /tchau|até/i,
    ];

    const isClosing = closingSignals.some(pattern => pattern.test(userMessage));

    let instructions = `\n\n## Conversation Flow Instructions:\n`;

    if (isSatisfied || isClosing) {
      instructions += `
- The user appears to be satisfied or ending the conversation
`;
      instructions += `- After acknowledging their message, naturally ask if there's anything else you can help with
`;
      instructions += `- Keep your response brief and friendly
`;
      instructions += `- Use natural language like "Is there anything else I can help you with today?" or "Feel free to ask if you need anything else!"
`;
      instructions += `- Don't force the question if it doesn't fit naturally in your response
`;
    } else {
      instructions += `
- Focus on addressing the user's current question or concern
`;
      instructions += `- Only ask if they need more help when it's natural to do so (e.g., after completing a task)
`;
      instructions += `- Don't append "Is there anything else?" to every response
`;
    }

    // Check if this might be a response to "Is there anything else?"
    const lastAssistantMessage = messages
      .filter(m => m.type === MessageType.AI_MESSAGE)
      .pop();
    
    if (lastAssistantMessage?.content.includes("Is there anything else") ||
        lastAssistantMessage?.content.includes("Can I help with anything else")) {
      
      // User is responding to our "anything else" question
      const negativeResponses = /^(no|nope|não|nao|n)$/i;
      const needsMore = /^(yes|yeah|sim|s|yep|sure)$/i;
      
      if (negativeResponses.test(lowerMessage.trim())) {
        instructions += `\n- The user has indicated they don't need more help
`;
        instructions += `- Provide a brief, friendly closing message
`;
        instructions += `- Wish them well and let them know they can return if needed
`;
        instructions += `- Keep it natural and conversational, not robotic
`;
      } else if (needsMore.test(lowerMessage.trim())) {
        instructions += `\n- The user needs more help
`;
        instructions += `- Ask what else you can help them with
`;
        instructions += `- Be engaged and ready to assist
`;
      }
    }

    return instructions;
  }

  /**
   * Provides strict anti-hallucination instructions for AI responses.
   * Ensures the AI doesn't fabricate information like contact details or policies.
   * @returns Anti-hallucination instructions string
   */
  private getAntiHallucinationInstructions(): string {
    return `\n\n## CRITICAL INSTRUCTIONS - NEVER VIOLATE THESE RULES:\n\n1. **NEVER make up or invent information**, especially:
   - Contact information (emails, phone numbers, addresses)
   - Website URLs or portals
   - Support hours or availability
   - Company policies or procedures
   - Product features or specifications
   - Names of people or departments
\n2. **When you don't have specific information**, you MUST:
   - Acknowledge that you don't have that information
   - Offer to help in other ways if possible
   - Suggest that a human representative can provide the specific details
\n3. **NEVER use example or placeholder data** like:
   - "support@example.com" or any @example.com emails
   - "1-800-" numbers or any made-up phone numbers  
   - "example.com" or any fictional websites
   - Generic department names you're not certain exist
\n4. **For requests to speak with a human**:
   - Simply acknowledge the request
   - Say you'll help connect them with a human representative
   - Do NOT provide fake contact information
   - Do NOT make up support hours or availability
\n5. **For conversation flow**:
   - Be natural and conversational
   - Don't force conversation enders into every response
   - When appropriate (like after helping with a task), naturally ask if there's more you can help with
   - Listen for cues that the user is satisfied or done`;
  }
}