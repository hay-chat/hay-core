import { conversationRepository } from "@server/repositories/conversation.repository";
import { playbookRepository } from "@server/repositories/playbook.repository";
import { conversationSecretService } from "@server/services/conversation-secret.service";
import { PerceptionLayer } from "./perception.layer";
import { RetrievalLayer } from "./retrieval.layer";
import { ExecutionLayer } from "./execution.layer";
import { PlaybookStatus } from "@server/database/entities/playbook.entity";
import type { Playbook } from "@server/database/entities/playbook.entity";
import { shouldReselectPlaybook } from "./playbook-gate";
import { withOverridePlaybook } from "@server/services/playbook-version-override";
import { agentRepository } from "@server/repositories/agent.repository";
import { MessageType } from "@server/database/entities/message.entity";
import { ToolExecutionService } from "@server/services/core/tool-execution.service";
import { Conversation } from "@server/database/entities/conversation.entity";
import type { ConversationContext, GuardrailLogEntry, ProcessingPhase } from "./types";
import { LLMService } from "@server/services/core/llm.service";
import { PromptService } from "@server/services/prompt.service";
import { createLogger } from "@server/lib/logger";
import { hasTiptapContent } from "@server/types/tiptap.types";
import { closureCopy } from "./closure-copy";
import { availabilityContext, availabilityHandoffLine } from "./handoff-copy";
import { getAvailability, typicalFirstReplyMinutes } from "@server/services/business-hours.service";
import {
  handoffTicketsService,
  readHandoffTicket,
  requestHandoffTicket,
  ticketHandoffInstructions,
} from "@server/services/handoff-tickets/handoff-tickets.service";
import { AiReplySuppressedError, isPauseBlocker, recheckAiReply } from "./reply-guard";
import { isOrganizationAiPaused } from "@server/types/organization-access.types";
import { sendPausedNotice } from "./paused-notice";
import { sendSuspendedHoldingReply } from "./suspended-holding-reply";
import type { ExecutionResult } from "./execution.layer";
import type { ToolLedgerEntry } from "@server/services/core/action-claim-guardrail.service";
import { decidedActionsLedger } from "./decided-actions";
import type { Message } from "@server/database/entities/message.entity";
import type pino from "pino";

const logger = createLogger("orchestrator-run");

const LOCK_HEARTBEAT_INTERVAL_MS = 5_000;

/**
 * Abandon the run if a human took over, or the agent or organization was
 * paused, since the run started. Called right before anything the shopper
 * would see, because the gates at the top of runConversation are read once
 * and a run can take many seconds.
 */
async function assertAiMayReply(conversation: Conversation): Promise<void> {
  const blocker = await recheckAiReply(conversation.id);
  if (blocker) {
    throw new AiReplySuppressedError(blocker);
  }
}

/**
 * Send a bot message and log how long it took from the start of processing.
 * Re-checks take-over and pause first, so a reply already in flight is
 * dropped rather than delivered on top of a human.
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
  await assertAiMayReply(conversation);
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

  // Stage 0: Action-claim guardrail. passed=false means the reply sent still
  // carries (or replaced) an unbacked claim after the retries; the replay
  // judge reads this (D7-10).
  if (executionResult.actionClaim) {
    metadata.actionClaim = {
      passed: executionResult.actionClaim.passed,
      claimedActions: executionResult.actionClaim.claimedActions,
    };
  }
  if (executionResult.actionClaimRetryAttempted) {
    metadata.actionClaimRetryAttempted = true;
  }

  // Stage 1: Company Interest Protection
  if (executionResult.companyInterest) {
    metadata.companyInterest = {
      passed: executionResult.companyInterest.passed,
      violationType: executionResult.companyInterest.violationType,
      severity: executionResult.companyInterest.severity,
      shouldBlock: executionResult.companyInterest.shouldBlock,
      requiresFactCheck: executionResult.companyInterest.requiresFactCheck,
      reasoning: executionResult.companyInterest.reasoning,
      retryAttempted: executionResult.companyInterestRetryAttempted || false,
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

/**
 * A paused agent never replies, whether the owner switched the agent off or the
 * operator paused the whole organization (e.g. included resolutions used up).
 * A conversation that already holds a shopper message goes to "pending-human"
 * (Needs Attention) so a human picks it up, and the shopper is told once that
 * the team will reply there; a conversation with no shopper
 * message yet (widget just opened) only has its needs_processing flag cleared,
 * so no greeting is sent and the sweep stops.
 */
