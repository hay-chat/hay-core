import { conversationRepository } from "@server/repositories/conversation.repository";
import { playbookRepository } from "@server/repositories/playbook.repository";
import { PerceptionLayer } from "./perception.layer";
import { RetrievalLayer } from "./retrieval.layer";
import { ExecutionLayer } from "./execution.layer";
import { PlaybookStatus } from "@server/database/entities/playbook.entity";
import { agentRepository } from "@server/repositories/agent.repository";
import { MessageType } from "@server/database/entities/message.entity";
import { ToolExecutionService } from "@server/services/core/tool-execution.service";
import { Conversation } from "@server/database/entities/conversation.entity";
import { ConversationContext } from "./types";

export const runConversation = async (conversationId: string) => {
  const conversation = await conversationRepository.findById(conversationId);
  if (!conversation) {
    throw new Error("Conversation not found");
  }

  if (conversation?.needs_processing)
    console.log("[Orchestrator] Running conversation", conversationId);

  try {
    // 00. Intialize
    console.log("[Orchestrator] Initializing conversation", conversationId);
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
    // 01. Perception layer
    const perceptionLayer = new PerceptionLayer();

    // 01.1. Get Intent and Sentiment
    const { intent, sentiment } = await perceptionLayer.perceive(
      lastCustomerMessage,
      conversation.organization_id,
    );
    await lastCustomerMessage.savePerception({
      intent: intent.label,
      sentiment: sentiment.label,
    });

    // Check if user indicated potential closure intent
    const hasClosureIntent =
      intent.label === "close_satisfied" || intent.label === "close_unsatisfied";

    // If potential closure detected, validate with full conversation context
    let shouldClose = false;

    if (hasClosureIntent) {
      // Get all public messages for full context analysis
      const publicMessages = await conversation.getPublicMessages();

      // Validate closure intent with full conversation context
      const { validateConversationClosure } = await import("./conversation-utils");
      const closureValidation = await validateConversationClosure(
        publicMessages,
        intent.label,
        conversation.playbook_id !== null,
        conversation.organization_id,
      );

      shouldClose = closureValidation.shouldClose;

      if (!shouldClose) {
        console.log(
          `[Orchestrator] Closure intent detected but validation failed: ${closureValidation.reason}`,
        );
      }
    }

    if (shouldClose) {
      console.log(
        `[Orchestrator] User indicated closure intent (${intent.label}) with confidence ${intent.score}, marking conversation as resolved`,
      );

      // Generate a title for the conversation before closing
      const { generateConversationTitle } = await import("./conversation-utils");
      await generateConversationTitle(conversation.id, conversation.organization_id);

      // Update conversation status to resolved
      await conversationRepository.update(conversation.id, conversation.organization_id, {
        status: "resolved",
        ended_at: new Date(),
        resolution_metadata: {
          resolved: intent.label === "close_satisfied",
          confidence: intent.score || 1.0,
          reason: `user_indicated_${intent.label}`,
        },
      });

      // Add a closing message
      const closingMessage =
        intent.label === "close_satisfied"
          ? "Great! I'm glad I could help. This conversation has been marked as resolved. Feel free to start a new conversation if you need anything else!"
          : "I understand. This conversation has been marked as resolved. Please feel free to start a new conversation if you need further assistance.";

      await conversation.addMessage({
        content: closingMessage,
        type: MessageType.BOT_AGENT,
        metadata: {
          isClosureMessage: true,
          closureReason: intent.label,
        },
      });

      // Set processed and unlock early since we're closing
      conversation.setProcessed(true);
      await conversation.unlock();
      return; // Exit early since conversation is closed
    }

    // 01.2. Get Agent Candidates
    const currentAgent = conversation.agent_id;
    if (!currentAgent) {
      const activeAgents = await agentRepository.findByOrganization(conversation.organization_id);
      const agentCandidate = await perceptionLayer.getAgentCandidate(
        lastCustomerMessage,
        activeAgents,
        conversation.organization_id,
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
      PlaybookStatus.ACTIVE,
    );

    const playbookCandidate = await retrievalLayer.getPlaybookCandidate(
      publicMessages,
      activePlaybooks,
      conversation.organization_id,
    );

    if (playbookCandidate && playbookCandidate.id !== currentPlaybook) {
      await conversation.updatePlaybook(playbookCandidate.id);
    }

    // 02.2. Get Document Candidates
    const retrievedDocuments = await retrievalLayer.getRelevantDocuments(
      publicMessages,
      conversation.organization_id,
    );

    if (retrievedDocuments.length > 0) {
      for (const document of retrievedDocuments) {
        console.log("[Orchestrator] Adding document to conversation", document);
        if (!conversation.document_ids?.includes(document.id)) {
          await conversation.addDocument(document.id);
        }
      }
    }

    // 03. Initialize orchestration context if needed
    if (!conversation.orchestration_status) {
      const initialContext: ConversationContext = {
        version: "v1",
        lastTurn: 0,
        toolLog: [],
      };
      await conversationRepository.updateById(conversation.id, {
        orchestration_status: initialContext as any,
      });
      conversation.orchestration_status = initialContext as any;
    }

    // 04. Execution - Handle iterative execution with tool calls
    await handleExecutionLoop(conversation);

    conversation.setProcessed(true);
  } catch (error: Error | unknown) {
    console.error("[Orchestrator] Error in conversation", error);
  } finally {
    await conversation.unlock();
    console.log("[Orchestrator] Conversation unlocked", conversationId);
  }
};

/**
 * Handle iterative execution loop with tool calls
 * This allows the LLM to call tools, analyze results, and continue the conversation
 */
async function handleExecutionLoop(conversation: Conversation) {
  const executionLayer = new ExecutionLayer();
  const toolExecutionService = new ToolExecutionService();
  const maxIterations = 5; // Prevent infinite loops
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;
    console.log(`[Orchestrator] Execution iteration ${iterations}`);

    // Get current messages and execute
    const executionResult = await executionLayer.execute(conversation);

    if (!executionResult) {
      console.log("[Orchestrator] No execution result, ending loop");
      break;
    }

    if (executionResult.step === "CALL_TOOL" && executionResult.tool) {
      // Add tool call message
      await conversation.addMessage({
        content: `Calling tool in the background: ${executionResult.tool.name}`,
        type: MessageType.TOOL_CALL,
        metadata: {
          toolName: executionResult.tool.name,
          toolArgs: executionResult.tool.args,
          toolStatus: "CALLING",
        },
      });

      // Execute the tool
      const toolMessage = {
        type: MessageType.TOOL_CALL,
        metadata: {
          tool_call: {
            tool_name: executionResult.tool.name,
            arguments: executionResult.tool.args,
          },
        },
      };

      const toolResult = await toolExecutionService.handleToolExecution(conversation, toolMessage);

      if (toolResult.success) {
        // Add tool response message
        await conversation.addMessage({
          content: `${JSON.stringify(toolResult.result)}`,
          type: MessageType.TOOL_RESPONSE,
          metadata: {
            toolName: executionResult.tool.name,
            toolResult: JSON.stringify(toolResult.result),
            toolStatus: "SUCCESS",
          },
        });

        // Continue the loop to let LLM analyze the result
      } else {
        // Add error message
        await conversation.addMessage({
          content: `Tool execution failed: ${toolResult.error}`,
          type: MessageType.TOOL_RESPONSE,
          metadata: {
            toolName: executionResult.tool.name,
            toolStatus: "ERROR",
          },
        });
        console.log("[Orchestrator] Tool execution failed, continuing execution loop...");
        // Continue the loop to let LLM handle the error
      }
    } else {
      // Regular response (not a tool call) - end the loop
      if (executionResult.userMessage) {
        await conversation.addMessage({
          content: executionResult.userMessage,
          type: MessageType.BOT_AGENT,
        });
        console.log(
          "[Orchestrator] Added bot response " +
            executionResult.userMessage +
            ", ending execution loop",
        );

        break;
      } else {
        // Retry the loop
        console.log("[Orchestrator] No user message, retrying execution loop");
        continue;
      }
    }
  }

  if (iterations >= maxIterations) {
    console.warn("[Orchestrator] Reached maximum execution iterations, ending loop");
  }
}
