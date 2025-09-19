import { ConversationRepository } from "@server/repositories/conversation.repository";
import { MessageRepository } from "@server/repositories/message.repository";
import { MessageType } from "@server/database/entities/message.entity";
import { LLMService } from "@server/services/core/llm.service";
import { getUTCNow } from "@server/utils/date.utils";

const conversationRepository = new ConversationRepository();
const messageRepository = new MessageRepository();
const llmService = new LLMService();

/**
 * Generate a conversation title using AI based on conversation content
 */
export async function generateConversationTitle(
  conversationId: string,
  organizationId: string,
  force: boolean = false,
): Promise<void> {
  try {
    const conversation = await conversationRepository.findById(conversationId);
    if (!conversation || conversation.organization_id !== organizationId) {
      throw new Error("Conversation not found");
    }

    // Only generate title if not already set or if forced
    if (!force && conversation.title && conversation.title !== "New Conversation") {
      return;
    }

    // Get messages for context
    const messages = await conversation.getMessages();
    const publicMessages = messages.filter(
      (m) => m.type === MessageType.CUSTOMER || m.type === MessageType.BOT_AGENT,
    );

    if (publicMessages.length < 2) {
      return; // Need at least some conversation to generate title
    }

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

    const response = await llmService.invoke({
      history:
        systemPrompt +
        "\n\nUser: " +
        `Generate a title for this conversation:\n\n${conversationContext}`,
    });

    const title = response.trim().replace(/^["']|["']$/g, ""); // Remove quotes if present

    await conversationRepository.update(conversationId, organizationId, {
      title: title.substring(0, 255), // Ensure it fits in the column
    });

    console.log(
      `[ConversationUtils] Generated title for conversation ${conversationId}: "${title}"`,
    );
  } catch (error) {
    console.error("Error generating conversation title:", error);
    // Don't throw - title generation is not critical
  }
}

/**
 * Send a contextual inactivity warning message to the user
 */
export async function sendInactivityWarning(
  conversationId: string,
  organizationId: string,
): Promise<void> {
  try {
    const conversation = await conversationRepository.findById(conversationId);
    if (!conversation || conversation.organization_id !== organizationId) {
      throw new Error("Conversation not found");
    }

    // Get recent messages for context
    const messages = await conversation.getMessages();
    const recentMessages = messages
      .filter((m) => m.type === MessageType.CUSTOMER || m.type === MessageType.BOT_AGENT)
      .slice(-5); // Last 5 messages

    if (recentMessages.length === 0) {
      return;
    }

    const conversationContext = recentMessages
      .map((m) => `${m.type === MessageType.CUSTOMER ? "Customer" : "Assistant"}: ${m.content}`)
      .join("\n");

    const systemPrompt = `You are a helpful assistant checking in on a conversation that has been inactive.
Generate a friendly, contextual message asking if the user still needs help with their issue.
The message should:
- Reference the specific topic they were discussing
- Ask if they've resolved their issue or need further assistance
- Be warm and helpful, not robotic
- Be concise (1-2 sentences)

Do not include any system-like language about "automatic closure" or timeouts.`;

    const response = await llmService.invoke({
      history:
        systemPrompt +
        "\n\nUser: " +
        `Based on this conversation, generate a check-in message:\n\n${conversationContext}`,
    });

    // Add the warning message to the conversation
    await conversation.addMessage({
      content: response.trim(),
      type: MessageType.BOT_AGENT,
      sender: "system",
      metadata: {
        isInactivityWarning: true,
        warningTimestamp: getUTCNow().toISOString(),
      },
    });

    console.log(`[ConversationUtils] Sent inactivity warning for conversation ${conversationId}`);
  } catch (error) {
    console.error("Error sending inactivity warning:", error);
    throw error;
  }
}

/**
 * Close an inactive conversation with an appropriate message
 */
export async function closeInactiveConversation(
  conversationId: string,
  organizationId: string,
  timeSinceLastMessage: number,
  sendMessage: boolean = true,
): Promise<void> {
  try {
    const conversation = await conversationRepository.findById(conversationId);
    if (
      !conversation ||
      conversation.organization_id !== organizationId ||
      conversation.status !== "open"
    ) {
      return;
    }

    // Generate title if not already set
    await generateConversationTitle(conversationId, organizationId);

    if (sendMessage) {
      // Get recent messages for context
      const messages = await conversation.getMessages();
      const hasWarning = messages.some((m) => m.metadata?.isInactivityWarning === true);

      let closureMessage: string;
      if (hasWarning) {
        // User didn't respond to warning
        closureMessage =
          "Since I haven't heard back from you, I'll close this conversation for now. Feel free to start a new conversation whenever you need help!";
      } else {
        // No warning was sent (e.g., conversation was already inactive for too long)
        const recentMessages = messages
          .filter((m) => m.type === MessageType.CUSTOMER || m.type === MessageType.BOT_AGENT)
          .slice(-3);

        const conversationContext = recentMessages
          .map((m) => `${m.type === MessageType.CUSTOMER ? "Customer" : "Assistant"}: ${m.content}`)
          .join("\n");

        const systemPrompt = `You are closing an inactive conversation. Generate a brief, friendly closing message that:
- Acknowledges the conversation topic
- Mentions you're closing due to inactivity
- Invites them to start a new conversation if needed
Keep it to 1-2 sentences.`;

        closureMessage = await llmService.invoke({
          history:
            systemPrompt +
            "\n\nUser: " +
            `Generate a closing message for this conversation:\n\n${conversationContext}`,
        });
      }

      // Add closure message
      await conversation.addMessage({
        content: closureMessage.trim(),
        type: MessageType.BOT_AGENT,
        sender: "system",
        metadata: {
          reason: "inactivity_timeout",
          inactivity_duration_ms: timeSinceLastMessage,
        },
      });
    }

    // Update conversation status to resolved
    await conversationRepository.update(conversationId, organizationId, {
      status: "resolved",
      ended_at: getUTCNow(),
      resolution_metadata: {
        resolved: false,
        confidence: 1.0,
        reason: sendMessage ? "inactivity_timeout" : "inactivity_timeout_silent",
      },
    });

    console.log(
      `[ConversationUtils] Closed inactive conversation ${conversationId} (silent: ${!sendMessage})`,
    );
  } catch (error) {
    console.error("Error closing inactive conversation:", error);
    throw error;
  }
}

/**
 * Check if a message indicates the user wants to close the conversation
 */
export async function checkForClosureIntent(
  conversationId: string,
  messageId: string,
): Promise<boolean> {
  try {
    const message = await messageRepository.findById(messageId);
    if (!message) {
      return false;
    }

    // Check if message has closure intent
    if (message.intent === "close_satisfied" || message.intent === "close_unsatisfied") {
      console.log(
        `[ConversationUtils] Detected closure intent (${message.intent}) in message ${messageId}`,
      );
      return true;
    }

    return false;
  } catch (error) {
    console.error("Error checking closure intent:", error);
    return false;
  }
}

/**
 * Validate if a conversation should actually be closed based on full context
 */
export async function validateConversationClosure(
  publicMessages: any[],
  detectedIntent: string,
  hasActivePlaybook: boolean,
): Promise<{ shouldClose: boolean; reason: string }> {
  try {
    // Create conversation transcript for analysis
    const transcript = publicMessages
      .map((m) => {
        const role = m.type === MessageType.CUSTOMER ? "Customer" : "Agent";
        return `${role}: ${m.content}`;
      })
      .join("\n");

    const validationPrompt = `Analyze this conversation to determine if it should be closed.

CONVERSATION TRANSCRIPT:
${transcript}

CURRENT SITUATION:
- The system detected a potential closure intent: "${detectedIntent}"
- There is ${hasActivePlaybook ? "an active playbook/workflow" : "no active playbook"}
- The last message from the customer triggered this closure check

VALIDATION TASK:
Determine if this conversation should ACTUALLY be closed. Consider:

1. Is the customer explicitly indicating they want to END the conversation?
2. Or are they just providing information/feedback as part of an ongoing dialogue?
3. If there's an active playbook (like a cancellation flow), is the customer trying to exit it, or are they responding to questions within it?

IMPORTANT GUIDELINES:
- "It's too expensive" when asked "why do you want to cancel?" is NOT a closure - it's providing requested information
- "Not interested" or "No thanks" might decline an offer but doesn't necessarily mean end conversation
- Only mark for closure if the customer is clearly done with the entire interaction
- When a playbook is active, assume the customer wants to complete it unless they explicitly say otherwise

Respond with a JSON object containing:
- shouldClose: boolean (true only if conversation should definitely end)
- reason: string (brief explanation of your decision)`;

    const response = await llmService.invoke({
      prompt: validationPrompt,
      jsonSchema: {
        type: "object",
        properties: {
          shouldClose: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["shouldClose", "reason"],
      },
    });

    return JSON.parse(response);
  } catch (error) {
    console.error("Error validating conversation closure:", error);
    // Default to not closing on error
    return {
      shouldClose: false,
      reason: "Validation error - defaulting to keep conversation open",
    };
  }
}
