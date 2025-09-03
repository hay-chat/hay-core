import { Conversation } from "@server/database/entities/conversation.entity";
import { Message } from "@server/database/entities/message.entity";
import { LLMLayer } from "./llm.layer";

export class ExecutionLayer {
  private llm: LLMLayer;
  constructor() {
    console.log("ExecutionLayer initialized");
    this.llm = new LLMLayer();
  }

  async execute(conversation: Conversation) {
    // Execute
    return await this.llm.generateResponse(conversation.context as Message[]);
  }
}
