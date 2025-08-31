import { ConversationService } from "../conversation.service";
import { MessageType } from "../../database/entities/message.entity";
import { Hay } from "../hay.service";
import { config } from "../../config/env";
import { getUTCNow, formatUTC } from "../../utils/date.utils";

/**
 * Manages conversation lifecycle operations including title generation,
 * resolution detection, escalation, and inactivity monitoring.
 */
export class ConversationManagement {
  /**
   * Creates a new ConversationManagement instance.
   * @param conversationService - Service for managing conversations
   */
  constructor(private conversationService: ConversationService) {}

  /**
   * Generates a descriptive title for a conversation using AI.
   * Waits for sufficient messages before generating, unless forced or closing.
   * @param conversationId - The ID of the conversation
   * @param organizationId - The ID of the organization
   * @param force - Whether to force title generation regardless of conditions
   */
  async generateTitle(
    conversationId: string,
    organizationId: string,
    force: boolean = false
  ): Promise<void> {
    try {
      // Get conversation to check if it already has a meaningful title
      const conversation = await this.conversationService.getConversation(
        conversationId,
        organizationId
      );

      // Check if title is a default or placeholder
      const isDefaultTitle = this.isDefaultOrPlaceholderTitle(conversation?.title);
      const isClosing = conversation?.status === 'resolved' || conversation?.status === 'closed';
      
      // Skip if conversation already has a meaningful title (unless forced or closing)
      if (!force && !isClosing && conversation?.title && !isDefaultTitle) {
        console.log(`[Orchestrator] Conversation already has meaningful title: "${conversation.title}"`);
        return;
      }

      // Log if regenerating due to closing with placeholder title
      if (isClosing && isDefaultTitle) {
        console.log(`[Orchestrator] Conversation closing with placeholder title, regenerating...`);
      }

      // Get all messages to check if we have relevant content
      const messages = await this.conversationService.getMessages(conversationId);
      const userMessages = messages.filter(m => m.type === MessageType.HUMAN_MESSAGE);
      
      // Skip if no messages
      if (messages.length === 0) {
        console.log(`[Orchestrator] No messages in conversation, skipping title generation`);
        return;
      }
      
      // For closed conversations, generate title if there's at least 1 user message
      // For open conversations, wait for 2 user messages
      const minUserMessages = isClosing ? 1 : 2;
      
      if (userMessages.length < minUserMessages) {
        console.log(`[Orchestrator] Only ${userMessages.length} user messages (need ${minUserMessages}), skipping title generation`);
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

  /**
   * Detects if a conversation should be resolved or escalated based on user message.
   * Uses AI to understand intent and supports both English and Portuguese patterns.
   * @param conversationId - The ID of the conversation
   * @param organizationId - The ID of the organization
   * @param userMessage - The user's message to analyze
   */
  async detectResolution(
    conversationId: string,
    organizationId: string,
    userMessage: string
  ): Promise<void> {
    // Get the last few messages to check context
    const messages = await this.conversationService.getLastMessages(
      conversationId,
      organizationId,
      10
    );
    
    // First check with pattern matching for strong signals
    const normalized = userMessage.trim().toLowerCase();
    
    // Strong closure patterns that work at any point
    const strongClosurePatterns = [
      /^(bye|goodbye|tchau|até|see you|até logo|adeus|farewell)$/i,
      /^(thanks|thank you|obrigad[oa]|valeu|muito obrigad[oa])[,.]?\s*(bye|goodbye|tchau|até)?$/i,
      /^that'?s all\s*(thanks|thank you|for now)?$/i,
      /^(é só isso|só isso mesmo|era só isso|apenas isso)$/i,
      /^(no|não|nao)\s+(thanks|obrigad[oa]|need|preciso|quero).*$/i,
      /^(i'?m|estou|tô|to)\s+(done|finished|satisfied|satisfeit[oa]|terminei)$/i,
      /^(problem|issue|problema)\s+(solved|resolved|resolvid[oa]|solucionad[oa])$/i,
      /^(perfect|perfeito|ótimo|great|excellent|excelente)\s*(thanks|obrigad[oa])?$/i,
    ];
    
    // Check for strong closure signals and determine if it's a positive resolution
    if (strongClosurePatterns.some((pattern) => pattern.test(normalized))) {
      console.log(`[Orchestrator] Strong closure signal detected: "${userMessage}"`);
      
      // Check if this is a positive closure (thanks, problem solved, etc.)
      const positiveClosurePatterns = [
        /^(thanks|thank you|obrigad[oa]|valeu|muito obrigad[oa])/i,
        /^(problem|issue|problema)\s+(solved|resolved|resolvid[oa]|solucionad[oa])/i,
        /^(perfect|perfeito|ótimo|great|excellent|excelente)/i,
        /^(all good|all set|tudo bem|tá tudo)/i,
      ];
      
      const isPositiveClosure = positiveClosurePatterns.some((pattern) => pattern.test(normalized));
      const reason = isPositiveClosure ? "customer_satisfied" : "user_indicated_completion";
      
      await this.closeConversation(conversationId, organizationId, reason);
      return;
    }
    
    // Check for escalation patterns
    const escalationPatterns = [
      /(talk|speak|falar|conversar).*(person|human|representative|alguém|pessoa|agent|atendente)/i,
      /(need|quero|want|preciso).*(human|person|real|humano|atendente)/i,
      /(didn'?t help|não ajudou|nao ajudou|não resolveu)/i,
      /(frustrated|frustrado|chateado|irritado|insatisfeito)/i,
      /transfer.*(human|person|agent|atendente)/i,
      /(supervisor|manager|gerente|responsável)/i,
    ];
    
    if (escalationPatterns.some((pattern) => pattern.test(normalized))) {
      console.log(`[Orchestrator] Escalation request detected: "${userMessage}"`);
      await this.escalateConversation(conversationId, organizationId);
      return;
    }
    
    // Use AI to detect intent when patterns don't match
    try {
      const conversationContext = messages
        .slice(-5) // Last 5 messages for context
        .map(msg => {
          if (msg.type === MessageType.HUMAN_MESSAGE) {
            return `User: ${msg.content}`;
          } else if (msg.type === MessageType.AI_MESSAGE) {
            return `Assistant: ${msg.content}`;
          }
          return null;
        })
        .filter(Boolean)
        .join('\n');
      
      const systemPrompt = `You are an intent detection system. Analyze the user's message and conversation context to determine if:
1. The user wants to END/CLOSE the conversation (they're satisfied, done, saying goodbye, etc.)
2. The user wants to ESCALATE to a human (they're frustrated, asking for human help, etc.)
3. The user wants to CONTINUE the conversation (they have more questions or need more help)

If the user is ending the conversation, also determine if:
- They are SATISFIED (problem solved, thanking, positive closure)
- They are UNSATISFIED (giving up, not helped, negative closure)

Consider both English and Portuguese languages.

Respond with ONLY one of these:
- CLOSE_SATISFIED (positive resolution)
- CLOSE_UNSATISFIED (negative closure)
- ESCALATE (wants human help)
- CONTINUE (wants to keep talking)`;
      
      const userPrompt = `Conversation context:
${conversationContext}

Latest user message: "${userMessage}"

What is the user's intent?`;
      
      const { Hay } = await import("../hay.service");
      const response = await Hay.invokeWithSystemPrompt(systemPrompt, userPrompt);
      const intent = response.content.trim().toUpperCase();
      
      console.log(`[Orchestrator] AI detected intent: ${intent} for message: "${userMessage}"`);
      
      if (intent === "CLOSE_SATISFIED") {
        await this.closeConversation(conversationId, organizationId, "customer_satisfied", "resolved");
      } else if (intent === "CLOSE_UNSATISFIED") {
        await this.closeConversation(conversationId, organizationId, "customer_unsatisfied", "closed");
      } else if (intent === "CLOSE") {
        // Fallback for simple CLOSE response
        await this.closeConversation(conversationId, organizationId, "ai_detected_completion_intent");
      } else if (intent === "ESCALATE") {
        await this.escalateConversation(conversationId, organizationId);
      }
      // If CONTINUE or unknown, do nothing and let conversation continue
      
    } catch (error) {
      console.error(`[Orchestrator] Error detecting intent with AI:`, error);
      // Fall back to pattern matching only if AI fails
      
      // Check if recent message had an ender question
      const hasRecentEnder = messages.some(
        (m) => m.type === MessageType.AI_MESSAGE && (
          m.content.includes("Is there anything else") ||
          m.content.includes("Can I help with anything else") ||
          m.content.includes("anything else I can") ||
          m.content.includes("Posso ajudar com mais alguma coisa") ||
          m.content.includes("Há algo mais")
        )
      );
      
      // Basic resolution patterns after ender
      const basicResolutionPatterns = [
        /^(no|nope|não|nao|n)$/i,
        /^no\s*(thanks|thank you|obrigad[oa])?$/i,
        /^(all good|all set|tudo bem|tá tudo)$/i,
        /^(nothing else|nada mais|mais nada)$/i,
        /^(i'?m good|tô bem|to bem|estou bem)$/i,
      ];
      
      if (hasRecentEnder && basicResolutionPatterns.some((pattern) => pattern.test(normalized))) {
        console.log(`[Orchestrator] Resolution detected after ender (fallback): "${userMessage}"`);
        await this.closeConversation(conversationId, organizationId, "user_indicated_completion");
      }
    }
  }

  /**
   * Closes a conversation and marks it as resolved or closed based on the reason.
   * Triggers title regeneration to ensure meaningful title.
   * @param conversationId - The ID of the conversation
   * @param organizationId - The ID of the organization
   * @param reason - The reason for closing the conversation
   * @param status - Optional status override (resolved or closed)
   */
  private async closeConversation(
    conversationId: string,
    organizationId: string,
    reason: string,
    status: "resolved" | "closed" = "resolved"
  ): Promise<void> {
    // Determine if this is a successful resolution or just a closure
    const isResolved = [
      "user_indicated_completion",
      "ai_detected_completion_intent",
      "problem_solved",
      "customer_satisfied"
    ].includes(reason);
    
    const finalStatus = status === "closed" ? "closed" : (isResolved ? "resolved" : "closed");
    const confidence = isResolved ? 0.9 : 0.7;
    
    await this.conversationService.updateConversation(
      conversationId,
      organizationId,
      {
        status: finalStatus,
        ended_at: getUTCNow(),
        resolution_metadata: {
          resolved: isResolved,
          confidence,
          reason,
        },
      }
    );
    
    // Force generate title when conversation ends
    await this.generateTitle(conversationId, organizationId, true);
    
    const statusEmoji = finalStatus === "resolved" ? "✅" : "🔒";
    console.log(`[Orchestrator] ${statusEmoji} Conversation ${conversationId} marked as ${finalStatus} (${reason})`);
  }

  /**
   * Escalates a conversation to human support.
   * Sends acknowledgment message and updates status.
   * @param conversationId - The ID of the conversation
   * @param organizationId - The ID of the organization
   */
  private async escalateConversation(
    conversationId: string,
    organizationId: string
  ): Promise<void> {
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

    // Let AI generate a natural escalation acknowledgment
    const { Hay } = await import("../hay.service");
    Hay.init();

    const systemPrompt = `You are a helpful assistant. The user has requested to speak with a human representative.
    Acknowledge their request professionally and let them know you'll help connect them.
    Ask if there's any specific information they'd like you to note for the human representative.
    Keep your response brief and empathetic.`;

    const userPrompt = "User requested human assistance";

    try {
      const response = await Hay.invokeWithSystemPrompt(systemPrompt, userPrompt);
      await this.conversationService.addMessage(
        conversationId,
        organizationId,
        {
          content: response.content,
          type: MessageType.AI_MESSAGE,
          sender: "system",
        }
      );
    } catch (error) {
      // Fallback message if AI fails
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

  /**
   * Checks for and closes conversations that have been inactive.
   * Runs periodically based on inactivity threshold configuration.
   * @param organizationId - The ID of the organization
   */
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

      const now = getUTCNow();
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

        console.log(`[Orchestrator] Conversation ${conversation.id}: 
          - Now: ${formatUTC(now)}
          - Last message time: ${formatUTC(lastMessageTime)} 
          - Time since last message: ${timeSinceLastMessage}ms (${Math.round(timeSinceLastMessage / 1000 / 60)} minutes)
          - Threshold: ${inactivityThreshold}ms (${Math.round(inactivityThreshold / 1000 / 60)} minutes)`);

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

          // Update conversation status to closed (not resolved) due to inactivity
          await this.conversationService.updateConversation(
            conversation.id,
            organizationId,
            {
              status: "closed",
              ended_at: getUTCNow(),
              resolution_metadata: {
                resolved: false,
                confidence: 1.0,
                reason: "inactivity_timeout",
              },
            }
          );

          // Generate title for the closed conversation
          await this.generateTitle(conversation.id, organizationId, false);

          console.log(`[Orchestrator] 🔒 Conversation ${conversation.id} closed due to inactivity`);
        }
      }
    } catch (error) {
      console.error(`[Orchestrator] ❌ Error checking inactive conversations:`, error);
    }
  }

  /**
   * Checks if a title is a default or placeholder title.
   * Identifies time-based, date-based, and other placeholder patterns.
   * @param title - The title to check
   * @returns True if the title is a placeholder
   */
  private isDefaultOrPlaceholderTitle(title?: string): boolean {
    if (!title) return true;
    
    const placeholderPatterns = [
      /^New Conversation$/i,
      /^Playground Test/i,
      /^Test Conversation/i,
      /^Untitled/i,
      /^Conversation \d+$/i,
      /\d{1,2}:\d{2}:\d{2} (AM|PM)$/i, // Time-based titles
      /^\d{4}-\d{2}-\d{2}/i, // Date-based titles
    ];
    
    return placeholderPatterns.some(pattern => pattern.test(title));
  }
}