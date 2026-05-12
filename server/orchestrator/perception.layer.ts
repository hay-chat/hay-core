import { Message, MessageIntent, MessageSentiment } from "@server/database/entities/message.entity";
import { Agent } from "@server/database/entities/agent.entity";
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
        messageContent: message.content.substring(0, 100),
      },
      "Starting intent and sentiment analysis",
    );

    // Get prompt from PromptService with conversation's language
    const perceptionPrompt = await this.promptService.getPrompt(
      "perception/intent-analysis",
      { message: message.content },
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

  async getAgentCandidate(
    message: Message,
    agents: Agent[],
    conversationId?: string,
    organizationId?: string,
  ): Promise<Agent | null> {
    const log = logger.child({ organizationId, conversationId });
    log.debug(
      {
        messageId: message.id,
        availableAgentsCount: agents.length,
      },
      "Starting agent candidate selection",
    );

    if (agents.length === 0) {
      log.debug("No agents available, returning null");
      return null;
    }

    // Filter agents that have triggers defined
    const agentsWithTriggers = agents.filter(
      (agent) => agent.trigger && agent.trigger.trim().length > 0,
    );

    log.debug(
      {
        agentsWithTriggersCount: agentsWithTriggers.length,
        totalAgentsCount: agents.length,
      },
      "Filtered agents with triggers",
    );

    if (agentsWithTriggers.length === 0) {
      // Return first available agent if no triggers defined
      log.debug(
        {
          selectedAgentId: agents[0].id,
          selectedAgentName: agents[0].name,
        },
        "No agents with triggers, using first available agent",
      );
      return agents[0];
    }

    // Get agent selection prompt from PromptService
    const candidatePrompt = await this.promptService.getPrompt(
      "perception/agent-selection",
      {
        message: message.content,
        agents: agentsWithTriggers.map((a) => ({
          id: a.id,
          name: a.name,
          trigger: a.trigger,
          description: a.description,
        })),
      },
      { conversationId, organizationId },
    );

    log.debug("Retrieved agent selection prompt, invoking LLM");

    const candidateSchema = {
      type: "object",
      properties: {
        candidates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              score: { type: "number", minimum: 0, maximum: 1 },
              rationale: { type: "string" },
            },
            required: ["id", "score", "rationale"],
            additionalProperties: false,
          },
        },
      },
      required: ["candidates"],
      additionalProperties: false,
    };

    const result = await this.llmService.invoke({
      prompt: candidatePrompt,
      jsonSchema: candidateSchema,
    });

    const parsed = JSON.parse(result) as {
      candidates: Array<{ id: string; score: number; rationale: string }>;
    };

    log.debug(
      {
        candidatesCount: parsed.candidates.length,
        candidates: parsed.candidates.map((c) => ({
          id: c.id,
          score: c.score,
          rationale: c.rationale.substring(0, 100),
        })),
      },
      "Agent candidate analysis complete",
    );

    const topCandidate = parsed.candidates
      .filter((c) => c.score > 0.7)
      .sort((a, b) => b.score - a.score)[0];

    if (!topCandidate) {
      log.debug(
        {
          fallbackAgentId: agents[0].id,
          fallbackAgentName: agents[0].name,
        },
        "No candidate scored above 0.7, falling back to first agent",
      );
      return agents[0]; // Fallback to first agent
    }

    const selectedAgent = agents.find((a) => a.id === topCandidate.id) || agents[0];

    log.debug(
      {
        selectedAgentId: selectedAgent.id,
        selectedAgentName: selectedAgent.name,
        score: topCandidate.score,
        rationale: topCandidate.rationale,
      },
      "Agent selected",
    );

    return selectedAgent;
  }
}
