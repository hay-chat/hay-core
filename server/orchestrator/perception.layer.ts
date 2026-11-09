import { Message, MessageIntent, MessageSentiment } from "@server/database/entities/message.entity";
import { fenceData } from "@server/services/core/prompt-data";
import { LLMService } from "../services/core/llm.service";
import { PromptService } from "../services/prompt.service";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("perception");

export interface Perception {
  intent: { label: MessageIntent; score: number; rationale?: string };
  sentiment: { label: MessageSentiment; score: number };
  language: string;
}

export class PerceptionLayer {
  private llmService: LLMService;
  private promptService: PromptService;

  constructor() {
    this.llmService = new LLMService();
    this.promptService = PromptService.getInstance();
    logger.debug("PerceptionLayer initialized");
  }

  async perceive(
    message: Message,
    conversationId?: string,
    organizationId?: string,
  ): Promise<Perception> {
    const log = logger.child({ organizationId, conversationId });
    log.debug(
      {
        messageId: message.id,
        messageLength: message.content.length,
      },
      "Starting intent and sentiment analysis",
    );

    // Get prompt from PromptService with conversation's language
    const perceptionPrompt = await this.promptService.getPrompt(
      "perception/intent-analysis",
      { message: fenceData(message.content) },
      { conversationId, organizationId },
    );

    log.debug({ promptLength: perceptionPrompt.length }, "Retrieved perception prompt");

    const perceptionSchema = {
      type: "object",
      properties: {
        intent: {
          type: "object",
          properties: {
            label: {
              type: "string",
              enum: Object.values(MessageIntent),
            },
            score: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["label", "score"],
          additionalProperties: false,
        },
        sentiment: {
          type: "object",
          properties: {
            label: {
              type: "string",
              enum: Object.values(MessageSentiment),
            },
            score: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["label", "score"],
          additionalProperties: false,
        },
        language: {
          type: "string",
          description: "ISO 639-1 two-letter language code (e.g., 'en', 'pt', 'es', 'de', 'fr')",
          pattern: "^[a-z]{2}$",
        },
      },
      required: ["intent", "sentiment", "language"],
      additionalProperties: false,
    };

    log.debug("Invoking LLM for perception analysis");

    const perception = await this.llmService.invoke({
      prompt: perceptionPrompt,
      jsonSchema: perceptionSchema,
      // Intent/sentiment/language classification against a strict schema. Medium
      // rather than easy: `intent.label` drives conversation closing in run.ts, so
      // a misread is user-visible — and easy is only ~0.3pp cheaper.
      tier: "medium",
      organizationId,
    });

    const result = JSON.parse(perception) as Perception;

    log.debug(
      {
        intent: result.intent.label,
        intentScore: result.intent.score,
        sentiment: result.sentiment.label,
        sentimentScore: result.sentiment.score,
        language: result.language,
      },
      "Perception analysis complete",
    );

    return result;
  }
}
