import { LLMService } from "./llm.service";
import { PromptService } from "../prompt.service";
import { Document } from "@server/entities/document.entity";
import { Message } from "@server/database/entities/message.entity";

/**
 * Confidence score breakdown showing individual components
 */
export interface ConfidenceBreakdown {
  grounding: number; // 0-1: How well the response is grounded in retrieved context
  retrieval: number; // 0-1: Quality of retrieved documents (similarity scores)
  certainty: number; // 0-1: LLM's self-assessed certainty
}

/**
 * Complete confidence assessment result
 */
export interface ConfidenceAssessment {
  score: number; // 0-1: Overall weighted confidence score
  breakdown: ConfidenceBreakdown;
  tier: "high" | "medium" | "low"; // Confidence tier based on thresholds
  shouldRecheck: boolean; // Whether a recheck should be triggered
  shouldEscalate: boolean; // Whether human escalation is needed
  documentsUsed: Array<{ id: string; title: string; similarity: number }>;
  details: string; // Human-readable explanation
}

/**
 * Configuration for confidence thresholds
 */
export interface ConfidenceConfig {
  highThreshold: number; // Default: 0.8
  mediumThreshold: number; // Default: 0.5
  enableRecheck: boolean; // Default: true
  enableEscalation: boolean; // Default: true
  fallbackMessage: string; // Default message for low confidence
  recheckConfig?: {
    maxDocuments: number; // Default: 10
    similarityThreshold: number; // Default: 0.3
  };
}

/**
 * Context for confidence evaluation
 */
export interface ConfidenceContext {
  response: string; // The AI response to evaluate
  retrievedDocuments: Array<{ document: Document; similarity: number }>;
  conversationHistory: Message[];
  customerQuery: string; // The original customer question
}

/**
 * Service responsible for evaluating confidence in AI responses
 * and implementing guardrails to prevent hallucinated or low-quality responses.
 */
export class ConfidenceGuardrailService {
  private llmService: LLMService;
  private promptService: PromptService;

  // Default configuration
  private static readonly DEFAULT_CONFIG: ConfidenceConfig = {
    highThreshold: 0.8,
    mediumThreshold: 0.5,
    enableRecheck: true,
    enableEscalation: true,
    fallbackMessage:
      "I'm not confident I can provide an accurate answer to this question based on the available information. Let me connect you with a team member who can help.",
    recheckConfig: {
      maxDocuments: 10,
      similarityThreshold: 0.3,
    },
  };

  // Weights for confidence components (must sum to 1.0)
  private static readonly WEIGHTS = {
    grounding: 0.6, // Most important: Is the response based on context?
    retrieval: 0.3, // Document quality and relevance
    certainty: 0.1, // LLM self-assessment
  };

  constructor() {
    this.llmService = new LLMService();
    this.promptService = PromptService.getInstance();
  }

  /**
   * Main method to assess confidence in an AI response
   */
  async assessConfidence(
    context: ConfidenceContext,
    config?: Partial<ConfidenceConfig>,
  ): Promise<ConfidenceAssessment> {
    const fullConfig = { ...ConfidenceGuardrailService.DEFAULT_CONFIG, ...config };

    // Calculate individual confidence components
    const breakdown: ConfidenceBreakdown = {
      grounding: await this.calculateGroundingScore(context),
      retrieval: this.calculateRetrievalScore(context),
      certainty: await this.calculateCertaintyScore(context),
    };

    // Calculate weighted overall score
    const score =
      breakdown.grounding * ConfidenceGuardrailService.WEIGHTS.grounding +
      breakdown.retrieval * ConfidenceGuardrailService.WEIGHTS.retrieval +
      breakdown.certainty * ConfidenceGuardrailService.WEIGHTS.certainty;

    // Determine tier and actions
    const tier = this.determineTier(score, fullConfig);
    const shouldRecheck = tier === "medium" && fullConfig.enableRecheck;
    const shouldEscalate = tier === "low" && fullConfig.enableEscalation;

    // Build documents used list
    const documentsUsed = context.retrievedDocuments.map((doc) => ({
      id: doc.document.id,
      title: doc.document.title,
      similarity: doc.similarity,
    }));

    // Generate human-readable details
    const details = this.generateDetails(breakdown, tier, score);

    return {
      score,
      breakdown,
      tier,
      shouldRecheck,
      shouldEscalate,
      documentsUsed,
      details,
    };
  }

