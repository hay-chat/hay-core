import { ConversationRepository } from "@server/repositories/conversation.repository";
import { Conversation } from "@server/database/entities/conversation.entity";
import { config } from "@server/config/env";
import { runConversation } from "./run";
import {
  generateConversationTitle,
  sendInactivityWarning,
  closeInactiveConversation,
} from "./conversation-utils";
import { hookManager } from "@server/services/hooks/hook-manager";

export class Orchestrator {
  private conversationRepository: ConversationRepository;

  constructor() {
    console.log("Orchestrator initialized with v2 implementation");
    this.conversationRepository = new ConversationRepository();
  }

  async loop() {
    try {
      const conversations = await this.getOpenConversations();

      const processPromises = conversations.map(async (conversation) => {
        try {
          await this.processConversation(conversation.id);
        } catch (error) {
          console.error(`Error processing conversation ${conversation.id}:`, error);
        }
      });

      await Promise.allSettled(processPromises);
    } catch (error) {
      console.error("Error in orchestrator loop:", error);
    }
  }

  async processConversation(conversationId: string) {
    try {
      await runConversation(conversationId);
    } catch (error) {
      console.error(`Error processing conversation ${conversationId}:`, error);
      throw error;
    }
  }

  async checkInactivity(): Promise<void> {
    try {
      console.log("[Orchestrator] Starting inactivity check across all organizations");

      // Get all open conversations across all organizations
      const openConversations = await this.conversationRepository.findAllOpenConversations();

      if (openConversations.length === 0) {
        console.log("[Orchestrator] No open conversations found");
        return;
      }

      console.log(`[Orchestrator] Found ${openConversations.length} open conversations to check`);

      const now = new Date();
      const inactivityThreshold = config.conversation.inactivityInterval;
      const warningThreshold = inactivityThreshold / 2; // Send warning at half the timeout
      const silentCloseThreshold = inactivityThreshold * 2; // Close silently at 2x timeout

      for (const conversation of openConversations) {
        try {
          // Get the last message in the conversation
          const messages = await conversation.getMessages();

          if (messages.length === 0) {
            console.log(`[Orchestrator] Conversation ${conversation.id} has no messages, skipping`);
            continue;
          }

          // Find the last user message (ignore system messages)
          const lastUserMessage = messages
            .filter((m) => m.type === "Customer")
            .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];

          if (!lastUserMessage) {
            // Check if conversation is old enough to delete (created more than 2x timeout ago)
            const conversationAge = now.getTime() - new Date(conversation.created_at).getTime();
            if (conversationAge > silentCloseThreshold) {
              console.log(
                `[Orchestrator] Deleting empty conversation ${conversation.id} (age: ${conversationAge}ms > ${silentCloseThreshold}ms)`,
              );
              await this.conversationRepository.delete(
                conversation.id,
                conversation.organization_id,
              );
              console.log(
                `[Orchestrator] Deleted conversation ${conversation.id} and associated messages`,
              );
            } else {
              console.log(
                `[Orchestrator] Conversation ${conversation.id} has no user messages, skipping`,
              );
            }
            continue;
          }

          const lastMessageTime = new Date(lastUserMessage.created_at);
          const timeSinceLastMessage = now.getTime() - lastMessageTime.getTime();

          // Check if conversation is already closed (resolved or closed status)
          if (conversation.status === "resolved" || conversation.status === "closed") {
            // Just rename the conversation if needed
            await generateConversationTitle(conversation.id, conversation.organization_id);
            continue;
          }

          // Check for different timeout scenarios
          if (timeSinceLastMessage > silentCloseThreshold) {
            // 2x timeout: Close silently without sending a message
            console.log(
              `[Orchestrator] Conversation ${conversation.id} exceeded silent close threshold (${timeSinceLastMessage}ms > ${silentCloseThreshold}ms), closing silently`,
            );
            await closeInactiveConversation(
              conversation.id,
              conversation.organization_id,
              timeSinceLastMessage,
              false, // Don't send message
            );
          } else if (timeSinceLastMessage > inactivityThreshold) {
            // Full timeout: Check if we already sent a warning
            const hasWarning = messages.some((m) => m.metadata?.isInactivityWarning === true);

            if (hasWarning) {
              // Warning was sent but no response, close the conversation
              console.log(
                `[Orchestrator] Conversation ${conversation.id} didn't respond to warning, closing`,
              );
              await closeInactiveConversation(
                conversation.id,
                conversation.organization_id,
                timeSinceLastMessage,
                true, // Send closure message
              );
            } else {
              // No warning sent yet but past full timeout, close with message
              console.log(
                `[Orchestrator] Conversation ${conversation.id} exceeded timeout without warning, closing with message`,
              );
              await closeInactiveConversation(
                conversation.id,
                conversation.organization_id,
                timeSinceLastMessage,
                true, // Send closure message
              );
            }
          } else if (timeSinceLastMessage > warningThreshold) {
            // Half timeout: Send warning if not already sent
            const hasWarning = messages.some((m) => m.metadata?.isInactivityWarning === true);

            if (!hasWarning) {
              console.log(
                `[Orchestrator] Conversation ${conversation.id} reached warning threshold (${timeSinceLastMessage}ms > ${warningThreshold}ms), sending warning`,
              );
              await sendInactivityWarning(conversation.id, conversation.organization_id);

              // Mark conversation as needing processing to handle potential response
              await this.conversationRepository.update(
                conversation.id,
                conversation.organization_id,
                { needs_processing: true },
              );
            }
          }

          // Check if the last message has closure intent
          if (
            lastUserMessage.intent === "close_satisfied" ||
            lastUserMessage.intent === "close_unsatisfied"
          ) {
            // Validate closure with full conversation context
            const publicMessages = await conversation.getPublicMessages();
            const { validateConversationClosure } = await import("./conversation-utils");
            const closureValidation = await validateConversationClosure(
              publicMessages,
              lastUserMessage.intent,
              conversation.playbook_id !== null,
            );

            if (closureValidation.shouldClose) {
              console.log(
                `[Orchestrator] Conversation ${conversation.id} has validated closure intent (${lastUserMessage.intent}), closing. Reason: ${closureValidation.reason}`,
              );
              await this.conversationRepository.update(
                conversation.id,
                conversation.organization_id,
                {
                  status: "resolved",
                  ended_at: now,
                  resolution_metadata: {
                    resolved: lastUserMessage.intent === "close_satisfied",
                    confidence: 1.0,
                    reason: `user_indicated_${lastUserMessage.intent}`,
                  },
                },
              );

              // Trigger hook for conversation resolved
              await hookManager.trigger("conversation.resolved", {
                organizationId: conversation.organization_id,
                conversationId: conversation.id,
                metadata: {
                  reason: `user_indicated_${lastUserMessage.intent}`,
                  resolved: lastUserMessage.intent === "close_satisfied",
                },
              });

              // Generate title for closed conversation
              await generateConversationTitle(conversation.id, conversation.organization_id);
            } else {
              console.log(
                `[Orchestrator] Conversation ${conversation.id} has closure intent but validation failed: ${closureValidation.reason}. Keeping open.`,
              );
            }
          }
        } catch (error) {
          console.error(`[Orchestrator] Error checking conversation ${conversation.id}:`, error);
          // Continue with other conversations
        }
      }

      console.log("[Orchestrator] Inactivity check completed");
    } catch (error) {
      console.error("[Orchestrator] Error in checkInactivity:", error);
    }
  }

  private async getOpenConversations(): Promise<Conversation[]> {
    return await this.conversationRepository.getAvailableForProcessing();
  }
}
