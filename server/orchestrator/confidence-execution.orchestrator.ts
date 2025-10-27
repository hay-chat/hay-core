import { ExecutionLayer, ExecutionResult } from "./execution.layer";
import { RetrievalLayer } from "./retrieval.layer";
import { Conversation } from "@server/database/entities/conversation.entity";
import { documentRepository } from "@server/repositories/document.repository";
import { organizationRepository } from "@server/repositories/organization.repository";
import { agentRepository } from "@server/repositories/agent.repository";
import {
  ConfidenceGuardrailService,
  ConfidenceAssessment,
  ConfidenceContext,
} from "@server/services/core/confidence-guardrail.service";
import { debugLog } from "@server/lib/debug-logger";
import { MessageType } from "@server/database/entities/message.entity";

/**
 * Enhanced execution result with confidence information
 */
export interface ConfidenceEnhancedExecutionResult extends ExecutionResult {
  confidence?: ConfidenceAssessment;
  recheckAttempted?: boolean;
  recheckCount?: number;
}

/**
 * Orchestrates execution with confidence guardrails.
 * This service wraps the ExecutionLayer and adds confidence checking,
 * recheck mechanisms, and escalation logic.
 */
export class ConfidenceExecutionOrchestrator {
  private executionLayer: ExecutionLayer;
  private retrievalLayer: RetrievalLayer;
  private confidenceService: ConfidenceGuardrailService;

  constructor() {
    this.executionLayer = new ExecutionLayer();
    this.retrievalLayer = new RetrievalLayer();
    this.confidenceService = new ConfidenceGuardrailService();
  }

  /**
   * Execute with confidence guardrails
   * Returns enhanced execution result with confidence information
   */
  async executeWithConfidence(
    conversation: Conversation,
    customerLanguage?: string,
  ): Promise<ConfidenceEnhancedExecutionResult | null> {
    debugLog("confidence-orchestrator", "Starting execution with confidence guardrails", {
      conversationId: conversation.id,
      organizationId: conversation.organization_id,
      agentId: conversation.agent_id,
    });

    // Get first execution result
    const executionResult = await this.executionLayer.execute(conversation, customerLanguage);

    if (!executionResult) {
      debugLog("confidence-orchestrator", "No execution result returned");
      return null;
    }

    // Only apply confidence checking to RESPOND steps
    // Tool calls, handoffs, and closes don't need confidence checking
    if (executionResult.step !== "RESPOND" || !executionResult.userMessage) {
      debugLog("confidence-orchestrator", "Skipping confidence check for non-RESPOND step", {
        step: executionResult.step,
      });
      return executionResult;
    }

    debugLog("confidence-orchestrator", "Assessing confidence for RESPOND step");

    // Perform confidence assessment
    const confidenceAssessment = await this.assessResponseConfidence(
      conversation,
      executionResult.userMessage,
    );

    // Enhanced result with confidence
    const enhancedResult: ConfidenceEnhancedExecutionResult = {
      ...executionResult,
      confidence: confidenceAssessment,
      recheckAttempted: false,
      recheckCount: 0,
    };

    debugLog("confidence-orchestrator", "Confidence assessment complete", {
      score: confidenceAssessment.score,
      tier: confidenceAssessment.tier,
      shouldRecheck: confidenceAssessment.shouldRecheck,
      shouldEscalate: confidenceAssessment.shouldEscalate,
    });

    // Handle medium confidence - trigger recheck
    if (confidenceAssessment.shouldRecheck) {
      debugLog("confidence-orchestrator", "Medium confidence detected, triggering recheck");

      const recheckResult = await this.performRecheck(
        conversation,
        customerLanguage,
        confidenceAssessment,
      );

      if (recheckResult) {
        enhancedResult.userMessage = recheckResult.userMessage;
        enhancedResult.confidence = recheckResult.confidence;
        enhancedResult.recheckAttempted = true;
        enhancedResult.recheckCount = 1;

        debugLog("confidence-orchestrator", "Recheck complete", {
          newScore: recheckResult.confidence?.score,
          newTier: recheckResult.confidence?.tier,
        });
      }
    }

    // Handle low confidence - escalate or fallback
    if (
      enhancedResult.confidence?.shouldEscalate ||
      (enhancedResult.recheckAttempted && enhancedResult.confidence!.tier === "low")
    ) {
      debugLog(
        "confidence-orchestrator",
        "Low confidence detected after recheck, applying fallback/escalation",
      );

      // Get fallback message from config and translate it
      const config = await this.getConfidenceConfig(conversation);
      const fallbackMessage = await this.getTranslatedFallbackMessage(
        conversation,
        config.fallbackMessage,
        customerLanguage,
      );

      // If escalation is enabled, change the step to HANDOFF
      if (config.enableEscalation) {
        debugLog("confidence-orchestrator", "Escalation enabled, converting to HANDOFF");
        return {
          step: "HANDOFF",
          userMessage: fallbackMessage,
          handoff: {
            reason: "Low confidence in AI response",
            fields: {
              confidenceScore: enhancedResult.confidence.score,
              confidenceTier: enhancedResult.confidence.tier,
            },
          },
          confidence: enhancedResult.confidence,
          recheckAttempted: enhancedResult.recheckAttempted,
          recheckCount: enhancedResult.recheckCount,
        };
      } else {
        // Just use fallback message
        debugLog("confidence-orchestrator", "Using fallback message");
        enhancedResult.userMessage = fallbackMessage;
      }
    }

    return enhancedResult;
  }