async function parkForPausedAgent(
  conversation: Conversation,
  log: pino.Logger,
  cause: "agent_disabled" | "organization_paused",
): Promise<void> {
  const lastCustomerMessage = await conversation.getLastCustomerMessage();
  const shouldQueue = !!lastCustomerMessage && conversation.status !== "pending-human";

  log.info(
    {
      agentId: conversation.agent_id,
      cause,
      reason: conversation.organization?.agentPauseReason ?? null,
      queued: shouldQueue,
    },
    "Skipping - agent paused",
  );

  if (!conversation.needs_processing && !shouldQueue) {
    return;
  }

  const updates: Partial<Conversation> = { needs_processing: false };
  if (shouldQueue) {
    updates.status = "pending-human";
  }
  await conversationRepository.update(conversation.id, conversation.organization_id, updates);

  if (shouldQueue) {
    await publishStatusChange(
      conversation.organization_id,
      conversation.id,
      "pending-human",
      conversation.title,
    );
    // One fixed line so the shopper knows a person will answer (D11-9).
    await sendPausedNotice(conversation);
  }
}

async function isChannelAiOff(conversation: Conversation): Promise<boolean> {
  const { resolveChannelAiMode } = await import("@server/types/organization-settings.types");
  if (resolveChannelAiMode(conversation.organization?.settings, conversation.channel) !== "off") {
    return false;
  }
  const { isTestConversation } =
    await import("@server/services/close-classification/outcome-rules");
  return !isTestConversation(conversation.metadata);
}

/**
 * Leave the conversation to the team without a word to the shopper: clear
 * needs_processing so the sweep stops re-enqueuing it, and queue an open
 * conversation as pending-human so it shows up in Needs Attention.
 */
