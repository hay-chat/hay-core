import { Conversation } from "@server/database/entities/conversation.entity";

export class RetrievalLayer {
  constructor() {
    console.log("RetrievalLayer initialized");
  }

  async retrieve(conversation: Conversation) {
    // Retrieval
    // Find relevant documents
    // (3) Match Playbook -> change | continue | no_match
    // -> If there's no playbook active yet, activate the most relevant playbook (if there's any)
    // -> If there's a playbook active, check if we should switch playbook or continue with the current playbook
  }

  async matchPlaybook(conversation: Conversation) {
    // Match Playbook -> change | continue | no_match
    // -> If there's no playbook active yet, activate the most relevant playbook (if there's any)
    // -> If there's a playbook active, check if we should switch playbook or continue with the current playbook
  }

  async findDocuments(conversation: Conversation) {
    // Find relevant documents
  }
}
