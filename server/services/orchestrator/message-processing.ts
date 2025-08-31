import { ConversationService } from "../conversation.service";
import { MessageType } from "../../database/entities/message.entity";
import { getUTCNow } from "../../utils/date.utils";

/**
 * Handles message processing operations for the orchestrator.
 * Manages retrieval of unprocessed messages, saving assistant responses,
 * and updating conversation states.
 */
export class MessageProcessing {
  /**
   * Creates a new MessageProcessing instance.
   * @param conversationService - Service for managing conversations and messages
   */
  constructor(private conversationService: ConversationService) {}

  /**
   * Retrieves all unprocessed user messages from a conversation.
   * Unprocessed messages are those sent after the last AI message.
   * @param conversationId - The ID of the conversation
   * @param organizationId - The ID of the organization
   * @returns Object containing the unprocessed messages array and a combined message string
   */
  async getUnprocessedUserMessages(
    conversationId: string,
    organizationId: string
  ): Promise<{ messages: any[]; combinedMessage: string }> {
    // Get recent messages for context
    const messages = await this.conversationService.getLastMessages(
      conversationId,
      organizationId,
      20 // Increased to get more context
    );

    console.log(`[Orchestrator] Found ${messages.length} recent messages`);
    console.log(
      `[Orchestrator] Message types:`,
      messages.map((m) => ({ id: m.id, type: m.type, sender: m.sender }))
    );

    // Find all unprocessed user messages (sent after last AI message)
    let lastAiMessageIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].type === MessageType.AI_MESSAGE) {
        lastAiMessageIndex = i;
        break;
      }
    }

    const unprocessedUserMessages = messages.filter(
      (m: any, index: number) =>
        m.type === MessageType.HUMAN_MESSAGE && index > lastAiMessageIndex
    );

    if (unprocessedUserMessages.length === 0) {
      return { messages: [], combinedMessage: "" };
    }

    // Combine all unprocessed user messages into a single context
    const combinedUserMessage = unprocessedUserMessages
      .map((m) => m.content)
      .join("\n");

    console.log(
      `[Orchestrator] Processing ${unprocessedUserMessages.length} unprocessed user messages`
    );
    console.log(
      `[Orchestrator] Combined message: "${combinedUserMessage.substring(
        0,
        200
      )}..."`
    );

    return {
      messages: unprocessedUserMessages,
      combinedMessage: combinedUserMessage,
    };
  }

  /**
   * Saves an assistant's response message to the conversation.
   * @param conversationId - The ID of the conversation
   * @param organizationId - The ID of the organization
   * @param content - The message content
   * @param metadata - Additional metadata for the message
   * @param latency - Response generation latency in milliseconds
   * @param plan - The execution plan used for generating the response
   */
  async saveAssistantMessage(
    conversationId: string,
    organizationId: string,
    content: string,
    metadata: any,
    latency: number,
    plan: string
  ): Promise<void> {
    console.log(`[Orchestrator] Saving assistant response...`);
    await this.conversationService.addMessage(conversationId, organizationId, {
      content: content,
      type: MessageType.AI_MESSAGE,
      sender: "assistant",
      metadata: {
        ...metadata,
        latency_ms: latency,
        plan: plan,
      },
    });
    console.log(
      `[Orchestrator] Response saved: "${content.substring(0, 100)}..."`
    );
  }

  /**
   * Updates the status of a conversation.
   * Sets the ended_at timestamp when conversation is resolved.
   * @param conversationId - The ID of the conversation
   * @param organizationId - The ID of the organization
   * @param status - The new status ('open', 'pending-human', or 'resolved')
   */
  async updateConversationStatus(
    conversationId: string,
    organizationId: string,
    status?: "open" | "pending-human" | "resolved"
  ): Promise<void> {
    if (!status) return;

    console.log(`[Orchestrator] Updating conversation status to ${status}`);
    await this.conversationService.updateConversation(
      conversationId,
      organizationId,
      {
        status: status,
        ended_at: status === "resolved" ? getUTCNow() : undefined,
      }
    );
  }

  /**
   * Clears the cooldown period and marks the conversation as processed.
   * Updates the last_processed_at timestamp to current time.
   * @param conversationId - The ID of the conversation
   * @param organizationId - The ID of the organization
   */
  async clearCooldownAndMarkProcessed(
    conversationId: string,
    organizationId: string
  ): Promise<void> {
    await this.conversationService.updateConversation(
      conversationId,
      organizationId,
      {
        cooldown_until: null,
        needs_processing: false,
        last_processed_at: getUTCNow(),
      }
    );
  }

  /**
   * Handles errors during message processing by sending an error message
   * and clearing the conversation cooldown.
   * @param conversationId - The ID of the conversation
   * @param organizationId - The ID of the organization
   * @param error - The error object containing the error message
   */
  async handleError(
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
}