async function parkForTeam(conversation: Conversation, log: pino.Logger): Promise<void> {
  log.debug({ channel: conversation.channel }, "Skipping - AI is off on this channel");
  if (!conversation.needs_processing) return;
  const queue = conversation.status === "open";
  await conversationRepository.update(conversation.id, conversation.organization_id, {
    needs_processing: false,
    ...(queue ? { status: "pending-human" as const } : {}),
  });
  if (queue) {
    await publishStatusChange(
      conversation.organization_id,
      conversation.id,
      "pending-human",
      conversation.title,
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

  // Suspended organizations keep receiving (and storing) messages but get no
  // AI reply. Clear the flag so the sweep stops re-enqueuing this conversation
  // and the stale-message recovery never escalates it to a human. An open
  // conversation is queued for the team (pending-human) so it is waiting in
  // Needs Attention when the account is reactivated, and on external channels
  // the shopper is told once that the message arrived (D15-4).
  if (conversation.organization?.suspendedAt) {
    log.info(
      { reason: conversation.organization.suspensionReason },
      "Skipping - organization suspended",
    );
    if (conversation.needs_processing) {
      const updates: Partial<Conversation> = { needs_processing: false };
      if (conversation.status === "open") updates.status = "pending-human";
      await conversationRepository.update(conversation.id, conversation.organization_id, updates);
      try {
        await sendSuspendedHoldingReply(conversation);
      } catch (err) {
        log.warn({ err }, "Could not send the holding reply for a suspended organization");
      }
    }
    return;
  }

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

  // Waiting for a person (D5-7): outside the channel's business hours the AI
  // keeps answering while the conversation stays in the queue; within hours it
  // stays quiet and the team answers.
  if (conversation.status === "pending-human") {
    const { isWithinBusinessHours } = await import("@server/services/business-hours.service");
    const withinHours = await isWithinBusinessHours({
      organizationId: conversation.organization_id,
      channel: conversation.channel,
    });
    // A hand-off raising a ticket keeps the AI talking until it is raised: it
    // may still need the customer's email.
    if (withinHours && readHandoffTicket(conversation)?.status !== "requested") {
      log.debug("Skipping - waiting for the team within business hours");
      if (conversation.needs_processing) {
        await conversationRepository.update(conversation.id, conversation.organization_id, {
          needs_processing: false,
        });
      }
      return;
    }
  }

  // A paused agent never replies: either the operator paused the organization
  // (usage allowance used up, overage refused) or the owner switched the agent
  // off (agents.enabled = false). Shopper messages are still stored; the
  // conversation is parked in the queue as pending-human so the team sees it,
  // and needs_processing is cleared so the sweep stops re-enqueuing it.
  if (isOrganizationAiPaused(conversation.organization)) {
    await parkForPausedAgent(conversation, log, "organization_paused");
    return;
  }
  if (conversation.agent && !conversation.agent.enabled) {
    await parkForPausedAgent(conversation, log, "agent_disabled");
    return;
  }

  // AI switched off on this channel (D7-14, "start on Web Chat only"): the
  // team answers. No notice to the shopper; test conversations still run.
  if (await isChannelAiOff(conversation)) {
    await parkForTeam(conversation, log);
    return;
  }

  // Spam is held from the AI (D9-6): no reply, no billing.
  const { holdIfSpam } = await import("@server/services/spam/spam-hold.service");
  if (await holdIfSpam(conversation, log)) return;

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

  // Whether this run ended in a processing error. Errors are retried by the
  // sweep with error counting; every other outcome re-checks the flag on exit.
  let failed = false;

  try {
    // The flag was read before the lock. Another run may have answered in the
    // meantime, so re-read it now that no other run can.
    const current = await conversationRepository.findById(conversation.id);
    conversation.needs_processing = current?.needs_processing === true;

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
      // no customer message becomes a sweep zombie. Compare-and-set: a customer
      // message that landed after the read above keeps the flag.
      await conversation.markProcessed(null);
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

    // A conversation waiting in the team's queue (the AI answers it outside
    // business hours, D5-7) is closed by the team, never by a "thanks, bye".
    if ((hasClosureIntent || isGratitudeMessage) && conversation.status !== "pending-human") {
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

      // An unhappy close is not a resolution (D5-5): it gets its own status.
      // The billing outcome is recorded by the repository on this transition.
      await conversationRepository.update(conversation.id, conversation.organization_id, {
        status: intent.label === "close_unsatisfied" ? "unresolved" : "resolved",
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
          // Short closing line; falls back to a hardcoded string on error.
          tier: "easy",
          organizationId: conversation.organization_id,
        });
      } catch (error) {
        log.debug({ err: error }, "Error generating closing message, using fallback");
        closingMessage = closureCopy(
          intent.label === "close_unsatisfied" ? "closeUnsatisfied" : "closeSatisfied",
          language,
          conversation.language,
          conversation.organization?.defaultLanguage,
        );
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
      await conversation.markProcessed(lastCustomerMessage.id);
      await updateProcessingState(conversation, "idle");
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
    const [livePlaybooks, retrievedDocuments] = await Promise.all([
      playbookRepository.findByStatus(conversation.organization_id, PlaybookStatus.ACTIVE),
      retrievalLayer.getRelevantDocuments(publicMessages, conversation.organization_id),
    ]);
    const activePlaybooks = await selectablePlaybooks(conversation, livePlaybooks);

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

    // Gated: the selector re-scores every active playbook against the whole
    // transcript, and on most turns re-picks the one already set. Skip it while the
    // planner keeps confirming the current playbook fits (see selectPlaybook below).
    if (shouldReselectPlaybook(conversation, activePlaybooks.length)) {
      await selectPlaybook(conversation, retrievalLayer, publicMessages, activePlaybooks, log);
    } else {
      log.debug(
        { currentPlaybookId: currentPlaybook },
        "Skipping playbook selection — planner confirmed the current playbook last turn",
      );
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

    await conversation.markProcessed(lastCustomerMessage.id);
  } catch (error: Error | unknown) {
    if (error instanceof AiReplySuppressedError) {
      // Not a processing failure: a human took over, or the agent or the
      // organization was paused while this run was thinking. Nothing was sent.
      log.info({ blocker: error.blocker }, "Dropped in-flight AI reply");
      if (isPauseBlocker(error.blocker)) {
        await parkForPausedAgent(conversation, log, error.blocker);
      }
    } else if (
      error instanceof Error &&
      !error.message.includes("Conversation does not need processing") &&
      !error.message.includes("Last customer message not found")
    ) {
      failed = true;
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

    if (!failed) {
      await requeueIfStillPending(conversation, log);
    }
  }
};

/**
 * One AI turn after a person decided on a held action (D4-5). There is no new
 * shopper message: the decision was written into the conversation as a
 * system note, and the planner answers it (tell the shopper it is done, or
 * explain the refusal). Skips perception and playbook selection.
 *
 * Throws when another run holds the lock, so the queue retries.
 */
/** Another run holds the conversation lock; the approval follow-up must be retried. */
export class ConversationLockedError extends Error {
  constructor() {
    super("Conversation is locked; approval follow-up will retry");
    this.name = "ConversationLockedError";
  }
}

export const runApprovalFollowUp = async (conversationId: string): Promise<void> => {
  const conversation = await conversationRepository.findById(conversationId);
  if (!conversation?.organization_id) return;
  const log = logger.child({
    organizationId: conversation.organization_id,
    conversationId: conversation.id,
  });

  if (await recheckAiReply(conversation.id)) {
    log.debug("Skipping approval follow-up - the AI may not reply");
    return;
  }

  const lockerId = await conversation.lock();
  if (!lockerId) {
    throw new ConversationLockedError();
  }
  const heartbeat = setInterval(() => {
    conversation.refreshLock(lockerId).catch((err) => log.warn({ err }, "Lock heartbeat error"));
  }, LOCK_HEARTBEAT_INTERVAL_MS);

  try {
    await handleExecutionLoop(
      conversation,
      Date.now(),
      conversation.language ?? undefined,
      await decidedActionsLedger(conversation),
    );
  } catch (error) {
    if (!(error instanceof AiReplySuppressedError)) throw error;
    log.info({ blocker: error.blocker }, "Dropped approval follow-up reply");
  } finally {
    clearInterval(heartbeat);
    await updateProcessingState(conversation, "idle");
    try {
      await conversation.unlock(lockerId);
    } catch (unlockError) {
      log.error({ err: unlockError }, "Failed to release lock");
    }
    await requeueIfStillPending(conversation, log);
  }
};

/**
 * A customer message that arrived while this run held the lock queued a run
 * that found the lock taken and gave up, and markProcessed left its flag set.
 * Queue it again now the lock is free, instead of waiting for the sweep.
 */
async function requeueIfStillPending(conversation: Conversation, log: pino.Logger): Promise<void> {
  try {
    const current = await conversationRepository.findById(conversation.id);
    const runnable = current?.status === "open" || current?.status === "pending-human";
    if (!current?.needs_processing || !runnable || current.assigned_user_id) {
      return;
    }
    const { orchestratorQueueService } =
      await import("@server/services/orchestrator-queue.service");
    await orchestratorQueueService.enqueue(
      conversation.id,
      conversation.organization_id,
      "customer_message",
    );
    log.debug("Customer message arrived during the run, re-queued");
  } catch (error) {
    log.warn({ err: error }, "Re-queue check failed, the sweep will pick it up");
  }
}

/**
 * Handle iterative execution loop with tool calls
 * This allows the LLM to call tools, analyze results, and continue the conversation
 */

/** Live playbooks, plus the one a test conversation runs a draft of (D7-5). */
function selectablePlaybooks(conversation: Conversation, livePlaybooks: Playbook[]) {
  return withOverridePlaybook(
    conversation.metadata,
    conversation.organization_id,
    livePlaybooks,
    (playbookId, organizationId) =>
      playbookRepository.findByIdAndOrganization(playbookId, organizationId),
  );
}

/** Run the selector and apply its result to the conversation. */
async function selectPlaybook(
  conversation: Conversation,
  retrievalLayer: RetrievalLayer,
  publicMessages: Message[],
  activePlaybooks: Playbook[],
  log: pino.Logger,
): Promise<void> {
  const currentPlaybook = conversation.playbook_id;
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
    if (!conversation.enabled_tools || conversation.enabled_tools.length === 0) {
      log.debug(
        { playbookId: currentPlaybook, enabledTools: conversation.enabled_tools },
        "Playbook is set but enabled_tools is null, refreshing tools",
      );
      await conversation.updatePlaybook(playbookCandidate.id);
    } else {
      log.debug(
        { playbookId: currentPlaybook, enabledToolsCount: conversation.enabled_tools.length },
        "Playbook candidate matches current playbook, no update needed",
      );
    }
  } else {
    log.debug({ currentPlaybookId: currentPlaybook }, "No playbook candidate selected");
  }

  // A fresh selection is trusted until the planner says otherwise.
  await recordPlaybookFit(conversation, true);
}

/** Persist the planner's playbook verdict so the next turn can gate on it. */
async function recordPlaybookFit(conversation: Conversation, fits: boolean): Promise<void> {
  if (conversation.metadata?.playbookFits === fits) return;
  const { conversationRepository } = await import("../repositories/conversation.repository");
  const metadata = { ...(conversation.metadata ?? {}), playbookFits: fits };
  conversation.metadata = metadata;
  await conversationRepository.update(conversation.id, conversation.organization_id, { metadata });
}

async function handleExecutionLoop(
  conversation: Conversation,
  processingStartedAt: number,
  customerLanguage?: string,
  decidedActions: ToolLedgerEntry[] = [],
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
  // The fixed hand-off line, held back while the merchant's instructions run.
  let deferredHandoffLine: Parameters<typeof sendBotMessage>[1] | null = null;
  let hasToolCallBeenMade = false; // Track if we've sent the initial processing message
  // Ledger of tool calls made during THIS turn (conversation history is not
  // turn-scoped). The action-claim guardrail compares RESPOND claims against it.
  const toolsCalledThisTurn: ToolLedgerEntry[] = [...decidedActions];
  // Shared (by reference) with the execution layer so corrective re-plans are
  // budgeted per turn, not per execute() call.
  const turnGuardrailState = { actionClaimRetries: 0, companyInterestRetries: 0 };
  // One playbook re-selection per turn, so a planner that keeps saying "doesn't fit"
  // can't ping-pong between playbooks.
  let playbookReselected = false;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    log.debug(`Execution iteration ${iterations}`);

    // Get current messages and execute (with confidence guardrails integrated)
    let executionResult: ExecutionResult | null = await executionLayer.execute(
      conversation,
      customerLanguage,
      { toolsCalledThisTurn, turnGuardrailState },
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

    // The plan took seconds to produce. Before acting on it (tool call or
    // message), make sure nobody took over and the agent is still on.
    await assertAiMayReply(conversation);

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

    // The planner is the only call that actually reads the playbook, so it is the
    // one that can tell whether it still fits. `false` means the customer moved on
    // (order status -> refund) and this plan was made against the wrong playbook:
    // re-select and re-plan once, rather than shipping a stale answer and fixing it
    // on the next turn. Bounded to one attempt per turn, like the guardrail retries.
    if (executionResult.playbookFits === false && !playbookReselected) {
      playbookReselected = true;
      log.debug(
        { playbookId: conversation.playbook_id, rationale: executionResult.rationale },
        "Planner reported the active playbook no longer fits — re-selecting and re-planning",
      );
      await recordPlaybookFit(conversation, false);

      const retrievalLayer = new RetrievalLayer();
      const activePlaybooks = await selectablePlaybooks(
        conversation,
        await playbookRepository.findByStatus(conversation.organization_id, PlaybookStatus.ACTIVE),
      );
      if (activePlaybooks.length > 0) {
        const publicMessages = await conversation.getPublicMessages();
        await selectPlaybook(conversation, retrievalLayer, publicMessages, activePlaybooks, log);
        // Don't spend an iteration on a plan we're discarding.
        iterations--;
        continue;
      }
    } else if (executionResult.playbookFits === true) {
      await recordPlaybookFit(conversation, true);
    }

    // Enforce enabled_tools: reject tool calls not in the conversation's allowed list.
    // Policy: when enabled_tools is null/empty (no playbook), all tools are allowed.
    // When a playbook defines enabled_tools, only those tools may be called.
    // EXCEPTION: core tools (e.g. recommend_products) are always allowed —
    // they're built into core and not part of any playbook's tool list.
    if (executionResult.step === "CALL_TOOL" && executionResult.tool) {
      const enabledTools = conversation.enabled_tools;
      const { coreToolRegistry } = await import("@server/services/core/core-tools");
      const { isPageTool } = await import("@server/services/webchat/page-tools.service");
      // Page tools (registered by the host page in the browser) are exempt too:
      // they exist only while that page is open, never in a playbook's list.
      const isCoreTool =
        coreToolRegistry.has(executionResult.tool.name) || isPageTool(executionResult.tool.name);
      if (!isCoreTool && enabledTools && enabledTools.length > 0) {
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
          toolsCalledThisTurn.push({ name: executionResult.tool.name, success: false });
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

    // Quick check with the team (D19): one fact goes to the team and the
    // conversation stays with the AI. When the rules don't allow it (setting
    // off, approval mode, limits), it is an ordinary hand-off.
    if (executionResult.step === "ASK_TEAM") {
      const handled = await askTeam(conversation, executionResult, customerLanguage, log, {
        processingStartedAt,
      });
      if (handled) break;
      executionResult = {
        ...executionResult,
        step: "HANDOFF",
        handoff: executionResult.handoff ?? {
          reason: executionResult.handoffReason ?? "The AI could not answer a fact",
        },
      };
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
      const toolExecResult1 = await toolExecutionService.handleToolExecution(
        conversation,
        executionResult.tool,
        toolMessageId?.id,
      );
      toolsCalledThisTurn.push({
        name: executionResult.tool.name,
        success: toolExecResult1.success,
        pending: toolExecResult1.pending,
      });
      await maybeEmitProductRecommendation(
        conversation,
        executionResult.tool.name,
        toolExecResult1,
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
      const toolExecResult2 = await toolExecutionService.handleToolExecution(
        conversation,
        executionResult.tool,
        toolMessageId?.id,
      );
      toolsCalledThisTurn.push({
        name: executionResult.tool.name,
        success: toolExecResult2.success,
        pending: toolExecResult2.pending,
      });
      await maybeEmitProductRecommendation(
        conversation,
        executionResult.tool.name,
        toolExecResult2,
      );

      // The tool execution service now updates the message internally
      // Continue the loop to let LLM analyze the result
    } else if (executionResult.step === "ASK_FORM" && executionResult.form) {
      // Emit a FORM message in PENDING state and pause the orchestrator loop.
      // The conversation resumes when the customer submits the form via the
      // submitForm endpoint, which mutates this message to SUBMITTED, writes
      // the response into conversation.context, and re-invokes run().
      await conversation.addMessage({
        content: "",
        type: MessageType.FORM,
        metadata: {
          ui: {
            kind: "form",
            schema: executionResult.form as unknown as Record<string, unknown>,
            status: "PENDING",
          },
        },
      });
      log.debug(
        { schemaId: executionResult.form.id },
        "Emitted ASK_FORM message; pausing orchestrator until submission",
      );
      break;
    } else if (executionResult.step === "HANDOFF") {
      // Handle human handoff
      log.debug(
        {
          confidenceRelated: !!executionResult.confidence,
          confidenceScore: executionResult.confidence?.score,
        },
        "HANDOFF step detected",
      );

      // The planner handed off again while following the merchant's hand-off
      // instructions. Re-planning only repeats it (it looped to the iteration cap
      // and the shopper got no reply), so send the fixed line once and stop.
      if (handoffProcessed) {
        log.debug("Handoff already processed, sending the fixed line and ending");
        if (deferredHandoffLine) {
          await sendBotMessage(conversation, deferredHandoffLine, log, processingStartedAt);
        }
        break;
      }

      handoffProcessed = true; // Mark as processed

      // Save confidence log if this is a confidence-related handoff
      await saveConfidenceLog(conversation, executionResult);

      // Generate the handoff summary for the human agent (fire-and-forget)
      import("./conversation-utils").then(({ generateHandoffSummary }) => {
        generateHandoffSummary(conversation.id, conversation.organization_id, true).catch(
          (error) => {
            log.error({ err: error }, "Error generating handoff summary");
          },
        );
      });

      // A planned hand-off: the active playbook prescribes a "Handoff to human"
      // step, and this isn't a guardrail/outage fallback. Recorded so the close
      // classifier bills it as `assisted` rather than the fallback `human`.
      const plannedHandoff =
        conversation.metadata?.playbookPrescribesHandoff === true &&
        !executionResult.confidence &&
        !executionResult.aiUnavailable;

      // Every hand-off queues the conversation for the team.
      await conversationRepository.update(conversation.id, conversation.organization_id, {
        status: "pending-human",
        ...(plannedHandoff
          ? { metadata: { ...(conversation.metadata ?? {}), plannedHandoff: true } }
          : {}),
      });
      if (plannedHandoff) {
        conversation.metadata = { ...(conversation.metadata ?? {}), plannedHandoff: true };
      }
      await publishStatusChange(
        conversation.organization_id,
        conversation.id,
        "pending-human",
        conversation.title,
      );

      const agent = conversation.agent_id
        ? await agentRepository.findById(conversation.agent_id)
        : null;
      // Business hours + who is reachable on this channel (D5-7): open (someone
      // reachable), open_nobody_online (team alerted) or closed (back at the
      // next opening; the AI keeps answering, only the human queue waits).
      const now = new Date();
      const scope = { organizationId: conversation.organization_id, channel: conversation.channel };
      const availability = await getAvailability(scope, now);
      const handoffAvailability = {
        ...availability,
        typicalReplyMinutes:
          availability.state === "open_nobody_online"
            ? await typicalFirstReplyMinutes(scope, now)
            : null,
      };
      const handoffType = availability.state === "open" ? "available" : "unavailable";
      log.debug({ hasAgent: !!agent, availability: availability.state }, "Handing off to the team");

      // The merchant's own hand-off instructions for this situation, if any,
      // are run through the planner on the next iteration, with the facts.
      const customInstructions =
        handoffType === "available"
          ? agent?.human_handoff_available_instructions
          : agent?.human_handoff_unavailable_instructions;
      const handoffLine: Parameters<typeof sendBotMessage>[1] = {
        content: availabilityHandoffLine(
          handoffAvailability,
          now,
          customerLanguage,
          conversation.language,
          conversation.organization?.defaultLanguage,
        ),
        type: MessageType.BOT_AGENT,
        metadata: buildMessageMetadata(executionResult, {
          isHandoffMessage: true,
          handoffType,
          ...(executionResult.aiUnavailable ? { aiUnavailable: true } : {}),
          availability: {
            state: availability.state,
            nextOpening: availability.nextOpening?.toISOString() ?? null,
            timezone: availability.timezone,
          },
          ...(executionResult.userMessage
            ? { discardedHandoffMessage: executionResult.userMessage }
            : {}),
        }),
      };

      // "When no one is available → create a ticket": the planner gets a way to
      // reply from the customer and raises the ticket (create_ticket); the turn
      // then closes the conversation instead of leaving it in the queue. Like
      // custom instructions, it needs the AI, so not when it is unavailable.
      const ticketConfig =
        handoffType === "unavailable" ? agent?.human_handoff_unavailable_ticket : null;
      if (
        ticketConfig &&
        !executionResult.aiUnavailable &&
        (await handoffTicketsService.isProvider(
          conversation.organization_id,
          ticketConfig.pluginId,
        ))
      ) {
        log.debug({ pluginId: ticketConfig.pluginId }, "Hand-off raises a ticket");
        const ticketState = await requestHandoffTicket(conversation, ticketConfig.pluginId);
        await conversation.addMessage({
          content: ticketHandoffInstructions(
            availabilityContext(handoffAvailability, now),
            ticketState,
          ),
          type: MessageType.SYSTEM,
          metadata: { isHandoffInstructions: true, handoffType, handoffTicket: true },
        });
        deferredHandoffLine = handoffLine;
        continue;
      }

      // Custom instructions run through the planner again, which is exactly what
      // just failed when the AI is unavailable; use the fixed line instead.
      if (hasTiptapContent(customInstructions) && !executionResult.aiUnavailable) {
        log.debug({ handoffType }, "Executing custom handoff instructions");
        await conversation.addHandoffInstructions(
          customInstructions,
          handoffType,
          availabilityContext(handoffAvailability, now),
        );
        deferredHandoffLine = handoffLine;
        continue;
      }

      // Otherwise the shopper gets a fixed, honest line. The planner's or a
      // guardrail's own hand-off text is not sent: models keep promising speed
      // ("please hold on for a moment", "right away") that nobody can keep.
      // It is kept in metadata for review.
      await sendBotMessage(conversation, handoffLine, log, processingStartedAt);
      break;
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

  // The hand-off raised its ticket this turn: the team follows up in the
  // helpdesk, so the conversation leaves the queue.
  await handoffTicketsService
    .closeIfRaised(conversation.id, conversation.organization_id)
    .catch((error) => log.error({ err: error }, "Failed to close after raising a ticket"));
}

/**
 * ASK_TEAM (D19): ask the team, send the fixed line, alert the team. Returns
 * false when the quick check is not allowed, so the caller hands off instead.
 * Nobody reachable (or outside business hours) still stores the question for
 * the team, and the chat joins the team queue at once with an honest line.
 */
async function askTeam(
  conversation: Conversation,
  executionResult: ExecutionResult,
  customerLanguage: string | undefined,
  log: pino.Logger,
  timing: { processingStartedAt: number },
): Promise<boolean> {
  const { teamQuestionService } =
    await import("@server/services/team-questions/team-question.service");
  const lastCustomerMessage = await conversation.getLastCustomerMessage();
  const asked = await teamQuestionService.ask(conversation, {
    question: executionResult.teamQuestion ?? "",
    customerMessage: lastCustomerMessage?.content ?? null,
    language: customerLanguage ?? null,
  });
  if (asked.kind === "refused") return false;

  log.info({ questionId: asked.question.id, outcome: asked.kind }, "Quick check with the team");
  await saveConfidenceLog(conversation, executionResult);
  if (asked.kind === "offline") {
    await teamQuestionService.moveToTeamQueue(conversation.id, asked.question.id);
  }
  await sendBotMessage(
    conversation,
    {
      content: asked.line,
      type: MessageType.BOT_AGENT,
      metadata: buildMessageMetadata(executionResult, {
        isTeamQuestionMessage: true,
        teamQuestionId: asked.question.id,
        quickCheckStep: asked.kind,
        ...(asked.kind === "offline" ? { isHandoffMessage: true } : {}),
        ...(executionResult.userMessage
          ? { discardedHandoffMessage: executionResult.userMessage }
          : {}),
      }),
    },
    log,
    timing.processingStartedAt,
  );
  // Ask the people: push + email with the answer link. A question that went
  // straight to the queue already raised the hand-off push.
  if (asked.kind !== "appended") {
    void teamQuestionService.notifyTeam(conversation, asked.question, {
      push: asked.kind === "asked",
    });
  }
  return true;
}

/**
 * After `recommend_products` returns, emit a dedicated PRODUCT_RECOMMENDATION
 * message so webchat + dashboard can render the cards. The TOOL message stays
 * as-is for transparency; the rich payload lives in this separate message's
 * metadata so renderers can branch on `message.type === "ProductRecommendation"`
 * without parsing tool outputs.
 */
async function maybeEmitProductRecommendation(
  conversation: Conversation,
  toolName: string,
  result: { success: boolean; result?: unknown } | undefined,
): Promise<void> {
  if (toolName !== "recommend_products") return;
  if (!result?.success) return;
  const payload = result.result as
    | {
        products?: Array<Record<string, unknown>>;
        query?: string;
        filtersApplied?: Record<string, unknown>;
      }
    | undefined;
  if (!payload || !Array.isArray(payload.products) || payload.products.length === 0) {
    return;
  }

  // Product cards are shopper-visible too.
  await assertAiMayReply(conversation);
  await conversation.addMessage({
    content: `Recommending ${payload.products.length} product${payload.products.length === 1 ? "" : "s"}`,
    type: MessageType.PRODUCT_RECOMMENDATION,
    metadata: {
      productRecommendation: {
        query: payload.query,
        filtersApplied: payload.filtersApplied,
        products: payload.products,
      },
    },
  });
}
