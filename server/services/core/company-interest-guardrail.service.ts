import { LLMService } from "./llm.service";
import { PromptService } from "../prompt.service";
import { Message } from "@server/database/entities/message.entity";

/**
 * Types of violations that harm company interests
 */
export enum ViolationType {
  OFF_TOPIC = "off_topic", // Response is completely irrelevant to company's domain
  COMPETITOR_INFO = "competitor_info", // Providing generic competitor information
  FABRICATED_PRODUCT = "fabricated_product", // Making up products/features not in catalog
  FABRICATED_POLICY = "fabricated_policy", // Making up company policies not in documents
  NONE = "none", // No violation detected
}

/**
 * Result of company interest evaluation
 */
export interface CompanyInterestAssessment {
  passed: boolean; // Whether response passes company interest check
  violationType: ViolationType;
  severity: "critical" | "moderate" | "low" | "none"; // How serious the violation is
  reasoning: string; // Explanation of the decision
  shouldBlock: boolean; // Whether response should be blocked
  requiresFactCheck: boolean; // Whether Stage 2 fact grounding is needed
}

/**
 * Configuration for company interest guardrail
 */
export interface CompanyInterestConfig {
  enabled: boolean; // Default: true
  blockOffTopic: boolean; // Default: true
  blockCompetitorInfo: boolean; // Default: true
  blockFabrications: boolean; // Default: true
  allowClarifications: boolean; // Allow AI to clarify its own terms/questions (Default: true)
}

/**
 * Context for company interest evaluation
 */
export interface CompanyInterestContext {
  response: string; // The AI response to evaluate
  customerQuery: string; // The original customer question
  conversationHistory: Message[]; // Full conversation context
  companyDomain?: string; // Optional: Company's business domain/industry
  hasRetrievedDocuments: boolean; // Whether any documents were retrieved
  hasToolResults: boolean; // Whether response is based on tool results
}

/**
 * Stage 1 Guardrail: Company Interest Protection
 *
 * Prevents responses that harm company interests by:
 * - Blocking off-topic conversations (weather, unrelated topics)
 * - Blocking generic competitor information
 * - Blocking fabricated products/features/policies
 * - Allowing helpful clarifications and on-topic assistance
 *
 * This is the PRIMARY guardrail - if it fails, response is blocked.
 * If it passes, response may proceed to Stage 2 (fact grounding) if needed.
 */
export class CompanyInterestGuardrailService {
  private llmService: LLMService;
  private promptService: PromptService;

  // Default configuration
  private static readonly DEFAULT_CONFIG: CompanyInterestConfig = {
    enabled: true,
    blockOffTopic: true,
    blockCompetitorInfo: true,
    blockFabrications: true,
    allowClarifications: true,
  };

  constructor() {
    this.llmService = new LLMService();
    this.promptService = PromptService.getInstance();
  }

