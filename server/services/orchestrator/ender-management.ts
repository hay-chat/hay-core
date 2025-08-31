import { ConversationService } from "../conversation.service";
import { MessageType } from "../../database/entities/message.entity";
import { PlaybookHelpers } from "./playbook-helpers";
import { getUTCNow } from "../../utils/date.utils";

/**
 * Manages ender messages and conversation conclusion patterns.
 * Handles satisfaction detection, inactivity reminders, and conversation flow.
 */
export class EnderManagement {
  /**
   * Creates a new EnderManagement instance.
   * @param conversationService - Service for managing conversations
   * @param playbookHelpers - Helper service for playbook operations
   */
  constructor(
    private conversationService: ConversationService,
    private playbookHelpers: PlaybookHelpers
  ) {}

  /**
   * Detects if user message contains satisfaction signals.
   * Supports both English and Portuguese patterns.
   * @param userMessage - The user's message to analyze
   * @returns True if satisfaction signals are detected
   */
  detectSatisfactionSignals(userMessage: string): boolean {
    const satisfactionPatterns = [
      // English patterns
      /thank you|thanks|thx/i,
      /that('s| is) (helpful|great|perfect|exactly what I needed)/i,
      /perfect|awesome|great|excellent/i,
      /that helps|that helped|this helps|this helped/i,
      /got it|understood|makes sense/i,
      /that('s| is) all I need/i,
      /problem solved|issue resolved/i,
      /you('ve| have) been (helpful|great)/i,
      
      // Portuguese patterns
      /obrigad[oa]|valeu/i,
      /(isso|isto) (ajudou|ajuda|me ajudou)/i,
      /perfeito|ótimo|excelente/i,
      /entendi|compreendi/i,
      /era isso mesmo|era só isso/i,
      /problema resolvido/i,
      /você foi (útil|ótimo)/i,
    ];

    return satisfactionPatterns.some(pattern => pattern.test(userMessage));
  }

  /**
   * Determines if an ender message should be sent based on context.
   * Checks for existing enders, satisfaction signals, and task completion.
   * @param conversationId - The ID of the conversation
   * @param organizationId - The ID of the organization
   * @param userMessage - The user's message
   * @param aiResponse - The AI's response
   * @returns True if an ender should be sent
   */
  async shouldSendEnder(
    conversationId: string,
    organizationId: string,
    userMessage: string,
    aiResponse: string
  ): Promise<boolean> {
    // Don't send ender if AI response already contains one
    if (
      aiResponse.includes("Is there anything else") ||
      aiResponse.includes("Can I help with anything else") ||
      aiResponse.includes("Posso ajudar com mais alguma coisa") ||
      aiResponse.includes("Há algo mais")
    ) {
      return false;
    }

    // Check if user expressed satisfaction
    if (this.detectSatisfactionSignals(userMessage)) {
      console.log(`[Orchestrator] User expressed satisfaction, will send ender`);
      return true;
    }

    // Check if this appears to be end of a task completion
    const taskCompletionPatterns = [
      /here('s| is) (the|your|a)/i,
      /I('ve| have) (sent|provided|given|shared)/i,
      /you (can|should|will) (find|see|receive)/i,
      /it('s| is|has been) (done|completed|finished|sent)/i,
    ];

    const aiContainsCompletion = taskCompletionPatterns.some(pattern => 
      pattern.test(aiResponse)
    );

    if (aiContainsCompletion && this.detectSatisfactionSignals(userMessage)) {
      console.log(`[Orchestrator] Task completed and user satisfied, will send ender`);
      return true;
    }

    return false;
  }

  /**
   * Adds contextual ender to response if appropriate.
   * Currently returns response unchanged as AI handles enders naturally.
   * @param conversationId - The ID of the conversation
   * @param organizationId - The ID of the organization
   * @param userMessage - The user's message
   * @param aiResponse - The AI's response
   * @returns The response (potentially with ender added)
   */
  async addContextualEnder(
    conversationId: string,
    organizationId: string,
    userMessage: string,
    aiResponse: string
  ): Promise<string> {
    // We no longer append hardcoded enders
    // The AI will be instructed to include them naturally when appropriate
    return aiResponse;
  }

  /**
   * Sends a reminder message after user inactivity.
   * Generates natural reminder using AI or falls back to default.
   * @param conversationId - The ID of the conversation
   * @param organizationId - The ID of the organization
   */
  async sendInactivityReminder(
    conversationId: string,
    organizationId: string
  ): Promise<void> {
    try {
      console.log(`[Orchestrator] Sending inactivity reminder for conversation ${conversationId}`);
      
      // Check if last message was from assistant and doesn't have an ender
      const messages = await this.conversationService.getLastMessages(
        conversationId,
        organizationId,
        1
      );

      const lastMessage = messages[0];
      if (!lastMessage || lastMessage.type !== MessageType.AI_MESSAGE) {
        console.log(`[Orchestrator] Last message not from assistant, skipping reminder`);
        return;
      }

      // Don't send reminder if last message already has an ender
      if (
        lastMessage.content.includes("Is there anything else") ||
        lastMessage.content.includes("Can I help with anything else")
      ) {
        console.log(`[Orchestrator] Last message already has ender, skipping reminder`);
        return;
      }

      // Instead of using hardcoded message, let AI generate a natural reminder
      const reminderContent = await this.generateInactivityReminder(organizationId);

      // Add reminder message
      await this.conversationService.addMessage(
        conversationId,
        organizationId,
        {
          content: reminderContent,
          type: MessageType.AI_MESSAGE,
          sender: "assistant",
          metadata: {
            is_reminder: true,
            reason: "inactivity_check",
          },
        }
      );

      console.log(`[Orchestrator] ✅ Inactivity reminder sent`);
    } catch (error) {
      console.error(`[Orchestrator] Error sending inactivity reminder:`, error);
    }
  }

  /**
   * Checks if conversation needs an inactivity reminder.
   * Triggers at 50% of the inactivity threshold.
   * @param conversationId - The ID of the conversation
   * @param organizationId - The ID of the organization
   * @param inactivityThresholdMs - The inactivity threshold in milliseconds
   * @returns True if a reminder should be sent
   */
  async checkForInactivityReminder(
    conversationId: string,
    organizationId: string,
    inactivityThresholdMs: number
  ): Promise<boolean> {
    const messages = await this.conversationService.getLastMessages(
      conversationId,
      organizationId,
      2
    );

    if (messages.length === 0) {
      return false;
    }

    const lastMessage = messages[0];
    const now = getUTCNow();
    const lastMessageTime = new Date(lastMessage.created_at);
    const timeSinceLastMessage = now.getTime() - lastMessageTime.getTime();

    // Send reminder at 50% of inactivity threshold
    const reminderThreshold = inactivityThresholdMs * 0.5;

    // Check if we're past reminder threshold but not yet at close threshold
    if (
      timeSinceLastMessage > reminderThreshold &&
      timeSinceLastMessage < inactivityThresholdMs
    ) {
      // Check if we already sent a reminder
      const hasReminder = messages.some((msg: any) => 
        msg.metadata?.is_reminder === true
      );

      if (!hasReminder && lastMessage.type === MessageType.AI_MESSAGE) {
        console.log(`[Orchestrator] Conversation ${conversationId} needs inactivity reminder (${timeSinceLastMessage}ms > ${reminderThreshold}ms)`);
        return true;
      }
    }

    return false;
  }

  /**
   * Generates a natural inactivity reminder using AI.
   * Falls back to a default message if AI generation fails.
   * @param organizationId - The ID of the organization
   * @returns The generated reminder message
   */
  private async generateInactivityReminder(organizationId: string): Promise<string> {
    try {
      const { Hay } = await import("../hay.service");
      Hay.init();

      const systemPrompt = `You are a helpful assistant. The user has been inactive for a while.
      Generate a brief, friendly reminder asking if they still need help or if there's anything else you can assist with.
      Be natural and conversational. Don't be pushy. Keep it to 1-2 sentences max.`;

      const userPrompt = "Generate an inactivity check message";

      const response = await Hay.invokeWithSystemPrompt(systemPrompt, userPrompt);
      return response.content;
    } catch (error) {
      console.error("[Orchestrator] Error generating inactivity reminder:", error);
      // Fallback to a simple message if AI fails
      return "Hi! I noticed you've been away for a bit. Is there anything else I can help you with?";
    }
  }
}