  /**
   * Calculate grounding score: Does the response use information from context
   * or is it based on the LLM's general knowledge?
   *
   * This is the most critical component (60% weight) as per requirements:
   * "We should basically be asking if the information can be extracted from the context
   * or if it's coming from the previous knowledge of the AI"
   */
  private async calculateGroundingScore(context: ConfidenceContext): Promise<number> {
    // If no documents were retrieved, the response cannot be grounded
    if (context.retrievedDocuments.length === 0) {
      return 0.0;
    }

    // Prepare the context from retrieved documents
    const documentContext = context.retrievedDocuments
      .map((doc, idx) => {
        return `[Document ${idx + 1}: ${doc.document.title}]\n${doc.document.content}\n`;
      })
      .join("\n---\n\n");

    // Get prompt from PromptService
    const evaluationPrompt = await this.promptService.getPrompt("execution/confidence-grounding", {
      retrievedDocuments: documentContext,
      response: context.response,
      customerQuery: context.customerQuery,
    });

    try {
      const schema = {
        type: "object",
        properties: {
          score: { type: "number", minimum: 0, maximum: 1 },
          reasoning: { type: "string" },
        },
        required: ["score", "reasoning"],
        additionalProperties: false,
      };

      const result = await this.llmService.invoke<string>({
        prompt: evaluationPrompt,
        jsonSchema: schema,
        temperature: 0.2, // Low temperature for consistent evaluation
        model: "gpt-4o",
      });

      const parsed = JSON.parse(result);
      return Math.max(0, Math.min(1, parsed.score)); // Ensure 0-1 range
    } catch (error) {
      console.error("Error calculating grounding score:", error);
      // On error, return a conservative low score
      return 0.3;
    }
  }

  /**
   * Calculate retrieval score based on document similarity scores.
   * Higher average similarity = higher confidence that we found relevant docs.
   */
  private calculateRetrievalScore(context: ConfidenceContext): number {
    if (context.retrievedDocuments.length === 0) {
      return 0.0;
    }

    // Calculate average similarity score
    const totalSimilarity = context.retrievedDocuments.reduce(
      (sum, doc) => sum + doc.similarity,
      0,
    );
    const avgSimilarity = totalSimilarity / context.retrievedDocuments.length;

    // Normalize to 0-1 scale (similarity is already 0-1 from cosine similarity)
    return avgSimilarity;
  }

  /**
   * Calculate certainty score: LLM's self-assessment of confidence.
   * Uses AI evaluation instead of pattern matching for better accuracy.
   */
  private async calculateCertaintyScore(context: ConfidenceContext): Promise<number> {
    // Get prompt from PromptService
    const certaintyPrompt = await this.promptService.getPrompt("execution/confidence-certainty", {
      response: context.response,
      customerQuery: context.customerQuery,
    });

    try {
      const schema = {
        type: "object",
        properties: {
          score: { type: "number", minimum: 0, maximum: 1 },
          reasoning: { type: "string" },
        },
        required: ["score", "reasoning"],
        additionalProperties: false,
      };

      const result = await this.llmService.invoke<string>({
        prompt: certaintyPrompt,
        jsonSchema: schema,
        temperature: 0.2,
        model: "gpt-4o",
      });

      const parsed = JSON.parse(result);
      const score = Math.max(0, Math.min(1, parsed.score));

      return score;
    } catch (error) {
      console.error("Error calculating certainty score:", error);
      // On error, return moderate certainty
      return 0.5;
    }
  }

  /**
   * Determine confidence tier based on score and thresholds
   */
  private determineTier(
    score: number,
    config: ConfidenceConfig,
  ): "high" | "medium" | "low" {
    if (score >= config.highThreshold) {
      return "high";
    } else if (score >= config.mediumThreshold) {
      return "medium";
    } else {
      return "low";
    }
  }

  /**
   * Generate human-readable details about the confidence assessment
   */
  private generateDetails(
    breakdown: ConfidenceBreakdown,
    tier: string,
    score: number,
  ): string {
    const details = [
      `Overall Confidence: ${(score * 100).toFixed(1)}% (${tier.toUpperCase()})`,
      "",
      "Breakdown:",
      `- Context Grounding: ${(breakdown.grounding * 100).toFixed(1)}% (weight: 60%)`,
      `- Retrieval Quality: ${(breakdown.retrieval * 100).toFixed(1)}% (weight: 30%)`,
      `- Response Certainty: ${(breakdown.certainty * 100).toFixed(1)}% (weight: 10%)`,
    ];

    if (tier === "low") {
      details.push(
        "",
        "⚠️ Low confidence detected. Response may not be grounded in available context.",
      );
    } else if (tier === "medium") {
      details.push("", "⚡ Medium confidence. Recheck recommended before delivery.");
    } else {
      details.push("", "✓ High confidence. Response is well-grounded and reliable.");
    }

    return details.join("\n");
  }

  /**
   * Get default configuration
   */
  static getDefaultConfig(): ConfidenceConfig {
    return { ...ConfidenceGuardrailService.DEFAULT_CONFIG };
  }

  /**
   * Merge organization/agent config with defaults
   */
  static mergeConfig(
    orgSettings?: Record<string, unknown>,
    agentSettings?: Record<string, unknown>,
  ): ConfidenceConfig {
    const config = { ...ConfidenceGuardrailService.DEFAULT_CONFIG };

    // Organization-level overrides
    if (orgSettings?.confidenceGuardrail) {
      const orgConf = orgSettings.confidenceGuardrail as Partial<ConfidenceConfig>;
      Object.assign(config, orgConf);
    }

    // Agent-level overrides (highest priority)
    if (agentSettings?.confidenceGuardrail) {
      const agentConf = agentSettings.confidenceGuardrail as Partial<ConfidenceConfig>;
      Object.assign(config, agentConf);
    }

    return config;
  }
}
