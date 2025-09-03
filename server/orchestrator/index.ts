import { PerceptionLayer } from "./perception.layer";
import { RetrievalLayer } from "./retrieval.layer";
import { ExecutionLayer } from "./execution.layer";
import { ConversationRepository } from "@server/repositories/conversation.repository";
import { Conversation } from "@server/database/entities/conversation.entity";
import { Message, MessageType } from "@server/database/entities/message.entity";

export class Orchestrator {
  private conversationRepository: ConversationRepository;
  private perceptionLayer: PerceptionLayer;
  private retrievalLayer: RetrievalLayer;
  private executionLayer: ExecutionLayer;

  constructor() {
    console.log("Orchestrator initialized with three core layers");
    this.conversationRepository = new ConversationRepository();
    this.perceptionLayer = new PerceptionLayer();
    this.retrievalLayer = new RetrievalLayer();
    this.executionLayer = new ExecutionLayer();
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
    let conversation: Conversation | null = null;
    let isLocked = false;

    try {
      // Load conversation first to check its current state
      conversation = await this.executionLayer.loadConversation(conversationId);

      // Check if conversation needs processing (has new unprocessed messages)
      const lastHumanMessage =
        this.executionLayer.getLastHumanMessage(conversation);
      if (!lastHumanMessage) {
        // no human messages, skip processing
        return;
      }

      // Check if this message was already processed by looking at the last bot response
      const messages = conversation.messages || [];
      const lastMessage = messages[messages.length - 1];

      // If the last message is already from bot and is recent, skip processing
      if (
        lastMessage &&
        lastMessage.type === MessageType.BOT_AGENT &&
        lastMessage.created_at
      ) {
        const lastMessageTime = new Date(lastMessage.created_at).getTime();
        const lastHumanMessageTime = new Date(
          lastHumanMessage.created_at
        ).getTime();

        if (lastMessageTime > lastHumanMessageTime) {
          // skip processing if the last message is already from bot and is recent
          return;
        }
      }

      await this.executionLayer.lockConversation(conversationId);

      // Perception phase
      const perception = await this.perceptionLayer.perceive(lastHumanMessage, conversation.organization_id);

      // Retrieval phase
      const allHumanMessages =
        this.executionLayer.getAllHumanMessages(conversation);
      const retrieval = await this.retrievalLayer.retrieve(
        allHumanMessages,
        conversation
      );

      // Save system messages from retrieval
      if (retrieval.systemMessages && retrieval.systemMessages.length > 0) {
        await this.executionLayer.saveSystemMessages(
          conversation,
          retrieval.systemMessages
        );
      }

      // Update orchestration status
      await this.executionLayer.updateOrchestrationStatus(
        conversationId,
        conversation.organization_id,
        perception,
        retrieval
      );

      // Execution phase
      const result = await this.executionLayer.execute(conversation, {
        perception,
        retrieval,
      });

      if (result) {
        await this.executionLayer.saveMessage(conversation, result as Message);

        if (
          result.metadata &&
          typeof result.metadata === "object" &&
          "is_tool_call" in result.metadata
        ) {
          await this.executionLayer.handleToolExecution(conversation, result);
        }

        console.log(
          `[Orchestrator] Successfully processed and responded to conversation ${conversationId}`
        );
      }
    } catch (error) {
      console.error(`Error processing conversation ${conversationId}:`, error);

      // If there was an error, make sure to unlock the conversation
      if (conversation && isLocked) {
        try {
          await this.executionLayer.unlockConversation(conversationId);
          isLocked = false;
        } catch (unlockError) {
          console.error(
            `Error unlocking conversation ${conversationId}:`,
            unlockError
          );
        }
      }

      throw error;
    } finally {
      // Always ensure conversation is unlocked
      if (conversation && isLocked) {
        try {
          await this.executionLayer.unlockConversation(conversationId);
          console.log(
            `[Orchestrator] Unlocked conversation ${conversationId} after processing`
          );
        } catch (unlockError) {
          console.error(
            `Error unlocking conversation ${conversationId} in finally:`,
            unlockError
          );
        }
      }
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
