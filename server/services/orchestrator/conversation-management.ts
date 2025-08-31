import { ConversationService } from "../conversation.service";
import { MessageType } from "../../database/entities/message.entity";
import { Hay } from "../hay.service";
import { config } from "../../config/env";

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
   * Supports both English and Portuguese patterns.
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
      5
    );
    
    // Find if any recent assistant message had an ender question
    const hasRecentEnder = messages.some(
      (m) => m.type === MessageType.AI_MESSAGE && (
        m.content.includes("Is there anything else") ||
        m.content.includes("Can I help with anything else") ||
        m.content.includes("anything else I can") ||
        m.content.includes("anything more") ||
        m.content.includes("Feel free to ask") ||
        m.content.includes("Let me know if") ||
        m.content.includes("Posso ajudar com mais alguma coisa") ||
        m.content.includes("Há algo mais") ||
        m.content.includes("Precisa de mais alguma")
      )
    );

    // Enhanced resolution patterns (PT and EN)
    const resolvedPatterns = [
      /^(no|nope|não|nao|n)$/i,
      /^no\s*(thanks|thank you|obrigad[oa])?$/i,
      /^(thanks|thank you|obrigad[oa]|valeu)(,?\s*(that'?s all|i'?m good)?)?$/i,
      /^(all good|all set|tudo bem|tá tudo|ta tudo)$/i,
      /^(that'?s all|é só isso|e so isso|só isso|so isso)$/i,
      /^(nothing else|nada mais|mais nada)$/i,
      /^(i'?m good|tô bem|to bem|estou bem)$/i,
      /^(bye|goodbye|tchau|até|see you|até logo)$/i,
      /^(ok|okay|alright)\s*(thanks|thank you|obrigad[oa])?$/i,
    ];

    const escalationPatterns = [
      /(talk|speak|falar).*(person|human|representative|alguém|pessoa|agent)/i,
      /(need|quero|want).*(human|person|real|humano)/i,
      /(didn'?t help|não ajudou|nao ajudou)/i,
      /(frustrated|frustrado|chateado|irritado)/i,
      /transfer.*(human|person|agent)/i,
    ];

    const normalized = userMessage.trim().toLowerCase();

    // Check for resolution - either with or without recent ender
    // Some phrases indicate resolution even without being asked
    const strongResolutionPatterns = [
      /^(bye|goodbye|tchau|até|see you|até logo)$/i,
      /^(thanks|thank you|obrigad[oa]|valeu)[,.]?\s*(bye|goodbye|tchau)?$/i,
      /^that'?s all\s*(thanks|thank you)?$/i,
      /^(é só isso|só isso mesmo|era só isso)$/i,
    ];

    // Check for strong resolution signals (work even without ender)
    if (strongResolutionPatterns.some((pattern) => pattern.test(normalized))) {
      console.log(`[Orchestrator] Strong resolution signal detected: "${userMessage}"`);
      await this.closeConversation(conversationId, organizationId, "user_indicated_completion");
      return;
    }

    // Check for resolution after an ender question
    if (hasRecentEnder && resolvedPatterns.some((pattern) => pattern.test(normalized))) {
      console.log(`[Orchestrator] Resolution detected after ender question: "${userMessage}"`);
      await this.closeConversation(conversationId, organizationId, "user_indicated_completion");
      return;
    }

    // Check for escalation
    if (escalationPatterns.some((pattern) => pattern.test(normalized))) {
      console.log(`[Orchestrator] Escalation request detected: "${userMessage}"`);
      await this.escalateConversation(conversationId, organizationId);
    }
  }

  /**
   * Closes a conversation and marks it as resolved.
   * Triggers title regeneration to ensure meaningful title.
   * @param conversationId - The ID of the conversation
   * @param organizationId - The ID of the organization
   * @param reason - The reason for closing the conversation
   */
  private async closeConversation(
    conversationId: string,
    organizationId: string,
    reason: string
  ): Promise<void> {
    await this.conversationService.updateConversation(
      conversationId,
      organizationId,
      {
        status: "resolved",
        ended_at: new Date(),
        resolution_metadata: {
          resolved: true,
          confidence: 0.9,
          reason,
        },
      }
    );
    
    // Force generate title when conversation is resolved
    await this.generateTitle(conversationId, organizationId, true);
    
    console.log(`[Orchestrator] ✅ Conversation ${conversationId} marked as resolved (${reason})`);
    
    // Force title regeneration when closing to ensure meaningful title
    console.log(`[Orchestrator] Forcing title regeneration on close...`);
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

        console.log(`[Orchestrator] Conversation ${conversation.id}: 
          - Now: ${now.toISOString()}
          - Last message time: ${lastMessageTime.toISOString()} 
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

          // Generate title for the closed conversation
          await this.generateTitle(conversation.id, organizationId, false);

          console.log(`[Orchestrator] ✅ Conversation ${conversation.id} closed due to inactivity`);
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