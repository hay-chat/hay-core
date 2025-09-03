import { Message } from "@server/database/entities/message.entity";
import { LLMLayer } from "./llm.layer";

export class PerceptionLayer {
  private llm: LLMLayer;
  constructor() {
    console.log("PerceptionLayer initialized");
    this.llm = new LLMLayer();
  }

  async perceive(message: Message) {
    return await this.llm.generateStructuredResponse<Intent>(message.content, {
      intent: { type: "string" },
      sentiment: { type: "string" },
    });
  }
}
