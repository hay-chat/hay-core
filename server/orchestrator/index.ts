import { ConversationLayer } from "./conversation.layer";

// Class Orchestrator
export class Orchestrator {
  constructor() {
    console.log("Orchestrator initialized");
  }

  async loop() {
    // Check for open conversations
    const conversations = await this.conversationLayer.getOpenConversations();
    // Process each conversation
    for (const conversation of conversations) {
      new ConversationLayer(conversation.id).processConversation();
    }
  }
}
