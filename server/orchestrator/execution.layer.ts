import { LLMService } from "../services/core/llm.service";
import { Conversation } from "@server/database/entities/conversation.entity";
import { PromptService } from "../services/prompt.service";
import { debugLog } from "@server/lib/debug-logger";
import {
  ConfidenceGuardrailService,
  type ConfidenceAssessment,
} from "@server/services/core/confidence-guardrail.service";
import {
  CompanyInterestGuardrailService,
  type CompanyInterestAssessment,
} from "@server/services/core/company-interest-guardrail.service";
import { MessageIntent } from "@server/database/entities/message.entity";

export interface ExecutionResult {
  step: "ASK" | "RESPOND" | "CALL_TOOL" | "HANDOFF" | "CLOSE";
  userMessage?: string;
  tool?: {
    name: string;
    args: Record<string, unknown>;
  };
  handoff?: {
    reason: string;
    fields: Record<string, unknown>;
  };
  close?: {
    reason: string;
  };
  rationale?: string;
  // Guardrail fields
  companyInterest?: CompanyInterestAssessment; // Stage 1: Company interest protection
  confidence?: ConfidenceAssessment; // Stage 2: Fact grounding
  recheckAttempted?: boolean;
  recheckCount?: number;
  originalMessage?: string; // Original message before fallback replacement
}

export class ExecutionLayer {
  private llmService: LLMService;
  private promptService: PromptService;
  private companyInterestService: CompanyInterestGuardrailService;
  private confidenceService: ConfidenceGuardrailService;
  private plannerSchema: object;

  constructor() {
    this.llmService = new LLMService();
    this.promptService = PromptService.getInstance();
    this.companyInterestService = new CompanyInterestGuardrailService();
    this.confidenceService = new ConfidenceGuardrailService();
    debugLog("execution", "ExecutionLayer initialized");

    this.plannerSchema = {
      type: "object",
      properties: {
        step: {
          type: "string",
          enum: ["ASK", "RESPOND", "CALL_TOOL", "HANDOFF", "CLOSE"],
        },
        userMessage: {
          type: "string",
          description: "Message to send to user (REQUIRED for ASK and RESPOND steps)",
        },
        tool: {
          type: "object",
          properties: {
            name: { type: "string" },
            args: { type: "object" },
          },
          description: "Tool to call (for CALL_TOOL step)",
        },
        handoff: {
          type: "object",
          properties: {
            reason: { type: "string" },
            fields: { type: "object" },
          },
          description: "Handoff details (for HANDOFF step)",
        },
        close: {
          type: "object",
          properties: {
            reason: { type: "string" },
          },
          description: "Close reason (for CLOSE step)",
        },
        rationale: {
          type: "string",
          description: "Explanation of why this step was chosen",
        },
      },
      required: ["step", "rationale"],
      // Note: userMessage is conditionally required - validated after parsing
    };
  }

