import { ConversationRepository } from "@server/repositories/conversation.repository";
import { MessageRepository } from "@server/repositories/message.repository";
import { MessageType } from "@server/database/entities/message.entity";
import { LLMService } from "@server/services/core/llm.service";
import { getUTCNow } from "@server/utils/date.utils";
import { hookManager } from "@server/services/hooks/hook-manager";
import { PromptService } from "@server/services/prompt.service";
import { debugLog } from "@server/lib/debug-logger";

const conversationRepository = new ConversationRepository();
const messageRepository = new MessageRepository();
const llmService = new LLMService();
const promptService = PromptService.getInstance();

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

    const prompt = await promptService.getPrompt(
      "conversation/title-generation",
      { conversationContext },
      { organizationId }
    );

    const response = await llmService.invoke({
      prompt
    });

    const title = response.trim().replace(/^["']|["']$/g, ""); // Remove quotes if present

    await conversationRepository.update(conversationId, organizationId, {
      title: title.substring(0, 255), // Ensure it fits in the column
    });

    debugLog(
      "conversation-utils",
      `Generated title for conversation ${conversationId}: "${title}"`,
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

    const prompt = await promptService.getPrompt(
      "conversation/inactivity-check",
      { conversationContext },
      { organizationId }
    );

    const response = await llmService.invoke({
      prompt
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

    debugLog(
      "conversation-utils",
      `Sent inactivity warning for conversation ${conversationId}`,
    );
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

        const prompt = await promptService.getPrompt(
          "conversation/closure-message",
          { conversationContext },
          { organizationId }
        );

        closureMessage = await llmService.invoke({
          prompt
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

    // Trigger hook for conversation resolved
    await hookManager.trigger("conversation.resolved", {
      organizationId,
      conversationId,
      metadata: {
        reason: sendMessage ? "inactivity_timeout" : "inactivity_timeout_silent",
        resolved: false,
      },
    });

    debugLog(
      "conversation-utils",
      `Closed inactive conversation ${conversationId} (silent: ${!sendMessage})`,
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
      debugLog(
        "conversation-utils",
        `Detected closure intent (${message.intent}) in message ${messageId}`,
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
  organizationId?: string,
): Promise<{ shouldClose: boolean; reason: string }> {
  try {
    // Create conversation transcript for analysis
    const transcript = publicMessages
      .map((m) => {
        const role = m.type === MessageType.CUSTOMER ? "Customer" : "Agent";
        return `${role}: ${m.content}`;
      })
      .join("\n");

    const validationPrompt = await promptService.getPrompt(
      "conversation/closure-validation",
      {
        transcript,
        detectedIntent,
        hasActivePlaybook
      },
      { organizationId }
    );

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
