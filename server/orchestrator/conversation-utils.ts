import { conversationRepository } from "@server/repositories/conversation.repository";
import { MessageType } from "@server/database/entities/message.entity";
import { getUTCNow } from "@server/utils/date.utils";

/**
 * Simple utility functions for conversation operations using V2 patterns
 * These replace the complex V1 orchestrator service methods used by API routes
 */

/**
 * Generate a conversation title using AI
 * Replaces OrchestratorService.generateConversationTitle()
 */
export async function generateConversationTitle(
  conversationId: string,
  organizationId: string,
  force: boolean = false
): Promise<void> {
  const conversation = await conversationRepository.findById(conversationId);
  if (!conversation) {
    throw new Error("Conversation not found");
  }

  // Only generate title if not already set or if forced
  if (!force && conversation.title && conversation.title !== "New Conversation") {
    return;
  }

  // Get messages for context
  const messages = await conversation.getMessages();
  const publicMessages = messages.filter(
    (m) => m.type === MessageType.CUSTOMER || m.type === MessageType.BOT_AGENT
  );

  if (publicMessages.length < 2) {
    return; // Need at least some conversation to generate title
  }

  try {
    const { Hay } = await import("@server/services/hay.service");
    Hay.init();

    const conversationContext = publicMessages
      .slice(0, 10) // Use first 10 messages
      .map((m) => `${m.type === MessageType.CUSTOMER ? "Customer" : "Assistant"}: ${m.content}`)
      .join("\n");

    const systemPrompt = `You are a conversation title generator. Create a concise, descriptive title (3-6 words) that captures the main topic or request.

Examples:
- "Password Reset Help"
- "Billing Question"  
- "Product Feature Request"
- "Technical Support Issue"

Return only the title, no quotes or extra text.`;

    const response = await Hay.invokeWithSystemPrompt(
      systemPrompt,
      `Generate a title for this conversation:\n\n${conversationContext}`
    );

    const title = response.content.trim().replace(/^["']|["']$/g, ""); // Remove quotes if present
    
    await conversationRepository.update(conversationId, organizationId, {
      title: title.substring(0, 255), // Ensure it fits in the column
    });
  } catch (error) {
    console.error("Error generating conversation title:", error);
    // Don't throw - title generation is not critical
  }
}

/**
 * Detect if a user message indicates the conversation should be resolved
 * Replaces OrchestratorService.detectResolution()
 */
export async function detectResolution(
  conversationId: string,
  organizationId: string,
  userMessage: string
): Promise<void> {
  try {
    const { Hay } = await import("@server/services/hay.service");
    Hay.init();

    const systemPrompt = `You are a conversation resolution detector. Analyze the user's message to determine if they indicate the issue is resolved or they want to end the conversation.

Examples of resolution indicators:
- "Thanks, that fixed it"
- "Perfect, problem solved"
- "That works great, thank you"
- "All good now"
- "Thanks for your help"

Examples of NON-resolution:
- Just saying "Thanks" with follow-up questions
- Acknowledging but asking more questions
- General politeness without resolution indication

Respond with JSON: {"resolved": true/false, "confidence": 0.0-1.0, "reasoning": "explanation"}`;

    const response = await Hay.invokeWithSystemPrompt(
      systemPrompt,
      `User message: ${userMessage}`
    );

    const analysis = JSON.parse(response.content);
    
    // Only mark as resolved if high confidence
    if (analysis.resolved && analysis.confidence >= 0.8) {
      console.log(`[ConversationUtils] High confidence resolution detected: "${userMessage}"`);
      
      await conversationRepository.update(conversationId, organizationId, {
        status: "resolved",
        ended_at: getUTCNow(),
        resolution_metadata: {
          resolved: true,
          confidence: analysis.confidence,
          reason: "customer_indicated_resolution",
        },
      });
    }
  } catch (error) {
    console.error("[ConversationUtils] Error in resolution detection:", error);
    // Don't throw - resolution detection is not critical
  }
}