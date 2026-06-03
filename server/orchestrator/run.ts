import { conversationRepository } from "@server/repositories/conversation.repository";
import { playbookRepository } from "@server/repositories/playbook.repository";
import { conversationSecretService } from "@server/services/conversation-secret.service";
import { PerceptionLayer } from "./perception.layer";
import { RetrievalLayer } from "./retrieval.layer";
import { ExecutionLayer } from "./execution.layer";
import { PlaybookStatus } from "@server/database/entities/playbook.entity";
import { agentRepository } from "@server/repositories/agent.repository";
import { MessageType } from "@server/database/entities/message.entity";
import { ToolExecutionService } from "@server/services/core/tool-execution.service";
import { Conversation } from "@server/database/entities/conversation.entity";
import type { ConversationContext, GuardrailLogEntry, ProcessingPhase } from "./types";
import { userRepository } from "@server/repositories/user.repository";
import { LLMService } from "@server/services/core/llm.service";
import { PromptService } from "@server/services/prompt.service";
import { createLogger } from "@server/lib/logger";
import type { ExecutionResult } from "./execution.layer";
import type { Message } from "@server/database/entities/message.entity";
import type pino from "pino";

const logger = createLogger("orchestrator-run");

const LOCK_HEARTBEAT_INTERVAL_MS = 5_000;

/**
 * Send a bot message and log how long it took from the start of processing.
 */
async function sendBotMessage(
  conversation: Conversation,
  payload: {
    content: string;
    type: string;
    metadata?: Record<string, unknown>;
    sender?: string;
  },
  log: pino.Logger,
  processingStartedAt: number,
): Promise<Message> {
  const message = await conversation.addMessage(payload);
  log.info(
    {
      durationMs: Date.now() - processingStartedAt,
      messageType: payload.type,
      messagePreview: payload.content.substring(0, 100),
    },
    "Bot message sent",
  );
  return message;
}

/**
 * Helper function to publish conversation status changes via Redis/WebSocket
 */
async function publishStatusChange(
  organizationId: string,
  conversationId: string,
  status: string,
  title?: string,
  processingPhase?: ProcessingPhase,
): Promise<void> {
  try {
    const { redisService } = await import("@server/services/redis.service");

    if (redisService.isConnected()) {
      await redisService.publish("websocket:events", {
        type: "conversation_status_changed",
        organizationId,
        conversationId,
        payload: {
          conversationId,
          status,
          title,
          processingPhase,
        },
      });
    } else {
      // Fallback to direct WebSocket if Redis not available
      const { websocketService } = await import("@server/services/websocket.service");
      const statusPayload = {
        type: "conversation_status_changed",
        payload: {
          conversationId,
          status,
          title,
          processingPhase,
        },
      };
      websocketService.sendToConversation(conversationId, statusPayload);
      websocketService.sendToOrganization(organizationId, statusPayload);
    }
  } catch (error) {
    logger.error({ err: error, organizationId, conversationId }, "Failed to publish status change");
  }
}

/**
 * Helper function to update processing state in orchestration_status
 * and broadcast via WebSocket
 */
