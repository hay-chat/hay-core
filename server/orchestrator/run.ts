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
import { userRepository } from "@server/repositories/user.repository";
import { LLMService } from "@server/services/core/llm.service";
import { debugLog } from "@server/lib/debug-logger";
import { ExecutionResult } from "./execution.layer";

/**
 * Helper function to publish conversation status changes via Redis/WebSocket
 */
async function publishStatusChange(
  organizationId: string,
  conversationId: string,
  status: string,
  title?: string,
): Promise<void> {
  try {
    const { redisService } = await import("@server/services/redis.service");

    if (redisService.isConnected()) {
      await redisService.publish("websocket:events", {
        type: "conversation_status_changed",
        organizationId,
        payload: {
          conversationId,
          status,
          title,
        },
      });
    } else {
      // Fallback to direct WebSocket if Redis not available
      const { websocketService } = await import("@server/services/websocket.service");
      websocketService.sendToOrganization(organizationId, {
        type: "conversation_status_changed",
        payload: {
          conversationId,
          status,
          title,
        },
      });
    }
  } catch (error) {
    console.error("[Orchestrator] Failed to publish status change:", error);
  }
}

/**
 * Helper function to build message metadata from execution result
 * Makes metadata assignment DRY across different message types
 */
function buildMessageMetadata(
  executionResult: ExecutionResult,
  additionalMetadata?: Record<string, unknown>,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = { ...additionalMetadata };

  if (executionResult.confidence) {
    metadata.confidence = executionResult.confidence.score;
    metadata.confidenceBreakdown = executionResult.confidence.breakdown;
    metadata.confidenceTier = executionResult.confidence.tier;
    metadata.confidenceDetails = executionResult.confidence.details;
    metadata.documentsUsed = executionResult.confidence.documentsUsed;
    metadata.recheckAttempted = executionResult.recheckAttempted || false;
    metadata.recheckCount = executionResult.recheckCount || 0;
  }

  return metadata;
}

/**
 * Helper function to save confidence log to conversation orchestration_status
 */
