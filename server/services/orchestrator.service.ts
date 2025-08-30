import { MessageType } from "../database/entities/message.entity";
import { ConversationService } from "./conversation.service";
import { PlaybookService } from "./playbook.service";
import { AgentService } from "./agent.service";
import { Hay } from "./hay.service";
import { VectorStoreService } from "./vector-store.service";
import { config } from "../config/env";

export interface OrchestrationPlan {
  path: "docqa" | "playbook";
  agentId: string;
  playbookId?: string;
  requiredFields?: string[];
  missingFields?: string[];
}

export interface ExecutionResult {
  content: string;
  metadata?: {
    model?: string;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    latency_ms?: number;
    plan?: string;
    path?: "docqa" | "playbook";
    tools?: string[];
    playbook_id?: string;
    confidence?: number;
  };
  includeEnder?: boolean;
  setStatus?: "open" | "pending-human" | "resolved";
}

export class OrchestratorService {
  constructor(
    private conversationService: ConversationService,
    private playbookService: PlaybookService,
    private agentService: AgentService,
    private vectorStoreService: VectorStoreService
  ) {}

  async processConversation(
    conversationId: string,
    organizationId: string
  ): Promise<void> {
    console.log(`[Orchestrator] Processing conversation ${conversationId}`);
    
    const conversation = await this.conversationService.getConversation(
      conversationId,
      organizationId
    );

    if (!conversation) {
      console.log(`[Orchestrator] Conversation ${conversationId} not found`);
      return;
    }
    
    if (conversation.status !== "open") {
      console.log(`[Orchestrator] Conversation ${conversationId} status is ${conversation.status}, skipping`);
      return;
    }

    // Check if cooldown has expired
    if (
      conversation.cooldown_until &&
      new Date(conversation.cooldown_until) > new Date()
    ) {
      console.log(`[Orchestrator] Conversation ${conversationId} is in cooldown until ${conversation.cooldown_until}`);
      return;
    }

    try {
      // Step 1: Agent Routing (if needed)
      let agentId = conversation.agent_id;
      if (!agentId) {
        console.log(`[Orchestrator] No agent assigned, routing...`);
        agentId = await this.routeAgent(organizationId);
        if (!agentId) {
          console.log(`[Orchestrator] No available agents`);
          await this.handleNoAgent(conversationId, organizationId);
          return;
        }
        console.log(`[Orchestrator] Assigned agent ${agentId} to conversation`);
        await this.conversationService.updateConversation(
          conversationId,
          organizationId,
          { agent_id: agentId }
        );
      } else {
        console.log(`[Orchestrator] Using existing agent ${agentId}`);
      }

      // Get recent messages for context
      const messages = await this.conversationService.getLastMessages(
        conversationId,
        organizationId,
        20  // Increased to get more context
      );
      console.log(`[Orchestrator] Found ${messages.length} recent messages`);
      console.log(`[Orchestrator] Message types:`, messages.map(m => ({ id: m.id, type: m.type, sender: m.sender })));
      
      // Find all unprocessed user messages (sent after last AI message)
      let lastAiMessageIndex = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].type === MessageType.AI_MESSAGE) {
          lastAiMessageIndex = i;
          break;
        }
      }
      
      const unprocessedUserMessages = messages.filter((m: any, index: number) => 
        m.type === MessageType.HUMAN_MESSAGE && 
        index > lastAiMessageIndex
      );
      
      if (unprocessedUserMessages.length === 0) {
        console.log(`[Orchestrator] No unprocessed user messages found`);
        return;
      }
      
      // Combine all unprocessed user messages into a single context
      const combinedUserMessage = unprocessedUserMessages
        .map(m => m.content)
        .join('\n');
      
      console.log(`[Orchestrator] Processing ${unprocessedUserMessages.length} unprocessed user messages`);
      console.log(`[Orchestrator] Combined message: "${combinedUserMessage.substring(0, 200)}..."`);

      // Step 2: Planning - determine path
      console.log(`[Orchestrator] Creating execution plan...`);
      const plan = await this.createPlan(
        combinedUserMessage,
        conversation,
        organizationId
      );
      console.log(`[Orchestrator] Plan created: path=${plan.path}, agentId=${plan.agentId}, playbookId=${plan.playbookId}`);

      // Step 3: Execution
      console.log(`[Orchestrator] Starting execution...`);
      const startTime = Date.now();
      let result: ExecutionResult;

      if (plan.path === "docqa") {
        console.log(`[Orchestrator] Executing document retrieval...`);
        result = await this.executeDocumentRetrieval(
          combinedUserMessage,
          organizationId
        );
      } else {
        console.log(`[Orchestrator] Executing playbook ${plan.playbookId}...`);
        result = await this.executePlaybook(
          plan,
          conversation,
          messages,
          organizationId,
          combinedUserMessage
        );
      }

      // Calculate latency
      const latency = Date.now() - startTime;
      console.log(`[Orchestrator] Execution completed in ${latency}ms`);

      // Step 4: Add ender if appropriate
      if (result.includeEnder !== false && !result.setStatus) {
        console.log(`[Orchestrator] Adding ender message...`);
        const enderPlaybook = await this.getActivePlaybook(
          "ender",
          organizationId
        );
        if (enderPlaybook?.prompt_template) {
          result.content += "\n\n" + enderPlaybook.prompt_template;
        }
      }

      // Step 5: Save assistant message
      console.log(`[Orchestrator] Saving assistant response...`);
      await this.conversationService.addMessage(
        conversationId,
        organizationId,
        {
          content: result.content,
          type: MessageType.AI_MESSAGE,
          sender: "assistant",
          metadata: {
            ...result.metadata,
            latency_ms: latency,
            plan: plan.path,
          },
        }
      );
      console.log(`[Orchestrator] Response saved: "${result.content.substring(0, 100)}..."`);

      // Step 6: Update conversation status if needed
      if (result.setStatus) {
        console.log(`[Orchestrator] Updating conversation status to ${result.setStatus}`);
        await this.conversationService.updateConversation(
          conversationId,
          organizationId,
          {
            status: result.setStatus,
            ended_at: result.setStatus === "resolved" ? new Date() : undefined,
          }
        );
      }

      // Generate title after 2 user messages
      await this.generateConversationTitle(conversationId, organizationId);

      // Clear cooldown and mark as processed
      await this.conversationService.updateConversation(
        conversationId,
        organizationId,
        {
          cooldown_until: null,
          needs_processing: false,
          last_processed_at: new Date(),
        }
      );
      console.log(`[Orchestrator] ✅ Conversation ${conversationId} processing complete`);
    } catch (error) {
      console.error(`[Orchestrator] ❌ Error processing conversation ${conversationId}:`, error);
      await this.handleError(conversationId, organizationId, error);
    }
  }

  private async routeAgent(organizationId: string): Promise<string | null> {
    // Get org agents first, then system agents
    const agents = await this.agentService.getAgents(organizationId);
    const enabledAgent = agents.find((a) => a.enabled);

    if (enabledAgent) {
      return enabledAgent.id;
    }

    // TODO: Get system agents as fallback
    return null;
  }

  private async handleNoAgent(
    conversationId: string,
    organizationId: string
  ): Promise<void> {
    await this.conversationService.addMessage(conversationId, organizationId, {
      content:
        "I understand you'd like assistance. I'll make sure a human representative is notified to help you as soon as possible.",
      type: MessageType.AI_MESSAGE,
      sender: "system",
    });

    await this.conversationService.updateConversation(
      conversationId,
      organizationId,
      {
        status: "pending-human",
      }
    );
  }

  private async createPlan(
    userMessage: string,
    conversation: any,
    organizationId: string
  ): Promise<OrchestrationPlan> {
    // First check if user is requesting human assistance
    const humanRequestPatterns = [
      /\b(speak|talk|chat)\s+(to|with)\s+(a\s+)?(human|person|agent|representative|someone)/i,
      /\b(want|need|like)\s+(a\s+)?(human|person|agent|representative)/i,
      /transfer\s+me/i,
      /real\s+person/i,
      /live\s+support/i,
      /customer\s+service/i
    ];
    
    if (humanRequestPatterns.some(pattern => pattern.test(userMessage))) {
      console.log(`[Orchestrator] Detected human assistance request, using human escalation playbook`);
      
      // Try to find the human escalation playbook
      const playbooks = await this.playbookService.getPlaybooks(organizationId);
      const humanEscalationPlaybook = playbooks.find(
        p => p.trigger === 'human_escalation' && p.status === 'active'
      );
      
      if (humanEscalationPlaybook) {
        return {
          path: "playbook",
          agentId: conversation.agent_id,
          playbookId: humanEscalationPlaybook.id,
          requiredFields: [],
        };
      }
    }
    
    // Check if we should use document retrieval or playbook path
    let useDocQA = false;
    
    // Keywords that suggest document retrieval
    const docQAKeywords = [
      /how (do|can|to)/i,
      /what (is|are|does)/i,
      /explain/i,
      /documentation/i,
      /guide/i,
      /tutorial/i,
      /help with/i,
      /information about/i,
      /tell me about/i
    ];
    
    // Check if message matches document retrieval patterns
    if (docQAKeywords.some(pattern => pattern.test(userMessage))) {
      // Try a quick search to see if we have relevant documents
      try {
        if (!this.vectorStoreService.initialized) {
          await this.vectorStoreService.initialize();
        }
        
        const quickSearch = await this.vectorStoreService.search(
          organizationId,
          userMessage,
          1
        );
        
        // If we find highly relevant documents (similarity > 0.7), use docqa path
        if (quickSearch.length > 0 && (quickSearch[0].similarity || 0) > 0.7) {
          useDocQA = true;
          console.log(`[Orchestrator] High relevance document found (${quickSearch[0].similarity}), using docqa path`);
        }
      } catch (error) {
        console.error(`[Orchestrator] Error checking for documents:`, error);
      }
    }
    
    if (useDocQA) {
      return {
        path: "docqa",
        agentId: conversation.agent_id,
        requiredFields: [],
      };
    }
    
    // Otherwise use playbook path
    // Check if conversation already has a playbook
    let playbookId = conversation.playbook_id;
    
    // If no playbook assigned, try to find a default one
    if (!playbookId) {
      const welcomePlaybook = await this.getActivePlaybook(
        "welcome",
        organizationId
      );
      
      if (welcomePlaybook) {
        playbookId = welcomePlaybook.id;
      }
    }

    console.log(`[Orchestrator] Selected playbook path with playbook: ${playbookId || 'none'}`);

    return {
      path: "playbook",
      agentId: conversation.agent_id,
      playbookId: playbookId,
      requiredFields: [],
    };
  }

  private async executeDocumentRetrieval(
    query: string,
    organizationId: string
  ): Promise<ExecutionResult> {
    try {
      // Search for relevant documents
      const results = await this.vectorStoreService.search(
        organizationId,
        query,
        5
      );

      // Filter out test data and potentially fake information
      const filteredResults = results?.filter(r => {
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
      }) || [];

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

      // Format results with citations
      const formattedResults = filteredResults
        .map(
          (r, i) =>
            `[${i + 1}] ${r.content} (${
              r.metadata?.source || "Unknown source"
            })`
        )
        .join("\n\n");

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

  private async executePlaybook(
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

    // Initialize Hay service
    Hay.init();

    // Build conversation history for context
    const conversationHistory = messages.map(msg => {
      if (msg.type === MessageType.HUMAN_MESSAGE) {
        return `User: ${msg.content}`;
      } else if (msg.type === MessageType.AI_MESSAGE) {
        return `Assistant: ${msg.content}`;
      }
      return null;
    }).filter(Boolean).join('\n');

    // Use the provided user message or get the last one from messages
    const userPromptContent = userMessage || 
      messages.filter(m => m.type === MessageType.HUMAN_MESSAGE).pop()?.content;
    
    if (!userPromptContent) {
      return {
        content: "I'm ready to help. What can I assist you with today?",
        metadata: { path: "playbook" },
      };
    }

    // RAG: Search for relevant documents based on user message
    let ragContext = "";
    try {
      console.log(`[Orchestrator] Searching for relevant documents for query: "${userPromptContent.substring(0, 100)}..."`);
      
      // Initialize vector store if not already initialized
      if (!this.vectorStoreService.initialized) {
        await this.vectorStoreService.initialize();
      }
      
      // Search for relevant documents
      const searchResults = await this.vectorStoreService.search(
        organizationId,
        userPromptContent,
        5 // Get top 5 most relevant documents
      );
      
      // Filter out test data and potentially fake information
      const filteredSearchResults = searchResults?.filter(r => {
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
      }) || [];
      
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
        });
        
        console.log(`[Orchestrator] RAG context added: ${ragContext.length} characters`);
      } else {
        console.log(`[Orchestrator] No relevant documents found in knowledge base`);
      }
    } catch (error) {
      console.error(`[Orchestrator] Error during RAG search:`, error);
      // Continue without RAG context if search fails
    }

    // Construct the prompt
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

    // Add RAG context to system prompt if available
    if (ragContext) {
      systemPrompt += ragContext;
      systemPrompt += "\n\nIMPORTANT: Use ONLY the above information from the knowledge base when answering questions. If the information needed is not available above, you MUST say you don't have that information rather than making something up.";
    }

    // Add strict anti-hallucination instructions
    systemPrompt += `\n\n## CRITICAL INSTRUCTIONS - NEVER VIOLATE THESE RULES:\n\n1. **NEVER make up or invent information**, especially:
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
   - Do NOT make up support hours or availability`

    // Add conversation context if there's history
    if (conversationHistory && messages.length > 1) {
      systemPrompt += `\n\nConversation history:\n${conversationHistory}`;
    }

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

  private async getActivePlaybook(
    kind: string,
    organizationId: string,
    trigger?: string
  ): Promise<any> {
    const playbooks = await this.playbookService.getPlaybooks(organizationId);

    // First try org-specific playbook
    let playbook = playbooks.find(
      (p) =>
        p.kind === kind &&
        p.status === "active" &&
        (!trigger || p.trigger === trigger)
    );

    if (!playbook) {
      // TODO: Fallback to system playbooks
      // For now, return a default template
      if (kind === "welcome") {
        return { prompt_template: "Hello! How can I help you today?" };
      } else if (kind === "ender") {
        return {
          prompt_template: "Is there anything else I can help you with?",
        };
      }
    }

    return playbook;
  }

  private async handleError(
    conversationId: string,
    organizationId: string,
    error: any
  ): Promise<void> {
    await this.conversationService.addMessage(conversationId, organizationId, {
      content:
        "I apologize, but I encountered an issue processing your request. Please try again or I can connect you with a human representative.",
      type: MessageType.AI_MESSAGE,
      sender: "system",
      metadata: {
        error: error.message,
      },
    });

    // Clear cooldown so user can retry
    await this.conversationService.updateConversation(
      conversationId,
      organizationId,
      {
        cooldown_until: null,
      }
    );
  }

  private async generateConversationTitle(
    conversationId: string,
    organizationId: string
  ): Promise<void> {
    try {
      // Get conversation to check if it already has a meaningful title
      const conversation = await this.conversationService.getConversation(
        conversationId,
        organizationId
      );

      // Skip if conversation already has a title that's not the default
      if (conversation?.title && conversation.title !== "New Conversation") {
        console.log(`[Orchestrator] Conversation already has title: "${conversation.title}"`);
        return;
      }

      // Get all messages to check if we have at least 2 user messages
      const messages = await this.conversationService.getMessages(conversationId);
      const userMessages = messages.filter(m => m.type === MessageType.HUMAN_MESSAGE);
      
      // Only generate title after 2 user messages
      if (userMessages.length < 2) {
        console.log(`[Orchestrator] Only ${userMessages.length} user messages, skipping title generation`);
        return;
      }

      console.log(`[Orchestrator] Generating conversation title after ${userMessages.length} user messages`);

      // Prepare conversation context for title generation
      const conversationSummary = messages
        .slice(0, 10) // Take first 10 messages for context
        .map(msg => {
          if (msg.type === MessageType.HUMAN_MESSAGE) {
            return `User: ${msg.content.substring(0, 200)}`;
          } else if (msg.type === MessageType.AI_MESSAGE) {
            return `Assistant: ${msg.content.substring(0, 200)}`;
          }
          return null;
        })
        .filter(Boolean)
        .join('\n');

      // Generate title using AI
      const systemPrompt = `You are a conversation title generator. Your task is to create a short, descriptive title for a conversation based on its content.

Rules:
1. Maximum 5 words (preferably 2-3 words)
2. Be specific and descriptive
3. Focus on the main topic or issue
4. Use title case
5. No punctuation or special characters
6. Examples: "Password Reset", "Order Status", "Billing Issue", "Product Return", "Account Setup"

Respond with ONLY the title, nothing else.`;

      const userPrompt = `Generate a title for this conversation:\n\n${conversationSummary}`;

      const response = await Hay.invokeWithSystemPrompt(systemPrompt, userPrompt);
      
      // Clean up the title (remove quotes, trim, etc.)
      let title = response.content
        .replace(/["']/g, '') // Remove quotes
        .replace(/^\W+|\W+$/g, '') // Remove leading/trailing non-word characters
        .trim();

      // Ensure title is not too long (max 5 words)
      const words = title.split(/\s+/);
      if (words.length > 5) {
        title = words.slice(0, 5).join(' ');
      }

      // Fallback if title is empty or too short
      if (!title || title.length < 2) {
        title = "Customer Inquiry";
      }

      console.log(`[Orchestrator] Generated title: "${title}"`);

      // Update conversation with the new title
      await this.conversationService.updateConversation(
        conversationId,
        organizationId,
        {
          title: title
        }
      );

    } catch (error) {
      console.error(`[Orchestrator] Error generating conversation title:`, error);
      // Don't throw - title generation is not critical
    }
  }

  async detectResolution(
    conversationId: string,
    organizationId: string,
    userMessage: string
  ): Promise<void> {
    // Get the last assistant message
    const messages = await this.conversationService.getLastMessages(
      conversationId,
      organizationId,
      2
    );
    const lastAssistantMessage = messages.find(
      (m) => m.type === MessageType.AI_MESSAGE
    );

    // Check if last assistant message had an ender
    if (
      !lastAssistantMessage?.content.includes("Is there anything else") &&
      !lastAssistantMessage?.content.includes("Can I help with anything else")
    ) {
      return;
    }

    // Resolution patterns (PT and EN)
    const resolvedPatterns = [
      /^(no|nope|não|nao|n)$/i,
      /^(thanks|thank you|obrigad[oa]|valeu)$/i,
      /^(all good|all set|tudo bem|tá tudo|ta tudo)$/i,
      /^(that'?s all|é só isso|e so isso|só isso|so isso)$/i,
      /^(nothing else|nada mais|mais nada)$/i,
      /^(i'?m good|tô bem|to bem|estou bem)$/i,
    ];

    const escalationPatterns = [
      /(talk|speak|falar).*(person|human|representative|alguém|pessoa)/i,
      /(need|quero|want).*(help|ajuda|assistance)/i,
      /(didn'?t help|não ajudou|nao ajudou)/i,
      /(frustrated|frustrado|chateado)/i,
    ];

    const normalized = userMessage.trim().toLowerCase();

    // Check for resolution
    if (resolvedPatterns.some((pattern) => pattern.test(normalized))) {
      await this.conversationService.updateConversation(
        conversationId,
        organizationId,
        {
          status: "resolved",
          ended_at: new Date(),
          resolution_metadata: {
            resolved: true,
            confidence: 0.9,
            reason: "user_indicated_completion",
          },
        }
      );
      return;
    }

    // Check for escalation
    if (escalationPatterns.some((pattern) => pattern.test(normalized))) {
      await this.conversationService.updateConversation(
        conversationId,
        organizationId,
        {
          status: "pending-human",
          resolution_metadata: {
            resolved: false,
            confidence: 0.8,
            reason: "user_requested_escalation",
          },
        }
      );

      await this.conversationService.addMessage(
        conversationId,
        organizationId,
        {
          content:
            "I understand you'd like to speak with a human representative. I'll make sure your request is prioritized. Is there anything specific you'd like me to note for them about your inquiry?",
          type: MessageType.AI_MESSAGE,
          sender: "system",
        }
      );
    }
  }

  async checkInactiveConversations(organizationId: string): Promise<void> {
    console.log(`[Orchestrator] Checking for inactive conversations in organization ${organizationId}`);
    
    try {
      // Get all conversations for the organization and filter for open ones
      const allConversations = await this.conversationService.getConversations(
        organizationId
      );
      const openConversations = allConversations.filter(
        (conv) => conv.status === "open"
      );

      const now = new Date();
      const inactivityThreshold = config.conversation.inactivityInterval;
      
      console.log(`[Orchestrator] Found ${openConversations.length} open conversations, checking for inactivity (threshold: ${inactivityThreshold}ms)`);

      for (const conversation of openConversations) {
        // Get the last message in the conversation
        const messages = await this.conversationService.getLastMessages(
          conversation.id,
          organizationId,
          1
        );

        if (messages.length === 0) {
          console.log(`[Orchestrator] Conversation ${conversation.id} has no messages, skipping`);
          continue;
        }

        const lastMessage = messages[0];
        const lastMessageTime = new Date(lastMessage.created_at);
        const timeSinceLastMessage = now.getTime() - lastMessageTime.getTime();

        console.log(`[Orchestrator] Conversation ${conversation.id}: Last message was ${timeSinceLastMessage}ms ago`);

        // Check if conversation has been inactive for longer than the threshold
        if (timeSinceLastMessage > inactivityThreshold) {
          console.log(`[Orchestrator] Conversation ${conversation.id} is inactive (${timeSinceLastMessage}ms > ${inactivityThreshold}ms), closing...`);
          
          // Add a system message about closing due to inactivity
          await this.conversationService.addMessage(
            conversation.id,
            organizationId,
            {
              content: "This conversation has been automatically closed due to inactivity. If you need further assistance, please start a new conversation.",
              type: MessageType.AI_MESSAGE,
              sender: "system",
              metadata: {
                reason: "inactivity_timeout",
                inactivity_duration_ms: timeSinceLastMessage,
              },
            }
          );

          // Update conversation status to resolved
          await this.conversationService.updateConversation(
            conversation.id,
            organizationId,
            {
              status: "resolved",
              ended_at: new Date(),
              resolution_metadata: {
                resolved: true,
                confidence: 1.0,
                reason: "inactivity_timeout",
              },
            }
          );

          console.log(`[Orchestrator] ✅ Conversation ${conversation.id} closed due to inactivity`);
        }
      }
    } catch (error) {
      console.error(`[Orchestrator] ❌ Error checking inactive conversations:`, error);
    }
  }
}