  /**
   * Main method to assess if response serves company interests
   */
  async assessCompanyInterest(
    context: CompanyInterestContext,
    config?: Partial<CompanyInterestConfig>,
  ): Promise<CompanyInterestAssessment> {
    const fullConfig = { ...CompanyInterestGuardrailService.DEFAULT_CONFIG, ...config };

    if (!fullConfig.enabled) {
      return this.createPassingAssessment();
    }

    // Get prompt from PromptService
    const evaluationPrompt = await this.promptService.getPrompt(
      "execution/company-interest-check",
      {
        response: context.response,
        customerQuery: context.customerQuery,
        conversationHistory: this.formatConversationHistory(context.conversationHistory),
        companyDomain: context.companyDomain || "not specified",
        hasRetrievedDocuments: context.hasRetrievedDocuments,
        hasToolResults: context.hasToolResults,
        allowClarifications: fullConfig.allowClarifications,
      },
    );

    try {
      const schema = {
        type: "object",
        properties: {
          violationType: {
            type: "string",
            enum: [
              "off_topic",
              "competitor_info",
              "fabricated_product",
              "fabricated_policy",
              "none",
            ],
          },
          severity: {
            type: "string",
            enum: ["critical", "moderate", "low", "none"],
          },
          reasoning: { type: "string" },
          requiresFactCheck: {
            type: "boolean",
            description: "Whether this response makes specific claims that need fact checking",
          },
        },
        required: ["violationType", "severity", "reasoning", "requiresFactCheck"],
        additionalProperties: false,
      };

      const result = await this.llmService.invoke<string>({
        prompt: evaluationPrompt,
        jsonSchema: schema,
        temperature: 0.2, // Low temperature for consistent evaluation
        model: "gpt-4o",
      });

      const parsed = JSON.parse(result);
      const violationType = parsed.violationType as ViolationType;
      const severity = parsed.severity as "critical" | "moderate" | "low" | "none";

      // Determine if we should block based on violation type and config
      const shouldBlock = this.shouldBlockResponse(violationType, severity, fullConfig);

      return {
        passed: !shouldBlock,
        violationType,
        severity,
        reasoning: parsed.reasoning,
        shouldBlock,
        requiresFactCheck: parsed.requiresFactCheck && !shouldBlock,
      };
    } catch (error) {
      console.error("Error in company interest assessment:", error);
      // On error, be conservative and allow response but require fact check
      return {
        passed: true,
        violationType: ViolationType.NONE,
        severity: "none",
        reasoning: "Error during evaluation - defaulting to allow with fact check",
        shouldBlock: false,
        requiresFactCheck: true,
      };
    }
  }

  /**
   * Determine if response should be blocked based on violation and config
   */
  private shouldBlockResponse(
    violationType: ViolationType,
    severity: "critical" | "moderate" | "low" | "none",
    config: CompanyInterestConfig,
  ): boolean {
    // No violation = don't block
    if (violationType === ViolationType.NONE) {
      return false;
    }

    // Critical violations are always blocked (safety net)
    if (severity === "critical") {
      return true;
    }

    // Check config for specific violation types
    switch (violationType) {
      case ViolationType.OFF_TOPIC:
        return config.blockOffTopic;
      case ViolationType.COMPETITOR_INFO:
        return config.blockCompetitorInfo;
      case ViolationType.FABRICATED_PRODUCT:
      case ViolationType.FABRICATED_POLICY:
        return config.blockFabrications;
      default:
        return false;
    }
  }

  /**
   * Create a passing assessment (for when guardrail is disabled)
   */
  private createPassingAssessment(): CompanyInterestAssessment {
    return {
      passed: true,
      violationType: ViolationType.NONE,
      severity: "none",
      reasoning: "Company interest guardrail disabled",
      shouldBlock: false,
      requiresFactCheck: false,
    };
  }

  /**
   * Format conversation history for prompt
   */
  private formatConversationHistory(messages: Message[]): string {
    // Get last 5 messages for context
    const recentMessages = messages.slice(-5);

    return recentMessages
      .map((msg) => {
        const role = msg.type === "Customer" ? "Customer" : "Assistant";
        return `${role}: ${msg.content}`;
      })
      .join("\n");
  }

  /**
   * Get default configuration
   */
  static getDefaultConfig(): CompanyInterestConfig {
    return { ...CompanyInterestGuardrailService.DEFAULT_CONFIG };
  }

  /**
   * Merge organization/agent config with defaults
   */
  static mergeConfig(
    orgSettings?: Record<string, unknown>,
    agentSettings?: Record<string, unknown>,
  ): CompanyInterestConfig {
    const config = { ...CompanyInterestGuardrailService.DEFAULT_CONFIG };

    // Organization-level overrides
    if (orgSettings?.companyInterestGuardrail) {
      const orgConf = orgSettings.companyInterestGuardrail as Partial<CompanyInterestConfig>;
      Object.assign(config, orgConf);
    }

    // Agent-level overrides (highest priority)
    if (agentSettings?.companyInterestGuardrail) {
      const agentConf = agentSettings.companyInterestGuardrail as Partial<CompanyInterestConfig>;
      Object.assign(config, agentConf);
    }

    return config;
  }
}
