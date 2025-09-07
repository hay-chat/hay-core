import { conversationRepository } from "@server/repositories/conversation.repository";
import { playbookRepository } from "@server/repositories/playbook.repository";
import { PerceptionLayer } from "./perception.layer";
import { RetrievalLayer } from "./retrieval.layer";
import { ExecutionLayer } from "./execution.layer";
import { PlaybookStatus } from "@server/database/entities/playbook.entity";
import { agentRepository } from "@server/repositories/agent.repository";
import { MessageType } from "@server/database/entities/message.entity";

export const runConversation = async (conversationId: string) => {
  const conversation = await conversationRepository.findById(conversationId);

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  try {
    // 00. Intialize
    await conversation.lock();

    // 00.1. Add Initial System Message
    const systemMessages = await conversation.getSystemMessages();
    if (systemMessages.length === 0) {
      await conversation.addInitialSystemMessage();
    }

    // 00.2. Add Initial Bot Message
    const botMessages = await conversation.getBotMessages();
    const lastCustomerMessage = await conversation.getLastCustomerMessage();
    if (botMessages.length === 0 && !lastCustomerMessage) {
      await conversation.addInitialBotMessage();
    }

    // 00.3. Check if last customer message is older than last processed at
    if (!conversation.needs_processing) {
      throw new Error("Conversation does not need processing");
    }

    if (!lastCustomerMessage) {
      throw new Error("Last customer message not found");
    }
    console.log("[Orchestrator] Last message:", lastCustomerMessage.content);
    // 01. Perception layer
    const perceptionLayer = new PerceptionLayer();

    // 01.1. Get Intent and Sentiment

    const { intent, sentiment } = await perceptionLayer.perceive(
      lastCustomerMessage
    );
    await lastCustomerMessage.savePerception({
      intent: intent.label,
      sentiment: sentiment.label,
    });

    // 01.2. Get Agent Candidates
    const currentAgent = conversation.agent_id;
    if (!currentAgent) {
      const activeAgents = await agentRepository.findByOrganization(
        conversation.organization_id
      );
      const agentCandidate = await perceptionLayer.getAgentCandidate(
        lastCustomerMessage,
        activeAgents
      );
      if (agentCandidate) {
        conversation.updateAgent(agentCandidate.id);
      }
    }

    // 02. Retrieval
    const retrievalLayer = new RetrievalLayer();

    // 02.1. Get Playbook Candidates
    const publicMessages = await conversation.getPublicMessages();

    const currentPlaybook = conversation.playbook_id;
    const activePlaybooks = await playbookRepository.findByStatus(
      conversation.organization_id,
      PlaybookStatus.ACTIVE
    );

    const playbookCandidate = await retrievalLayer.getPlaybookCandidate(
      publicMessages,
      activePlaybooks
    );

    if (playbookCandidate && playbookCandidate.id !== currentPlaybook) {
      await conversation.updatePlaybook(playbookCandidate.id);
    }

    // 02.2. Get Document Candidates
    const retrievedDocuments = await retrievalLayer.getRelevantDocuments(
      publicMessages,
      conversation.organization_id
    );

    if (retrievedDocuments.length > 0) {
      for (const document of retrievedDocuments) {
        if (!conversation.document_ids?.includes(document.id)) {
          await conversation.addDocument(document.id);
        }
      }
    }

    // 03. Execution
    const executionLayer = new ExecutionLayer();
    const allMessages = await conversation.getMessages();
    const executionResult = await executionLayer.execute(
      conversation,
      allMessages
    );

    if (executionResult) {
      await conversation.addMessage({
        content: executionResult.userMessage || "",
        type:
          executionResult.step === "CALL_TOOL"
            ? MessageType.TOOL_CALL
            : MessageType.BOT_AGENT,
      });
    }

    conversation.setProcessed(true);
  } catch (error: Error | unknown) {
    console.log(
      `Error running conversation ${conversationId}:`,
      error instanceof Error ? error.message : "Unknown error"
    );
  } finally {
    await conversation.unlock();
  }
};
