import { ConversationRepository } from "@server/repositories/conversation.repository";
import { Conversation } from "@server/database/entities/conversation.entity";
import { runConversation } from "./run";

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
          console.error(
            `Error processing conversation ${conversation.id}:`,
            error
          );
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
    // TODO: Implement inactivity check logic
    // console.log("Checking for inactive conversations...");
  }

  private async getOpenConversations(): Promise<Conversation[]> {
    return await this.conversationRepository.getAvailableForProcessing();
  }
}
