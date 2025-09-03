import { Conversation } from "@server/database/entities/conversation.entity";
import { Message, MessageType } from "@server/database/entities/message.entity";
import { ConversationRepository } from "@server/repositories/conversation.repository";
import { MessageRepository } from "@server/repositories/message.repository";
import { PerceptionLayer } from "./perception.layer";
import { RetrievalLayer } from "./retrieval.layer";
import { ExecutionLayer } from "./execution.layer";
import os from "os";
import { v4 as uuidv4 } from "uuid";
import { getUTCNow } from "@server/utils/date.utils";

export class ConversationLayer {
  private conversationRepository: ConversationRepository;
  private messageRepository: MessageRepository;
  private perceptionLayer: PerceptionLayer;
  private retrievalLayer: RetrievalLayer;
  private executionLayer: ExecutionLayer;
  private instanceId: string;

  constructor(conversationId: string) {
    console.log("Orchestrator initialized");
    this.conversationRepository = new ConversationRepository();
    this.messageRepository = new MessageRepository();
    this.perceptionLayer = new PerceptionLayer();
    this.retrievalLayer = new RetrievalLayer();
    this.executionLayer = new ExecutionLayer();

    this.instanceId = `${os.hostname()}-${process.pid}-${uuidv4()}`;
  }
  async getConversation(conversationId: string) {
    const conversation = await this.conversationRepository.findById(
      conversationId
    );
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }
    this.conversation = conversation;
    return this.conversation;
  }

  async lockConversation() {
    return await this.conversationRepository.update(this.conversation?.id, {
      processing_locked_until: getUTCNow(),
      processing_locked_by: this.instanceId,
    });
  }

  async unlockConversation() {
    return await this.conversationRepository.update(this.conversation?.id, {
      processing_locked_until: null,
      processing_locked_by: null,
    });
  }

  async processConversation() {
    if (!this.conversation) {
      throw new Error("No conversation found");
    }

    const lastHumanMessage = this.getLastHumanMessage();

    if (!lastHumanMessage) {
      throw new Error("No human message found");
    }

    // Perception
    const perception = await this.perceptionLayer.perceive(lastHumanMessage);
    // (1) Check intent -> greet | question | request | handoff | close_satisfied | close_unsatisfied | unknown | other
    // (2) Check sentiment -> positive | negative | neutral

    const retrieval = await this.retrievalLayer.retrieve(lastHumanMessage);
    // Retrieval
    // Find relevant documents
    // (3) Match Playbook -> change | continue | no_match
    // -> If there's no playbook active yet, activate the most relevant playbook (if there's any)
    // -> If there's a playbook active, check if we should switch playbook or continue with the current playbook

    const result = await this.executionLayer.execute(this.conversation);
    // Execution
    // (4) Send the conversation with all the information we have
    // -> ASK -> If there's not enough information to give an answer or find a document/playbook or call a tool
    // -> RESPOND -> If there's enough information to give an answer based on the documents/playbook
    // -> CALL_TOOL -> If a playbook asks for it -> Send the response back to the Execution Layer
    // -> HANDOFF -> If the conversation should be handed off to a human
    // -> CLOSE -> If the conversation should be closed

    await this.saveMessage(this.conversation, result);
  }

  async saveMessage(conversation: Conversation, message: Message) {
    // Create message
    return await this.messageRepository.create({
      conversation_id: conversation.id,
      content: message.content,
      type: message.type,
      sender: message.sender || "assistant",
      metadata: message.metadata,
      usage_metadata: message.usage_metadata,
    });
  }

  getLastHumanMessage() {
    return this.conversation?.messages
      .filter((message) => message.type === MessageType.HUMAN_MESSAGE)
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())[0];
  }
}