async function updateProcessingState(
  conversation: Conversation,
  phase: ProcessingPhase,
  message?: string,
): Promise<void> {
  try {
    const orchestrationStatus =
      (conversation.orchestration_status as unknown as ConversationContext) || {
        version: "v1" as const,
        lastTurn: 0,
        toolLog: [],
      };

    // Update processing state
    orchestrationStatus.processingState = {
      phase,
      startedAt: new Date().toISOString(),
      message,
    };

    // Save to database
    await conversationRepository.updateById(conversation.id, {
      orchestration_status: { ...orchestrationStatus },
    });

    // Update local reference
    conversation.orchestration_status = { ...orchestrationStatus };

    // Broadcast via WebSocket
    await publishStatusChange(
      conversation.organization_id,
      conversation.id,
      conversation.status,
      conversation.title,
      phase,
    );
  } catch (error) {
    logger.error(
      {
        err: error,
        organizationId: conversation.organization_id,
        conversationId: conversation.id,
      },
      "Failed to update processing state",
    );
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

  // Stage 1: Company Interest Protection
  if (executionResult.companyInterest) {
    metadata.companyInterest = {
      passed: executionResult.companyInterest.passed,
      violationType: executionResult.companyInterest.violationType,
      severity: executionResult.companyInterest.severity,
      shouldBlock: executionResult.companyInterest.shouldBlock,
      requiresFactCheck: executionResult.companyInterest.requiresFactCheck,
      reasoning: executionResult.companyInterest.reasoning,
    };
  }

  // Stage 2: Fact Grounding
  if (executionResult.confidence) {
    metadata.confidence = executionResult.confidence.score;
    metadata.confidenceBreakdown = executionResult.confidence.breakdown;
    metadata.confidenceTier = executionResult.confidence.tier;
    metadata.confidenceDetails = executionResult.confidence.details;
    metadata.documentsUsed = executionResult.confidence.documentsUsed;
    metadata.recheckAttempted = executionResult.recheckAttempted || false;
    metadata.recheckCount = executionResult.recheckCount || 0;
  }

  // Store original message if it was replaced by fallback
  if (executionResult.originalMessage) {
    metadata.originalMessage = executionResult.originalMessage;
  }

  // Add execution rationale (why the LLM chose this step type)
  if (executionResult.rationale) {
    metadata.executionRationale = executionResult.rationale;
  }

  return metadata;
}

/**
 * Helper function to save guardrail logs to conversation orchestration_status
 * Includes both company interest (Stage 1) and fact grounding (Stage 2) logs
 */
async function saveConfidenceLog(
  conversation: Conversation,
  executionResult: ExecutionResult,
): Promise<void> {
  // Skip if no guardrail data
  if (!executionResult.companyInterest && !executionResult.confidence) {
    return;
  }

  try {
    const orchestrationStatus =
      (conversation.orchestration_status as unknown as ConversationContext) ||
      ({
        version: "v1" as const,
        lastTurn: 0,
        toolLog: [],
      } satisfies ConversationContext);

    // Initialize guardrail log if not exists
    if (!orchestrationStatus.guardrailLog) {
      orchestrationStatus.guardrailLog = [];
    }

    // Build log entry
    const logEntry: GuardrailLogEntry = {
      timestamp: new Date().toISOString(),
    };

    // Stage 1: Company Interest
    if (executionResult.companyInterest) {
      logEntry.companyInterest = {
        passed: executionResult.companyInterest.passed,
        violationType: executionResult.companyInterest.violationType,
        severity: executionResult.companyInterest.severity,
        shouldBlock: executionResult.companyInterest.shouldBlock,
        requiresFactCheck: executionResult.companyInterest.requiresFactCheck,
        reasoning: executionResult.companyInterest.reasoning,
      };
    }

    // Stage 2: Fact Grounding
    if (executionResult.confidence) {
      logEntry.factGrounding = {
        score: executionResult.confidence.score,
        tier: executionResult.confidence.tier,
        breakdown: executionResult.confidence.breakdown,
        documentsUsed: executionResult.confidence.documentsUsed,
        recheckAttempted: executionResult.recheckAttempted || false,
        recheckCount: executionResult.recheckCount || 0,
        details: executionResult.confidence.details,
      };
    }

    // Add to log
    orchestrationStatus.guardrailLog.push(logEntry);

    // Also maintain legacy confidenceLog for backward compatibility
    if (executionResult.confidence) {
      if (!orchestrationStatus.confidenceLog) {
        orchestrationStatus.confidenceLog = [];
      }
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
    }

    // Update conversation
    await conversationRepository.updateById(conversation.id, {
      orchestration_status: { ...orchestrationStatus },
    });

    logger.debug(
      {
        organizationId: conversation.organization_id,
        conversationId: conversation.id,
        hasCompanyInterest: !!executionResult.companyInterest,
        hasFactGrounding: !!executionResult.confidence,
        logEntries: orchestrationStatus.guardrailLog.length,
      },
      "Guardrail log saved",
    );
  } catch (error) {
    logger.error(
      {
        err: error,
        organizationId: conversation.organization_id,
        conversationId: conversation.id,
      },
      "Error saving guardrail log",
    );
  }
}

export const runConversation = async (conversationId: string) => {
  // Note: findById is used here because this is called from the internal message queue
  // with trusted conversation IDs (not user input). We validate org context below.
  const conversation = await conversationRepository.findById(conversationId);
  if (!conversation) {
    throw new Error("Conversation not found");
  }
  if (!conversation.organization_id) {
    throw new Error("Conversation missing organization context");
  }

  const log = logger.child({
    organizationId: conversation.organization_id,
    conversationId: conversation.id,
  });

  // Skip processing for conversations taken over by humans
  // Check both status and assigned_user_id to handle race conditions
  if (conversation.status === "human-took-over" || conversation.assigned_user_id) {
    log.debug(
      {
        status: conversation.status,
        assignedUserId: conversation.assigned_user_id,
      },
      "Skipping - conversation taken over by human",
    );
    return;
  }

  const processingStartedAt = Date.now();

  // 00. Acquire processing lock before doing any work or incrementing attempt
  //     counters. Lock contention isn't a processing failure — just bail.
  const lockerId = await conversation.lock();
  if (!lockerId) {
    log.debug("Could not acquire lock, conversation already being processed");
    return;
  }

  // Keep the lock alive while we work. Long ops (vector search, LLM calls)
  // can far exceed the base lock duration; the heartbeat prevents the stale
  // detector from treating this run as abandoned.
  let heartbeatFailed = false;
  const heartbeatInterval = setInterval(async () => {
    try {
      const refreshed = await conversation.refreshLock(lockerId);
      if (!refreshed) {
        heartbeatFailed = true;
        log.warn("Lock heartbeat refresh failed — another worker may have taken over");
      }
    } catch (err) {
      log.warn({ err }, "Lock heartbeat error");
    }
  }, LOCK_HEARTBEAT_INTERVAL_MS);

  try {
    // Increment processing attempts now that we own the lock
    await conversationRepository.updateById(conversation.id, {
      processing_attempts: (conversation.processing_attempts || 0) + 1,
    });

    // 00.1 / 00.2. Fetch initial conversation state in parallel
    const [systemMessages, botMessages, lastCustomerMessage] = await Promise.all([
      conversation.getSystemMessages(),
      conversation.getBotMessages(),
      conversation.getLastCustomerMessage(),
    ]);

    if (systemMessages.length === 0) {
      await conversation.addInitialSystemMessage();
      await conversation.addInitialAgentInstructions();
    }

    if (botMessages.length === 0 && !lastCustomerMessage) {
      await conversation.addInitialBotMessage();
    }

    // 00.3. Check if last customer message is older than last processed at
    if (!conversation.needs_processing) {
      throw new Error("Conversation does not need processing");
    }

    if (!lastCustomerMessage) {
      // Clear needs_processing so the sweep doesn't re-enqueue this conversation
      // in a tight loop. Without this, any row with needs_processing=true but
      // no customer message becomes a sweep zombie.
      await conversation.setProcessed(true);
      throw new Error("Last customer message not found");
    }

    // Update processing state to perceiving
    await updateProcessingState(conversation, "perceiving", "Analyzing your message");

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

    // Also check for greet intents that contain gratitude (might be closing acknowledgment)
    const isGratitudeMessage =
      intent.label === "greet" &&
      /\b(thank|thanks|thx|appreciate|grateful|ty)\b/i.test(lastCustomerMessage.content);

    // If potential closure detected, validate with full conversation context
    let shouldClose = false;

    if (hasClosureIntent || isGratitudeMessage) {
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
        log.debug(
          { isGratitudeMessage, reason: closureValidation.reason },
          isGratitudeMessage
            ? "Gratitude message detected but validation determined it's not a closure"
            : "Closure intent detected but validation failed",
        );
      }
    }

    if (shouldClose) {
      log.debug(
        { intentLabel: intent.label, intentScore: intent.score },
        "User indicated closure intent, marking conversation as resolved",
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

      // Clean up ephemeral secrets from Redis
      await conversationSecretService.deleteSecrets(conversation.id);

      // Add a closing message generated contextually by the LLM
      let closingMessage: string;
      try {
        const llmService = new LLMService();
        const promptService = PromptService.getInstance();
        const messages = await conversation.getPublicMessages();
        const isSatisfied = intent.label === "close_satisfied";

        const prompt = await promptService.getPrompt(
          "conversation/user-closure-message",
          {
            satisfactionStatus: isSatisfied
              ? "satisfied with the support received"
              : "not fully satisfied",
          },
          { conversationId: conversation.id, organizationId: conversation.organization_id },
        );

        closingMessage = await llmService.invoke({
          history: messages,
          prompt,
        });
      } catch (error) {
        log.debug({ err: error }, "Error generating closing message, using fallback");
        closingMessage =
          intent.label === "close_satisfied"
            ? "Great! I'm glad I could help. This conversation has been marked as resolved. Feel free to start a new conversation if you need anything else!"
            : "I understand. This conversation has been marked as resolved. Please feel free to start a new conversation if you need further assistance.";
      }

      await sendBotMessage(
        conversation,
        {
          content: closingMessage,
          type: MessageType.BOT_AGENT,
          metadata: {
            isClosureMessage: true,
            closureReason: intent.label,
          },
        },
        log,
        processingStartedAt,
      );

      // Set processed and unlock early since we're closing.
      // The finally block will still run — it clears the heartbeat and the
      // ownership-checked unlock is a no-op the second time around.
      conversation.setProcessed(true);
      await updateProcessingState(conversation, "idle");
      await conversation.unlock(lockerId);
      return; // Exit early since conversation is closed
    }

    // 01.2. Agent Assignment
    // Agents are now required at conversation creation and fall back to organization default agent.
    // Automatic agent selection during orchestration is no longer used.
    const currentAgent = conversation.agent_id;
    if (!currentAgent) {
      log.debug("WARNING: No agent assigned to conversation");
      // This shouldn't happen if conversation creation is working correctly
      // Agent should be set at creation time or fall back to organization default
    } else {
      log.debug({ agentId: currentAgent }, "Agent assigned");
    }

    // Update processing state to retrieving
    await updateProcessingState(conversation, "retrieving", "Finding relevant information");

    // 02. Retrieval
    const retrievalLayer = new RetrievalLayer();

    // 02.1. Get Playbook Candidates
    const publicMessages = await conversation.getPublicMessages();

    const currentPlaybook = conversation.playbook_id;

    log.debug(
      {
        currentPlaybookId: currentPlaybook,
        publicMessagesCount: publicMessages.length,
      },
      "Starting playbook retrieval",
    );

    // Run playbook lookup and document retrieval in parallel — they share no
    // data dependency. Document retrieval (vector search) overlaps with the
    // playbook DB fetch.
    const [activePlaybooks, retrievedDocuments] = await Promise.all([
      playbookRepository.findByStatus(conversation.organization_id, PlaybookStatus.ACTIVE),
      retrievalLayer.getRelevantDocuments(publicMessages, conversation.organization_id),
    ]);

    log.debug(
      {
        activePlaybooksCount: activePlaybooks.length,
        playbooks: activePlaybooks.map((p) => ({
          id: p.id,
          title: p.title,
          trigger: p.trigger?.substring(0, 50),
        })),
      },
      "Retrieved active playbooks",
    );

    const playbookCandidate = await retrievalLayer.getPlaybookCandidate(
      publicMessages,
      activePlaybooks,
      conversation.organization_id,
    );

    if (playbookCandidate && playbookCandidate.id !== currentPlaybook) {
      log.debug(
        {
          oldPlaybookId: currentPlaybook,
          newPlaybookId: playbookCandidate.id,
          newPlaybookTitle: playbookCandidate.title,
        },
        "Playbook candidate differs from current, updating conversation",
      );
      await conversation.updatePlaybook(playbookCandidate.id);
    } else if (playbookCandidate) {
      // Check if enabled_tools is null despite having a playbook - this means tools were never fetched
      if (!conversation.enabled_tools || conversation.enabled_tools.length === 0) {
        log.debug(
          {
            playbookId: currentPlaybook,
            enabledTools: conversation.enabled_tools,
          },
          "Playbook is set but enabled_tools is null, refreshing tools",
        );
        await conversation.updatePlaybook(playbookCandidate.id);
      } else {
        log.debug(
          {
            playbookId: currentPlaybook,
            enabledToolsCount: conversation.enabled_tools.length,
          },
          "Playbook candidate matches current playbook, no update needed",
        );
      }
    } else {
      log.debug({ currentPlaybookId: currentPlaybook }, "No playbook candidate selected");
    }

    // 02.2. Document Candidates (already fetched in parallel above)
    log.debug(
      {
        currentDocumentIds: conversation.document_ids,
        retrievedDocumentsCount: retrievedDocuments.length,
        documents: retrievedDocuments,
      },
      "Document retrieval complete",
    );

    if (retrievedDocuments.length > 0) {
      for (const document of retrievedDocuments) {
        if (!conversation.document_ids?.includes(document.id)) {
          log.debug(
            {
              documentId: document.id,
              similarity: document.similarity,
            },
            "Adding new document to conversation",
          );
          await conversation.addDocument(document.id);
        } else {
          log.debug({ documentId: document.id }, "Document already attached to conversation");
        }
      }
    } else {
      log.debug("No relevant documents found");
    }

    // 03. Initialize orchestration context if needed
    if (!conversation.orchestration_status) {
      const initialContext: ConversationContext = {
        version: "v1",
        lastTurn: 0,
        toolLog: [],
      };
      await conversationRepository.updateById(conversation.id, {
        orchestration_status: { ...initialContext },
      });
      conversation.orchestration_status = { ...initialContext };
    }

    // Update processing state to executing
    await updateProcessingState(conversation, "executing", "Generating response");

    // Log current conversation state before execution
    log.debug(
      {
        playbookId: conversation.playbook_id,
        enabledTools: conversation.enabled_tools,
        enabledToolsCount: conversation.enabled_tools?.length || 0,
        agentId: conversation.agent_id,
      },
      "Conversation state before execution",
    );

    // 04. Execution - Handle iterative execution with tool calls
    await handleExecutionLoop(conversation, processingStartedAt, language);

    // Update processing state to idle (done)
    await updateProcessingState(conversation, "idle");

    // SUCCESS: Reset error counters
    await conversationRepository.updateById(conversation.id, {
      processing_error_count: 0,
      last_processing_error: null,
      last_processing_error_at: null,
      is_stuck: false,
      stuck_detected_at: null,
      stuck_reason: null,
    });

    // Generate conversation title if still empty and enough messages exist
    if (!conversation.title || conversation.title.trim() === "") {
      const publicMessages = await conversation.getPublicMessages();
      const customerMessages = publicMessages.filter((m) => m.type === MessageType.CUSTOMER);

      // Generate title after at least 2 customer messages
      if (customerMessages.length >= 2) {
        log.debug(
          { customerMessagesCount: customerMessages.length },
          "Generating conversation title",
        );

        // Generate title asynchronously (don't block processing)
        const { generateConversationTitle } = await import("./conversation-utils");
        generateConversationTitle(conversation.id, conversation.organization_id, false).catch(
          (error) => {
            log.warn({ err: error }, "Error generating title during processing");
          },
        );
      }
    }

    conversation.setProcessed(true);
  } catch (error: Error | unknown) {
    if (
      error instanceof Error &&
      !error.message.includes("Conversation does not need processing") &&
      !error.message.includes("Last customer message not found")
    ) {
      log.error({ err: error }, "Error in conversation");

      // FAILURE: Track error
      const errorCount = (conversation.processing_error_count || 0) + 1;
      await conversationRepository.updateById(conversation.id, {
        processing_error_count: errorCount,
        last_processing_error: error.message,
        last_processing_error_at: new Date(),
      });

      // Mark as stuck if threshold exceeded
      if (errorCount >= 3) {
        await conversationRepository.updateById(conversation.id, {
          is_stuck: true,
          stuck_detected_at: new Date(),
          stuck_reason: "repeated_processing_failures",
        });
      }
    }
    // Set to idle on error
    await updateProcessingState(conversation, "idle");
  } finally {
    // Stop the heartbeat first so we don't refresh a lock we're about to release.
    clearInterval(heartbeatInterval);

    if (heartbeatFailed) {
      log.warn(
        "Run completed after heartbeat failure — another worker likely processed this conversation in parallel",
      );
    }

    // Ownership-checked unlock: no-op if we lost the lock to another worker.
    try {
      await conversation.unlock(lockerId);
    } catch (unlockError) {
      log.error({ err: unlockError }, "Failed to release lock");
    }
  }
};

/**
 * Handle iterative execution loop with tool calls
 * This allows the LLM to call tools, analyze results, and continue the conversation
 */
async function handleExecutionLoop(
  conversation: Conversation,
  processingStartedAt: number,
  customerLanguage?: string,
) {
  const log = logger.child({
    organizationId: conversation.organization_id,
    conversationId: conversation.id,
  });
  const executionLayer = new ExecutionLayer();
  const toolExecutionService = new ToolExecutionService();
  const MAX_ITERATIONS = 15; // Prevent infinite loops
  const MAX_EMPTY_RETRIES = 3; // Max retries when LLM returns incomplete responses
  let iterations = 0;
  let emptyRetries = 0; // Track consecutive retries without valid response
  let handoffProcessed = false; // Track if handoff has been processed
  let hasToolCallBeenMade = false; // Track if we've sent the initial processing message

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    log.debug(`Execution iteration ${iterations}`);

    // Get current messages and execute (with confidence guardrails integrated)
    const executionResult: ExecutionResult | null = await executionLayer.execute(
      conversation,
      customerLanguage,
    );

    if (!executionResult) {
      emptyRetries++;
      log.debug(
        {
          emptyRetries,
          maxEmptyRetries: MAX_EMPTY_RETRIES,
        },
        "No execution result",
      );

      // If we've retried too many times, use a fallback response
      if (emptyRetries >= MAX_EMPTY_RETRIES) {
        log.warn("Max empty retries reached, using fallback response");
        await sendBotMessage(
          conversation,
          {
            content: "I'm here to help! How can I assist you today?",
            type: MessageType.BOT_AGENT,
            metadata: {
              isFallbackResponse: true,
              reason: "execution_planning_failed",
            },
          },
          log,
          processingStartedAt,
        );
        break;
      }
      continue;
    }

    // Reset empty retry counter on successful response
    emptyRetries = 0;

    log.debug(
      {
        step: executionResult.step,
        hasUserMessage: !!executionResult.userMessage,
        userMessagePreview: executionResult.userMessage?.substring(0, 100),
        hasTool: !!executionResult.tool,
        toolName: executionResult.tool?.name,
        hasHandoff: !!executionResult.handoff,
        hasClose: !!executionResult.close,
        rationale: executionResult.rationale,
      },
      "Processing execution result",
    );

    // Enforce enabled_tools: reject tool calls not in the conversation's allowed list.
    // Policy: when enabled_tools is null/empty (no playbook), all tools are allowed.
    // When a playbook defines enabled_tools, only those tools may be called.
    if (executionResult.step === "CALL_TOOL" && executionResult.tool) {
      const enabledTools = conversation.enabled_tools;
      if (enabledTools && enabledTools.length > 0) {
        if (!enabledTools.includes(executionResult.tool.name)) {
          log.warn(
            {
              toolName: executionResult.tool.name,
              enabledTools,
            },
            "Tool execution blocked — not in enabled_tools",
          );
          // Don't count blocked tool calls toward the iteration limit —
          // feed an error back to the LLM so it can adjust instead of silently looping.
          iterations--;
          await conversation.addMessage({
            content: `Tool "${executionResult.tool.name}" is not available in this conversation. Available tools: ${enabledTools.join(", ")}`,
            type: MessageType.TOOL,
            metadata: {
              toolName: executionResult.tool.name,
              status: "blocked",
              reason: "not_in_enabled_tools",
            },
          });
          continue;
        }
      }
    }

    // Handle case where LLM returns both a userMessage and a tool call
    if (
      executionResult.step === "CALL_TOOL" &&
      executionResult.userMessage &&
      executionResult.tool
    ) {
      // Only send the userMessage if this is the first tool call
      if (!hasToolCallBeenMade) {
        await sendBotMessage(
          conversation,
          {
            content: executionResult.userMessage,
            type: MessageType.BOT_AGENT,
          },
          log,
          processingStartedAt,
        );
        hasToolCallBeenMade = true;
      }

      // Then create the tool message
      const toolMessageId = await conversation.addMessage({
        content: `Running action: ${executionResult.tool.name}`,
        type: MessageType.TOOL,
        metadata: {
          toolName: executionResult.tool.name,
          toolInput: executionResult.tool.args,
          toolStatus: "RUNNING",
        },
      });

      // Execute the tool
      await toolExecutionService.handleToolExecution(
        conversation,
        executionResult.tool,
        toolMessageId?.id,
      );

      // Continue the loop to let LLM analyze the result
      continue;
    } else if (executionResult.step === "CALL_TOOL" && executionResult.tool) {
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
      await toolExecutionService.handleToolExecution(
        conversation,
        executionResult.tool,
        toolMessageId?.id,
      );

      // The tool execution service now updates the message internally
      // Continue the loop to let LLM analyze the result
    } else if (executionResult.step === "HANDOFF") {
      // Handle human handoff
      log.debug(
        {
          confidenceRelated: !!executionResult.confidence,
          confidenceScore: executionResult.confidence?.score,
        },
        "HANDOFF step detected",
      );

      // Check if we've already processed handoff to avoid duplicates
      if (handoffProcessed) {
        log.debug("Handoff already processed, skipping duplicate");
        continue;
      }

      handoffProcessed = true; // Mark as processed

      // Save confidence log if this is a confidence-related handoff
      await saveConfidenceLog(conversation, executionResult);

      // Get agent configuration
      const agent = await agentRepository.findById(conversation.agent_id!);
      if (!agent) {
        log.warn("No agent found for handoff, using default behavior");
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

        await sendBotMessage(
          conversation,
          {
            content: handoffMessage,
            type: MessageType.BOT_AGENT,
            metadata: buildMessageMetadata(executionResult, {
              isHandoffMessage: true,
            }),
          },
          log,
          processingStartedAt,
        );
        break;
      }

      // Check if there are online human agents
      const onlineHumans = await userRepository.findOnlineByOrganization(
        conversation.organization_id,
      );
      log.debug(`Found ${onlineHumans.length} online human agents`);

      if (onlineHumans.length > 0) {
        // Humans are available
        const availableInstructions = agent.human_handoff_available_instructions;

        if (
          availableInstructions &&
          Array.isArray(availableInstructions) &&
          availableInstructions.length > 0
        ) {
          // Execute custom instructions for when humans are available
          log.debug("Executing handoff instructions for available humans");
          await conversation.addHandoffInstructions(availableInstructions, "available");
          // Continue loop to process the handoff instructions
          continue;
        } else {
          // Default behavior: update status and send message
          log.debug("No custom instructions, using default handoff");
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
              log.error({ err: error }, "Error generating handoff message");
              handoffMessage =
                "I'm transferring you to a human agent. Someone will be with you shortly.";
            }
          }

          try {
            await sendBotMessage(
              conversation,
              {
                content: handoffMessage,
                type: MessageType.BOT_AGENT,
                metadata: buildMessageMetadata(executionResult, {
                  isHandoffMessage: true,
                  handoffType: "available",
                }),
              },
              log,
              processingStartedAt,
            );
          } catch (error) {
            log.error({ err: error }, "Error generating handoff message");
            await sendBotMessage(
              conversation,
              {
                content: "I'm connecting you with a human agent who will be with you shortly.",
                type: MessageType.BOT_AGENT,
                metadata: buildMessageMetadata(executionResult, {
                  isHandoffMessage: true,
                  handoffType: "available",
                }),
              },
              log,
              processingStartedAt,
            );
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
          log.debug("Executing handoff instructions for unavailable humans");
          await conversation.addHandoffInstructions(unavailableInstructions, "unavailable");
          // Continue loop to process the handoff instructions
          continue;
        } else {
          // Use executionResult.userMessage if available, otherwise use default
          const unavailableMessage =
            executionResult.userMessage ||
            "I apologize, but no human agents are currently available.";

          log.debug("No custom fallback, using default message");
          await sendBotMessage(
            conversation,
            {
              content: unavailableMessage,
              type: MessageType.BOT_AGENT,
              metadata: buildMessageMetadata(executionResult, {
                isHandoffMessage: true,
                handoffType: "unavailable",
              }),
            },
            log,
            processingStartedAt,
          );
          break;
        }
      }
    } else if (executionResult.step === "CLOSE") {
      // Handle conversation closure
      log.debug("CLOSE step detected");
      if (executionResult.userMessage) {
        await sendBotMessage(
          conversation,
          {
            content: executionResult.userMessage,
            type: MessageType.BOT_AGENT,
          },
          log,
          processingStartedAt,
        );
      }
      // Clean up ephemeral secrets from Redis
      await conversationSecretService.deleteSecrets(conversation.id);
      break;
    } else {
      // Regular response (not a tool call) - end the loop
      if (executionResult.userMessage) {
        // Save confidence log if available
        await saveConfidenceLog(conversation, executionResult);

        // Detect if message claims action without executing tool
        if (executionResult.tool && executionResult.tool.name) {
          log.error(
            {
              toolName: executionResult.tool.name,
              messagePreview: executionResult.userMessage.substring(0, 100),
            },
            "HALLUCINATION DETECTED: Saved user message with unpopulated tool field",
          );
        }

        await sendBotMessage(
          conversation,
          {
            content: executionResult.userMessage,
            type: MessageType.BOT_AGENT,
            metadata: {
              ...buildMessageMetadata(executionResult),
              ...(executionResult.tool
                ? { potentialHallucination: true, claimedTool: executionResult.tool.name }
                : {}),
            },
          },
          log,
          processingStartedAt,
        );
        log.debug(
          {
            messagePreview: executionResult.userMessage.substring(0, 100),
            confidenceScore: executionResult.confidence?.score,
            confidenceTier: executionResult.confidence?.tier,
          },
          "Added bot response, ending execution loop",
        );

        break;
      } else {
        // Missing userMessage for non-tool/non-handoff/non-close steps
        emptyRetries++;
        log.error(
          {
            step: executionResult.step,
            emptyRetries,
            maxEmptyRetries: MAX_EMPTY_RETRIES,
            hasTool: !!executionResult.tool,
            toolName: executionResult.tool?.name,
            hasHandoff: !!executionResult.handoff,
            hasClose: !!executionResult.close,
            rationale: executionResult.rationale,
            fullResult: JSON.stringify(executionResult),
            possibleBug: executionResult.step === "RESPOND" && !!executionResult.tool,
          },
          "No user message in response, retrying",
        );

        // If we've retried too many times, use a fallback response
        if (emptyRetries >= MAX_EMPTY_RETRIES) {
          log.warn("Max retries for missing userMessage, using fallback");
          await sendBotMessage(
            conversation,
            {
              content: "I'm here to help! How can I assist you today?",
              type: MessageType.BOT_AGENT,
              metadata: {
                isFallbackResponse: true,
                reason: "missing_user_message",
              },
            },
            log,
            processingStartedAt,
          );
          break;
        }
        continue;
      }
    }
  }

  if (iterations >= MAX_ITERATIONS) {
    log.warn("Reached maximum execution iterations, ending loop");
  }
}