  /**
   * Assess confidence in a response
   */
  private async assessResponseConfidence(
    conversation: Conversation,
    response: string,
  ): Promise<ConfidenceAssessment> {
    // Get retrieved documents with full content
    const retrievedDocs = await this.getRetrievedDocumentsWithContent(conversation);

    // Get last customer message
    const lastCustomerMessage = await conversation.getLastCustomerMessage();
    if (!lastCustomerMessage) {
      throw new Error("No customer message found for confidence assessment");
    }

    // Get conversation history
    const conversationHistory = await conversation.getMessages();

    // Build confidence context
    const context: ConfidenceContext = {
      response,
      retrievedDocuments: retrievedDocs,
      conversationHistory,
      customerQuery: lastCustomerMessage.content,
    };

    // Get configuration
    const config = await this.getConfidenceConfig(conversation);

    // Perform confidence assessment
    return await this.confidenceService.assessConfidence(context, config);
  }

  /**
   * Perform recheck with alternate retrieval strategy
   */
  private async performRecheck(
    conversation: Conversation,
    customerLanguage?: string,
    previousAssessment?: ConfidenceAssessment,
  ): Promise<ConfidenceEnhancedExecutionResult | null> {
    debugLog("confidence-orchestrator", "Performing recheck with alternate strategy");

    try {
      // Strategy 1: Retrieve more documents with lower threshold
      const messages = await conversation.getPublicMessages();

      // Use custom retrieval with relaxed parameters
      const moreDocuments = await this.retrieveWithRelaxedThreshold(
        messages,
        conversation.organization_id,
        conversation,
      );

      // Attach new documents to conversation temporarily (for this execution only)
      // We won't persist them unless the recheck succeeds
      const originalDocIds = conversation.document_ids || [];

      // Add new documents to conversation context
      for (const doc of moreDocuments) {
        if (!originalDocIds.includes(doc.id)) {
          debugLog("confidence-orchestrator", "Adding additional document for recheck", {
            documentId: doc.id,
            similarity: doc.similarity,
          });
          await conversation.addDocument(doc.id);
        }
      }

      // Re-execute with lower temperature for more deterministic response
      // TODO: This would require modifying ExecutionLayer to accept temperature parameter
      // For now, just re-execute normally
      const recheckResult = await this.executionLayer.execute(conversation, customerLanguage);

      if (!recheckResult || recheckResult.step !== "RESPOND" || !recheckResult.userMessage) {
        // Recheck failed, restore original documents
        if (conversation.document_ids) {
          conversation.document_ids = originalDocIds;
        }
        return null;
      }

      // Assess confidence again
      const recheckAssessment = await this.assessResponseConfidence(
        conversation,
        recheckResult.userMessage,
      );

      debugLog("confidence-orchestrator", "Recheck assessment complete", {
        previousScore: previousAssessment?.score,
        newScore: recheckAssessment.score,
        improved: recheckAssessment.score > (previousAssessment?.score || 0),
      });

      // If recheck improved confidence, keep the new response and documents
      if (recheckAssessment.score > (previousAssessment?.score || 0)) {
        debugLog("confidence-orchestrator", "Recheck improved confidence, keeping new response");
        return {
          ...recheckResult,
          confidence: recheckAssessment,
        };
      } else {
        // Recheck didn't improve, restore original documents
        debugLog("confidence-orchestrator", "Recheck did not improve confidence, reverting");
        if (conversation.document_ids) {
          conversation.document_ids = originalDocIds;
        }
        return null;
      }
    } catch (error) {
      debugLog("confidence-orchestrator", "Error during recheck", {
        level: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Retrieve documents with relaxed threshold (more documents, lower similarity requirement)
   */
  private async retrieveWithRelaxedThreshold(
    messages: any[],
    organizationId: string,
    conversation?: Conversation,
  ): Promise<Array<{ id: string; similarity: number }>> {
    try {
      // Get configuration for recheck parameters
      const config = conversation ? await this.getConfidenceConfig(conversation) : null;
      const maxDocuments = config?.recheckConfig?.maxDocuments || 10;
      const similarityThreshold = config?.recheckConfig?.similarityThreshold || 0.3;

      // Import vector store service
      const { vectorStoreService } = await import("@server/services/vector-store.service");

      // Get customer messages
      const customerMessages = messages.filter((msg) => msg.type === "Customer").slice(-3);

      if (customerMessages.length === 0) {
        return [];
      }

      const query = customerMessages
        .map((msg) => msg.content)
        .join(" ")
        .trim();

      if (!query) {
        return [];
      }

      if (!vectorStoreService.initialized) {
        await vectorStoreService.initialize();
      }

      // Retrieve documents using configured parameters
      debugLog("confidence-orchestrator", "Retrieving documents with relaxed threshold", {
        maxDocuments,
        similarityThreshold,
      });
      const searchResults = await vectorStoreService.search(organizationId, query, maxDocuments);

      if (!searchResults || searchResults.length === 0) {
        return [];
      }

      // Use configured similarity threshold
      const filteredResults = searchResults.filter(
        (result) => (result.similarity || 0) > similarityThreshold,
      );

      return filteredResults.map((result) => ({
        id: result.documentId,
        similarity: result.similarity || 0,
      }));
    } catch (error) {
      debugLog("confidence-orchestrator", "Error in relaxed retrieval", {
        level: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Get retrieved documents with full content
   */
  private async getRetrievedDocumentsWithContent(
    conversation: Conversation,
  ): Promise<Array<{ document: any; similarity: number }>> {
    if (!conversation.document_ids || conversation.document_ids.length === 0) {
      return [];
    }

    // Get document IDs from orchestration_status (which includes similarity scores)
    const orchestrationStatus = conversation.orchestration_status as any;
    const documentScores: Record<string, number> = {};

    // Extract similarity scores if available
    if (orchestrationStatus?.rag?.retrievedDocuments) {
      for (const doc of orchestrationStatus.rag.retrievedDocuments) {
        documentScores[doc.id] = doc.similarity || 0.5;
      }
    }

    // Fetch full document entities
    const documents = [];
    for (const docId of conversation.document_ids) {
      try {
        const doc = await documentRepository.findById(docId);
        if (doc) {
          documents.push({
            document: doc,
            similarity: documentScores[docId] || 0.5, // Default similarity if not available
          });
        }
      } catch (error) {
        debugLog("confidence-orchestrator", "Error fetching document", {
          level: "error",
          documentId: docId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return documents;
  }

  /**
   * Get confidence configuration from organization and agent settings
   */
  private async getConfidenceConfig(conversation: Conversation) {
    try {
      // Get organization
      const organization = await organizationRepository.findById(conversation.organization_id);

      // Get agent
      let agent = null;
      if (conversation.agent_id) {
        agent = await agentRepository.findById(conversation.agent_id);
      }

      // Merge configurations
      return ConfidenceGuardrailService.mergeConfig(
        organization?.settings as Record<string, unknown>,
        // TODO: Agent entity doesn't have a settings field yet, will need to add it
        // For now, just pass undefined
        undefined,
      );
    } catch (error) {
      debugLog("confidence-orchestrator", "Error loading confidence config, using defaults", {
        level: "warn",
        error: error instanceof Error ? error.message : String(error),
      });
      return ConfidenceGuardrailService.getDefaultConfig();
    }
  }

  /**
   * Translate fallback message to match conversation language
   */
  private async getTranslatedFallbackMessage(
    conversation: Conversation,
    fallbackMessage: string,
    customerLanguage?: string,
  ): Promise<string> {
    try {
      // If no customer language detected, use organization default
      const targetLanguage =
        customerLanguage || conversation.organization?.defaultLanguage || "en";

      // If already in English and target is English, return as-is
      if (targetLanguage === "en") {
        return fallbackMessage;
      }

      // Use LLM to translate the fallback message
      const { LLMService } = await import("@server/services/core/llm.service");
      const llmService = new LLMService();

      const translationPrompt = `Translate the following customer service message to ${targetLanguage}.
Keep the tone professional, empathetic, and appropriate for a customer service context.
Only return the translated text, nothing else.

Original message: "${fallbackMessage}"

Translated message:`;

      const translated = await llmService.invoke({
        prompt: translationPrompt,
      });

      return translated.trim();
    } catch (error) {
      debugLog("confidence-orchestrator", "Error translating fallback message, using original", {
        level: "warn",
        error: error instanceof Error ? error.message : String(error),
      });
      // If translation fails, return original message
      return fallbackMessage;
    }
  }

  /**
   * Save confidence log to orchestration_status
   */
  async saveConfidenceLog(
    conversation: Conversation,
    assessment: ConfidenceAssessment,
    recheckAttempted: boolean,
    recheckCount: number,
  ): Promise<void> {
    try {
      const orchestrationStatus = (conversation.orchestration_status as any) || {};

      // Initialize confidence log if not exists
      if (!orchestrationStatus.confidenceLog) {
        orchestrationStatus.confidenceLog = [];
      }

      // Add new confidence entry
      orchestrationStatus.confidenceLog.push({
        timestamp: new Date().toISOString(),
        score: assessment.score,
        tier: assessment.tier,
        breakdown: assessment.breakdown,
        documentsUsed: assessment.documentsUsed,
        recheckAttempted,
        recheckCount,
        details: assessment.details,
      });

      // Update conversation
      const { conversationRepository } = await import("@server/repositories/conversation.repository");
      await conversationRepository.updateById(conversation.id, {
        orchestration_status: orchestrationStatus,
      });

      debugLog("confidence-orchestrator", "Confidence log saved", {
        conversationId: conversation.id,
        logEntries: orchestrationStatus.confidenceLog.length,
      });
    } catch (error) {
      debugLog("confidence-orchestrator", "Error saving confidence log", {
        level: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