async function saveConfidenceLog(
  conversation: Conversation,
  executionResult: ExecutionResult,
): Promise<void> {
  if (!executionResult.confidence) {
    return;
  }

  try {
    const orchestrationStatus = (conversation.orchestration_status as any) || {};

    // Initialize confidence log if not exists
    if (!orchestrationStatus.confidenceLog) {
      orchestrationStatus.confidenceLog = [];
    }

    // Add new confidence entry
    orchestrationStatus.confidenceLog.push({
      timestamp: new Date().toISOString(),
      score: executionResult.confidence.score,
      tier: executionResult.confidence.tier,
      breakdown: executionResult.confidence.breakdown,
      documentsUsed: executionResult.confidence.documentsUsed,
      recheckAttempted: executionResult.recheckAttempted || false,
      recheckCount: executionResult.recheckCount || 0,
      details: executionResult.confidence.details,
    });

    // Update conversation
    await conversationRepository.updateById(conversation.id, {
      orchestration_status: orchestrationStatus,
    });

    debugLog("orchestrator", "Confidence log saved", {
      conversationId: conversation.id,
      logEntries: orchestrationStatus.confidenceLog.length,
    });
  } catch (error) {
    debugLog("orchestrator", "Error saving confidence log", {
      level: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export const runConversation = async (conversationId: string) => {
  const conversation = await conversationRepository.findById(conversationId);
  if (!conversation) {
    throw new Error("Conversation not found");
  }

  // Skip processing for conversations taken over by humans
  if (conversation.status === "human-took-over") {
    debugLog("orchestrator", "Skipping - conversation taken over by human", { conversationId });
    return;
  }

  if (conversation?.needs_processing) {
    debugLog("orchestrator", "Running conversation", { conversationId });
  }

  try {
    // 00. Intialize
    const locked = await conversation.lock();
    if (!locked) {
      debugLog("orchestrator", "Could not acquire lock, conversation already being processed", {
        conversationId,
      });
      return;
    }

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

    // 01.1. Get Intent, Sentiment, and Language
    const { intent, sentiment, language } = await perceptionLayer.perceive(
      lastCustomerMessage,
      conversation.id,
      conversation.organization_id,
    );
    await lastCustomerMessage.savePerception({
      intent: intent.label,
      sentiment: sentiment.label,
      language,
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
        conversation.id,
        conversation.organization_id,
      );

      shouldClose = closureValidation.shouldClose;

      if (!shouldClose) {
        debugLog(
          "orchestrator",
          `Closure intent detected but validation failed: ${closureValidation.reason}`,
        );
      }
    }

    if (shouldClose) {
      debugLog(
        "orchestrator",
        `User indicated closure intent (${intent.label}) with confidence ${intent.score}, marking conversation as resolved`,
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

    // 01.2. Agent Assignment
    // Agents are now required at conversation creation and fall back to organization default agent.
    // Automatic agent selection during orchestration is no longer used.
    const currentAgent = conversation.agent_id;
    if (!currentAgent) {
      debugLog("orchestrator", "WARNING: No agent assigned to conversation", {
        conversationId: conversation.id,
        organizationId: conversation.organization_id,
      });
      // This shouldn't happen if conversation creation is working correctly
      // Agent should be set at creation time or fall back to organization default
    } else {
      debugLog("orchestrator", "Agent assigned", {
        agentId: currentAgent,
      });
    }

    // 02. Retrieval
    const retrievalLayer = new RetrievalLayer();

    // 02.1. Get Playbook Candidates
    const publicMessages = await conversation.getPublicMessages();

    const currentPlaybook = conversation.playbook_id;

    debugLog("orchestrator", "Starting playbook retrieval", {
      conversationId: conversation.id,
      currentPlaybookId: currentPlaybook,
      publicMessagesCount: publicMessages.length,
    });

    const activePlaybooks = await playbookRepository.findByStatus(
      conversation.organization_id,
      PlaybookStatus.ACTIVE,
    );

    debugLog("orchestrator", "Retrieved active playbooks", {
      activePlaybooksCount: activePlaybooks.length,
      playbooks: activePlaybooks.map((p) => ({
        id: p.id,
        title: p.title,
        trigger: p.trigger?.substring(0, 50),
      })),
    });

    const playbookCandidate = await retrievalLayer.getPlaybookCandidate(
      publicMessages,
      activePlaybooks,
      conversation.organization_id,
    );

    if (playbookCandidate && playbookCandidate.id !== currentPlaybook) {
      debugLog("orchestrator", "Playbook candidate differs from current, updating conversation", {
        oldPlaybookId: currentPlaybook,
        newPlaybookId: playbookCandidate.id,
        newPlaybookTitle: playbookCandidate.title,
      });
      await conversation.updatePlaybook(playbookCandidate.id);
    } else if (playbookCandidate) {
      debugLog("orchestrator", "Playbook candidate matches current playbook, no update needed", {
        playbookId: currentPlaybook,
      });
    } else {
      debugLog("orchestrator", "No playbook candidate selected", {
        currentPlaybookId: currentPlaybook,
      });
    }

    // 02.2. Get Document Candidates
    debugLog("orchestrator", "Starting document retrieval", {
      conversationId: conversation.id,
      currentDocumentIds: conversation.document_ids,
    });

    const retrievedDocuments = await retrievalLayer.getRelevantDocuments(
      publicMessages,
      conversation.organization_id,
    );

    debugLog("orchestrator", "Document retrieval complete", {
      retrievedDocumentsCount: retrievedDocuments.length,
      documents: retrievedDocuments,
    });

    if (retrievedDocuments.length > 0) {
      for (const document of retrievedDocuments) {
        if (!conversation.document_ids?.includes(document.id)) {
          debugLog("orchestrator", "Adding new document to conversation", {
            documentId: document.id,
            similarity: document.similarity,
          });
          await conversation.addDocument(document.id);
        } else {
          debugLog("orchestrator", "Document already attached to conversation", {
            documentId: document.id,
          });
        }
      }
    } else {
      debugLog("orchestrator", "No relevant documents found");
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
    await handleExecutionLoop(conversation, language);

    conversation.setProcessed(true);
  } catch (error: Error | unknown) {
    if (
      error instanceof Error &&
      !error.message.includes("Conversation does not need processing") &&
      !error.message.includes("Last customer message not found")
    ) {
      console.error("[Orchestrator] Error in conversation", error.message);
    }
  } finally {
    await conversation.unlock();
    // console.log("[Orchestrator] Conversation unlocked", conversationId);
  }
};

/**
 * Handle iterative execution loop with tool calls
 * This allows the LLM to call tools, analyze results, and continue the conversation
 */
async function handleExecutionLoop(conversation: Conversation, customerLanguage?: string) {
  const executionLayer = new ExecutionLayer();
  const toolExecutionService = new ToolExecutionService();
  const MAX_ITERATIONS = 15; // Prevent infinite loops
  let iterations = 0;
  let handoffProcessed = false; // Track if handoff has been processed

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    debugLog("orchestrator", `Execution iteration ${iterations}`);

    // Get current messages and execute (with confidence guardrails integrated)
    const executionResult: ExecutionResult | null =
      await executionLayer.execute(conversation, customerLanguage);

    if (!executionResult) {
      debugLog("orchestrator", "No execution result, ending loop");
      break;
    }

    if (executionResult.step === "CALL_TOOL" && executionResult.tool) {
      // Create unified tool message with initial state
      const toolMessageId = await conversation.addMessage({
        content: `Running action: ${executionResult.tool.name}`,
        type: MessageType.TOOL,
        metadata: {
          toolName: executionResult.tool.name,
          toolInput: executionResult.tool.args,
          toolStatus: "RUNNING",
        },
      });

      // Execute the tool with the message ID for updating
      const toolResult = await toolExecutionService.handleToolExecution(
        conversation,
        executionResult.tool,
        toolMessageId?.id,
      );

      // The tool execution service now updates the message internally
      // Continue the loop to let LLM analyze the result
    } else if (executionResult.step === "HANDOFF") {
      // Handle human handoff
      debugLog("orchestrator", "HANDOFF step detected", {
        confidenceRelated: !!executionResult.confidence,
        confidenceScore: executionResult.confidence?.score,
      });

      // Check if we've already processed handoff to avoid duplicates
      if (handoffProcessed) {
        debugLog("orchestrator", "Handoff already processed, skipping duplicate");
        continue;
      }

      handoffProcessed = true; // Mark as processed

      // Save confidence log if this is a confidence-related handoff
      await saveConfidenceLog(conversation, executionResult);

      // Get agent configuration
      const agent = await agentRepository.findById(conversation.agent_id!);
      if (!agent) {
        console.warn("[Orchestrator] No agent found for handoff, using default behavior");
        await conversationRepository.update(conversation.id, conversation.organization_id, {
          status: "pending-human",
        });

        // Notify organization via WebSocket/Redis
        await publishStatusChange(
          conversation.organization_id,
          conversation.id,
          "pending-human",
          conversation.title,
        );

        // Use executionResult.userMessage if available (e.g., from confidence guardrail)
        const handoffMessage =
          executionResult.userMessage ||
          "I'm transferring you to a human agent. Someone will be with you shortly.";

        await conversation.addMessage({
          content: handoffMessage,
          type: MessageType.BOT_AGENT,
          metadata: buildMessageMetadata(executionResult, {
            isHandoffMessage: true,
          }),
        });
        break;
      }

      // Check if there are online human agents
      const onlineHumans = await userRepository.findOnlineByOrganization(
        conversation.organization_id,
      );
      debugLog("orchestrator", `Found ${onlineHumans.length} online human agents`);

      if (onlineHumans.length > 0) {
        // Humans are available
        const availableInstructions = agent.human_handoff_available_instructions;

        if (
          availableInstructions &&
          Array.isArray(availableInstructions) &&
          availableInstructions.length > 0
        ) {
          // Execute custom instructions for when humans are available
          debugLog("orchestrator", "Executing handoff instructions for available humans");
          await conversation.addHandoffInstructions(availableInstructions, "available");
          // Continue loop to process the handoff instructions
          continue;
        } else {
          // Default behavior: update status and send message
          debugLog("orchestrator", "No custom instructions, using default handoff");
          await conversationRepository.update(conversation.id, conversation.organization_id, {
            status: "pending-human",
          });

          // Notify organization via WebSocket/Redis
          await publishStatusChange(
            conversation.organization_id,
            conversation.id,
            "pending-human",
            conversation.title,
          );

          // Use executionResult.userMessage if available (e.g., from confidence guardrail),
          // otherwise generate a natural handoff message
          let handoffMessage: string = executionResult.userMessage || "";

          if (!handoffMessage) {
            const llmService = new LLMService();
            const messages = await conversation.getMessages();
            try {
              handoffMessage = await llmService.invoke({
                history: messages,
                prompt:
                  "Based on the conversation context, generate a brief, natural message informing the customer that a human agent will be joining the conversation shortly. Keep it friendly and reassuring. Maximum 2 sentences.",
              });
            } catch (error) {
              console.error("[Orchestrator] Error generating handoff message:", error);
              handoffMessage =
                "I'm transferring you to a human agent. Someone will be with you shortly.";
            }
          }

          try {
            await conversation.addMessage({
              content: handoffMessage,
              type: MessageType.BOT_AGENT,
              metadata: buildMessageMetadata(executionResult, {
                isHandoffMessage: true,
                handoffType: "available",
              }),
            });
          } catch (error) {
            console.error("[Orchestrator] Error generating handoff message:", error);
            await conversation.addMessage({
              content: "I'm connecting you with a human agent who will be with you shortly.",
              type: MessageType.BOT_AGENT,
              metadata: buildMessageMetadata(executionResult, {
                isHandoffMessage: true,
                handoffType: "available",
              }),
            });
          }
          break;
        }
      } else {
        // No humans available - still set status to pending-human for queue
        await conversationRepository.update(conversation.id, conversation.organization_id, {
          status: "pending-human",
        });

        // Notify organization via WebSocket/Redis
        await publishStatusChange(
          conversation.organization_id,
          conversation.id,
          "pending-human",
          conversation.title,
        );

        const unavailableInstructions = agent.human_handoff_unavailable_instructions;

        if (
          unavailableInstructions &&
          Array.isArray(unavailableInstructions) &&
          unavailableInstructions.length > 0
        ) {
          // Execute custom instructions for when humans are not available
          debugLog("orchestrator", "Executing handoff instructions for unavailable humans");
          await conversation.addHandoffInstructions(unavailableInstructions, "unavailable");
          // Continue loop to process the handoff instructions
          continue;
        } else {
          // Use executionResult.userMessage if available, otherwise use default
          const unavailableMessage =
            executionResult.userMessage ||
            "I apologize, but no human agents are currently available.";

          debugLog("orchestrator", "No custom fallback, using default message");
          await conversation.addMessage({
            content: unavailableMessage,
            type: MessageType.BOT_AGENT,
            metadata: buildMessageMetadata(executionResult, {
              isHandoffMessage: true,
              handoffType: "unavailable",
            }),
          });
          break;
        }
      }
    } else if (executionResult.step === "CLOSE") {
      // Handle conversation closure
      debugLog("orchestrator", "CLOSE step detected");
      if (executionResult.userMessage) {
        await conversation.addMessage({
          content: executionResult.userMessage,
          type: MessageType.BOT_AGENT,
        });
      }
      break;
    } else {
      // Regular response (not a tool call) - end the loop
      if (executionResult.userMessage) {
        // Save confidence log if available
        await saveConfidenceLog(conversation, executionResult);

        await conversation.addMessage({
          content: executionResult.userMessage,
          type: MessageType.BOT_AGENT,
          metadata: buildMessageMetadata(executionResult),
        });
        debugLog(
          "orchestrator",
          "Added bot response " + executionResult.userMessage + ", ending execution loop",
          {
            confidenceScore: executionResult.confidence?.score,
            confidenceTier: executionResult.confidence?.tier,
          },
        );

        break;
      } else {
        // Retry the loop
        debugLog("orchestrator", "No user message, retrying execution loop");
        continue;
      }
    }
  }

  if (iterations >= MAX_ITERATIONS) {
    debugLog("orchestrator", "Reached maximum execution iterations, ending loop", {
      level: "warn",
    });
  }
}