  async execute(
    conversation: Conversation,
    customerLanguage?: string,
  ): Promise<ExecutionResult | null> {
    try {
      debugLog("execution", "Starting execution for conversation", {
        conversationId: conversation.id,
        organizationId: conversation.organization_id,
        agentId: conversation.agent_id,
        playbookId: conversation.playbook_id,
        enabledTools: conversation.enabled_tools,
        customerLanguage,
      });

      const messages = await conversation.getMessages();

      // Get the prompt from PromptService
      const responsePrompt = await this.promptService.getPrompt(
        "execution/planner",
        {
          hasTools: conversation.enabled_tools && conversation.enabled_tools.length > 0,
          tools: conversation.enabled_tools?.join(", "),
        },
        { conversationId: conversation.id, organizationId: conversation.organization_id },
      );

      // Inject explicit language instruction if customer language is detected
      // Only enforce language for the first 3 customer messages
      let finalPrompt = responsePrompt;
      if (customerLanguage) {
        const customerMessages = messages.filter((msg) => msg.type === "Customer");
        const shouldEnforceLanguage = customerMessages.length <= 3;

        if (shouldEnforceLanguage) {
          const languageNames: Record<string, string> = {
            en: "English",
            pt: "Portuguese",
            es: "Spanish",
            de: "German",
            fr: "French",
            it: "Italian",
            nl: "Dutch",
            pl: "Polish",
            ru: "Russian",
            ja: "Japanese",
            zh: "Chinese",
            ko: "Korean",
            ar: "Arabic",
            hi: "Hindi",
          };
          const languageName = languageNames[customerLanguage] || customerLanguage.toUpperCase();
          const languageInstruction = `\n\nIMPORTANT LANGUAGE REQUIREMENT: The customer is communicating in ${languageName}. You MUST respond ONLY in ${languageName}, regardless of the language used in the prompts, instructions, or system messages. This is a critical requirement that overrides all other language-related instructions.`;
          finalPrompt = responsePrompt + languageInstruction;
        }
      }

      debugLog("execution", "Retrieved execution planner prompt", {
        promptLength: finalPrompt.length,
        hasTools: conversation.enabled_tools && conversation.enabled_tools.length > 0,
        tools: conversation.enabled_tools,
      });

      debugLog("execution", "Invoking LLM for execution planning");

      const response = await this.llmService.invoke({
        history: messages, // Pass Message[] directly instead of converting to string
        prompt: finalPrompt,
        jsonSchema: this.plannerSchema,
      });

      const result = JSON.parse(response) as ExecutionResult;

      // Validate that ASK and RESPOND steps have userMessage
      if ((result.step === "ASK" || result.step === "RESPOND") && !result.userMessage) {
        debugLog("execution", "Invalid response: ASK/RESPOND without userMessage", {
          level: "warn",
          step: result.step,
          rationale: result.rationale,
        });
        // Return null to trigger retry in orchestrator
        return null;
      }

      debugLog("execution", "Execution planning complete", {
        step: result.step,
        hasUserMessage: !!result.userMessage,
        userMessagePreview: result.userMessage?.substring(0, 100),
        hasTool: !!result.tool,
        toolName: result.tool?.name,
        hasHandoff: !!result.handoff,
        hasClose: !!result.close,
        rationale: result.rationale,
      });

      // Apply confidence guardrails to RESPOND steps
      if (result.step === "RESPOND" && result.userMessage) {
        return await this.applyConfidenceGuardrails(result, conversation, customerLanguage);
      }

      return result;
    } catch (error) {
      debugLog("execution", "Error in execution layer", {
        level: "error",
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      console.error("[ExecutionLayer] Error generating response:", error);
      return {
        step: "RESPOND",
        userMessage:
          "I apologize, but I encountered an error while processing your request. Please try again.",
      };
    }
  }

  /**
   * Apply two-stage guardrails to execution result
   * Stage 1: Company Interest Protection (blocks harmful responses)
   * Stage 2: Fact Grounding (verifies company claims if needed)
   */
  private async applyConfidenceGuardrails(
    result: ExecutionResult,
    conversation: Conversation,
    customerLanguage?: string,
  ): Promise<ExecutionResult> {
    debugLog("execution", "Applying two-stage guardrails to RESPOND step");

    // Check if we should skip guardrail checks based on user intent
    const lastCustomerMessage = await conversation.getLastCustomerMessage();
    if (lastCustomerMessage?.intent) {
      const intent = lastCustomerMessage.intent as MessageIntent;

      // Skip guardrails for conversational intents that don't need checks
      const exemptIntents: MessageIntent[] = [
        MessageIntent.GREET,
        MessageIntent.CLOSE_SATISFIED,
        MessageIntent.CLOSE_UNSATISFIED,
      ];

      if (exemptIntents.includes(intent)) {
        debugLog("execution", "Skipping guardrails - conversational intent detected", {
          intent: lastCustomerMessage.intent,
          messageContent: lastCustomerMessage.content,
        });
        return result;
      }
    }

    // STAGE 1: Company Interest Protection
    debugLog("execution", "Stage 1: Assessing company interest");
    const companyInterestAssessment = await this.assessCompanyInterest(
      conversation,
      result.userMessage!,
    );

    result.companyInterest = companyInterestAssessment;

    debugLog("execution", "Company interest assessment complete", {
      passed: companyInterestAssessment.passed,
      violationType: companyInterestAssessment.violationType,
      severity: companyInterestAssessment.severity,
      shouldBlock: companyInterestAssessment.shouldBlock,
      requiresFactCheck: companyInterestAssessment.requiresFactCheck,
    });

    // If Stage 1 blocks response, escalate immediately
    if (companyInterestAssessment.shouldBlock) {
      debugLog("execution", "Stage 1 BLOCKED: Response violates company interests", {
        violationType: companyInterestAssessment.violationType,
        reasoning: companyInterestAssessment.reasoning,
      });

      const config = await this.getConfidenceConfig(conversation);
      const fallbackMessage = await this.getTranslatedFallbackMessage(
        conversation,
        config.fallbackMessage,
        customerLanguage,
      );

      const originalMessage = result.userMessage;

      // Always escalate for company interest violations
      return {
        step: "HANDOFF",
        userMessage: fallbackMessage,
        handoff: {
          reason: `Company interest violation: ${companyInterestAssessment.violationType}`,
          fields: {
            violationType: companyInterestAssessment.violationType,
            severity: companyInterestAssessment.severity,
          },
        },
        companyInterest: companyInterestAssessment,
        originalMessage,
      };
    }

    // STAGE 2: Fact Grounding (only if Stage 1 requires it)
    if (companyInterestAssessment.requiresFactCheck) {
      debugLog("execution", "Stage 2: Assessing fact grounding (company claims detected)");

      const confidenceAssessment = await this.assessResponseConfidence(
        conversation,
        result.userMessage!,
      );

      result.confidence = confidenceAssessment;
      result.recheckAttempted = false;
      result.recheckCount = 0;

      debugLog("execution", "Fact grounding assessment complete", {
        score: confidenceAssessment.score,
        tier: confidenceAssessment.tier,
        shouldRecheck: confidenceAssessment.shouldRecheck,
        shouldEscalate: confidenceAssessment.shouldEscalate,
      });

      // Handle medium confidence - trigger recheck
      if (confidenceAssessment.shouldRecheck) {
        debugLog("execution", "Medium confidence detected, triggering recheck");

        const recheckResult = await this.performRecheck(result, conversation, customerLanguage);

        if (recheckResult) {
          result.userMessage = recheckResult.userMessage;
          result.confidence = recheckResult.confidence;
          result.recheckAttempted = true;
          result.recheckCount = 1;

          debugLog("execution", "Recheck complete", {
            newScore: recheckResult.confidence?.score,
            newTier: recheckResult.confidence?.tier,
          });
        }
      }

      // Handle low confidence - escalate or fallback
      if (
        result.confidence?.shouldEscalate ||
        (result.recheckAttempted && result.confidence!.tier === "low")
      ) {
        debugLog("execution", "Stage 2: Low confidence detected, applying fallback/escalation");

        const config = await this.getConfidenceConfig(conversation);
        const fallbackMessage = await this.getTranslatedFallbackMessage(
          conversation,
          config.fallbackMessage,
          customerLanguage,
        );

        const originalMessage = result.userMessage;

        // If escalation is enabled, convert to HANDOFF
        if (config.enableEscalation) {
          debugLog("execution", "Escalation enabled, converting to HANDOFF");
          return {
            step: "HANDOFF",
            userMessage: fallbackMessage,
            handoff: {
              reason: "Low confidence in AI response - unverified company claims",
              fields: {
                confidenceScore: result.confidence?.score,
                confidenceTier: result.confidence?.tier,
              },
            },
            companyInterest: companyInterestAssessment,
            confidence: result.confidence,
            recheckAttempted: result.recheckAttempted,
            recheckCount: result.recheckCount,
            originalMessage,
          };
        } else {
          // Just use fallback message
          debugLog("execution", "Using fallback message");
          result.originalMessage = originalMessage;
          result.userMessage = fallbackMessage;
        }
      }
    } else {
      debugLog("execution", "Stage 2 SKIPPED: No fact checking required (no company claims)");
    }

    return result;
  }

  /**
   * Stage 1: Assess if response serves company interests
   */
  private async assessCompanyInterest(
    conversation: Conversation,
    response: string,
  ): Promise<CompanyInterestAssessment> {
    const conversationHistory = await conversation.getMessages();
    const lastCustomerMessage = await conversation.getLastCustomerMessage();

    if (!lastCustomerMessage) {
      throw new Error("No customer message found for company interest assessment");
    }

    // Check if we have retrieved documents or tool results
    const hasRetrievedDocuments = !!(
      conversation.document_ids && conversation.document_ids.length > 0
    );
    const recentToolMessages = conversationHistory.filter((msg) => msg.type === "Tool").slice(-3);
    const hasToolResults = recentToolMessages.length > 0;

    // Build company interest context
    const context = {
      response,
      customerQuery: lastCustomerMessage.content,
      conversationHistory,
      companyDomain: conversation.organization?.settings?.companyDomain as string | undefined,
      hasRetrievedDocuments,
      hasToolResults,
    };

    // Get configuration
    const config = await this.getCompanyInterestConfig(conversation);

    // Perform company interest assessment
    return await this.companyInterestService.assessCompanyInterest(context, config);
  }

  /**
   * Stage 2: Assess confidence in a response (fact grounding)
   */
  private async assessResponseConfidence(
    conversation: Conversation,
    response: string,
  ): Promise<ConfidenceAssessment> {
    const { documentRepository } = await import("@server/repositories/document.repository");

    // Get conversation history first to check for tool results
    const conversationHistory = await conversation.getMessages();

    // Check if there are recent tool call results
    const recentToolMessages = conversationHistory.filter((msg) => msg.type === "Tool").slice(-3); // Get last 3 tool messages

    // Get retrieved documents with full content
    const retrievedDocs: Array<{ document: any; similarity: number }> = [];
    if (conversation.document_ids && conversation.document_ids.length > 0) {
      const orchestrationStatus = conversation.orchestration_status as any;
      const documentScores: Record<string, number> = {};

      // Extract similarity scores if available
      if (orchestrationStatus?.rag?.retrievedDocuments) {
        for (const doc of orchestrationStatus.rag.retrievedDocuments) {
          documentScores[doc.id] = doc.similarity || 0.5;
        }
      }

      // Fetch full document entities
      for (const docId of conversation.document_ids) {
        try {
          const doc = await documentRepository.findById(docId);
          if (doc) {
            retrievedDocs.push({
              document: doc,
              similarity: documentScores[docId] || 0.5,
            });
          }
        } catch (error) {
          debugLog("execution", "Error fetching document for confidence assessment", {
            level: "error",
            documentId: docId,
          });
        }
      }
    }

    // Add tool results as synthetic documents with high similarity (they're authoritative)
    if (recentToolMessages.length > 0) {
      debugLog("execution", "Including tool results in confidence assessment", {
        toolMessageCount: recentToolMessages.length,
        toolNames: recentToolMessages.map((msg) => msg.metadata?.toolName || "Unknown"),
      });
    }

    for (const toolMsg of recentToolMessages) {
      // Extract tool output from metadata - this contains the actual JSON data
      let toolContent = toolMsg.content; // Fallback to content

      if (toolMsg.metadata?.toolOutput) {
        const toolOutput = toolMsg.metadata.toolOutput;

        // Format tool output for readability
        if (typeof toolOutput === "object" && toolOutput !== null) {
          // If it's MCP format with content array, extract the text
          if ("content" in toolOutput && Array.isArray(toolOutput.content)) {
            const mcpContent = toolOutput.content as Array<{ text?: string; type?: string }>;
            if (mcpContent.length > 0 && mcpContent[0].text) {
              toolContent = mcpContent[0].text;
            } else {
              toolContent = JSON.stringify(toolOutput, null, 2);
            }
          } else {
            toolContent = JSON.stringify(toolOutput, null, 2);
          }
        } else {
          toolContent = String(toolOutput);
        }
      }

      retrievedDocs.push({
        document: {
          id: `tool-result-${toolMsg.id}`,
          title: `Tool Result: ${toolMsg.metadata?.toolName || "Unknown Tool"}`,
          content: toolContent,
          type: "tool-result",
        },
        similarity: 0.95, // High similarity since tool results are authoritative
      });
    }

    // Get last customer message
    const lastCustomerMessage = await conversation.getLastCustomerMessage();
    if (!lastCustomerMessage) {
      throw new Error("No customer message found for confidence assessment");
    }

    // Build confidence context
    const context = {
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
    originalResult: ExecutionResult,
    conversation: Conversation,
    customerLanguage?: string,
  ): Promise<{ userMessage: string; confidence?: ConfidenceAssessment } | null> {
    debugLog("execution", "Performing recheck with alternate strategy");

    try {
      // Get more documents with relaxed threshold
      const messages = await conversation.getPublicMessages();
      const moreDocuments = await this.retrieveWithRelaxedThreshold(
        messages,
        conversation.organization_id,
        conversation,
      );

      // Store original document IDs
      const originalDocIds = conversation.document_ids || [];

      // Add new documents temporarily
      for (const doc of moreDocuments) {
        if (!originalDocIds.includes(doc.id)) {
          debugLog("execution", "Adding additional document for recheck", {
            documentId: doc.id,
            similarity: doc.similarity,
          });
          await conversation.addDocument(doc.id);
        }
      }

      // Re-execute with new documents
      const recheckResult = await this.execute(conversation, customerLanguage);

      if (!recheckResult || recheckResult.step !== "RESPOND" || !recheckResult.userMessage) {
        // Recheck failed, restore original documents
        conversation.document_ids = originalDocIds;
        return null;
      }

      // Assess confidence again (it will already be in recheckResult if this was called recursively)
      // To prevent infinite recursion, we need to assess without triggering another recheck
      const recheckAssessment =
        recheckResult.confidence ||
        (await this.assessResponseConfidence(conversation, recheckResult.userMessage));

      debugLog("execution", "Recheck assessment complete", {
        newScore: recheckAssessment.score,
        improved: recheckAssessment.score > (originalResult.confidence?.score || 0),
      });

      // If recheck improved confidence, keep the new response and documents
      if (recheckAssessment.score > (originalResult.confidence?.score || 0)) {
        debugLog("execution", "Recheck improved confidence, keeping new response");
        return {
          userMessage: recheckResult.userMessage,
          confidence: recheckAssessment,
        };
      } else {
        // Recheck didn't improve, restore original documents
        debugLog("execution", "Recheck did not improve confidence, reverting");
        conversation.document_ids = originalDocIds;
        return null;
      }
    } catch (error) {
      debugLog("execution", "Error during recheck", {
        level: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Retrieve documents with relaxed threshold
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

      debugLog("execution", "Retrieving documents with relaxed threshold", {
        maxDocuments,
        similarityThreshold,
      });

      const searchResults = await vectorStoreService.search(organizationId, query, maxDocuments);
      if (!searchResults || searchResults.length === 0) {
        return [];
      }

      const filteredResults = searchResults.filter(
        (result) => (result.similarity || 0) > similarityThreshold,
      );

      return filteredResults.map((result) => ({
        id: result.documentId,
        similarity: result.similarity || 0,
      }));
    } catch (error) {
      debugLog("execution", "Error in relaxed retrieval", {
        level: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Get company interest guardrail configuration
   */
  private async getCompanyInterestConfig(conversation: Conversation) {
    try {
      const { organizationRepository } = await import(
        "@server/repositories/organization.repository"
      );
      const organization = await organizationRepository.findById(conversation.organization_id);

      return CompanyInterestGuardrailService.mergeConfig(
        organization?.settings as Record<string, unknown>,
        undefined,
      );
    } catch (error) {
      debugLog("execution", "Error loading company interest config, using defaults", {
        level: "warn",
        error: error instanceof Error ? error.message : String(error),
      });
      return CompanyInterestGuardrailService.getDefaultConfig();
    }
  }

  /**
   * Get confidence configuration
   */
  private async getConfidenceConfig(conversation: Conversation) {
    try {
      const { organizationRepository } = await import(
        "@server/repositories/organization.repository"
      );
      const organization = await organizationRepository.findById(conversation.organization_id);

      return ConfidenceGuardrailService.mergeConfig(
        organization?.settings as Record<string, unknown>,
        undefined,
      );
    } catch (error) {
      debugLog("execution", "Error loading confidence config, using defaults", {
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
      const targetLanguage = customerLanguage || conversation.organization?.defaultLanguage || "en";

      if (targetLanguage === "en") {
        return fallbackMessage;
      }

      const translationPrompt = `Translate the following customer service message to ${targetLanguage}.
Keep the tone professional, empathetic, and appropriate for a customer service context.
Only return the translated text, nothing else.

Original message: "${fallbackMessage}"

Translated message:`;

      const translated = await this.llmService.invoke({
        prompt: translationPrompt,
      });

      return translated.trim();
    } catch (error) {
      debugLog("execution", "Error translating fallback message, using original", {
        level: "warn",
        error: error instanceof Error ? error.message : String(error),
      });
      return fallbackMessage;
    }
  }
}
