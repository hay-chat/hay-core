import { Message, MessageIntent, MessageSentiment } from "@server/database/entities/message.entity";
import { Agent } from "@server/database/entities/agent.entity";
import { LLMService } from "../services/core/llm.service";
import { PromptService } from "../services/prompt.service";
import { debugLog } from "@server/lib/debug-logger";

export interface Perception {
  intent: { label: MessageIntent; score: number; rationale?: string };
  sentiment: { label: MessageSentiment; score: number };
}

export class PerceptionLayer {
  private llmService: LLMService;
  private promptService: PromptService;

  constructor() {
    this.llmService = new LLMService();
    this.promptService = PromptService.getInstance();
    debugLog("perception", "PerceptionLayer initialized");
  }

  async perceive(message: Message, organizationId?: string): Promise<Perception> {
    debugLog("perception", "Starting intent and sentiment analysis", {
      messageId: message.id,
      messageContent: message.content.substring(0, 100),
      organizationId,
    });

    // Get prompt from PromptService with organization's language
    const perceptionPrompt = await this.promptService.getPrompt(
      "perception/intent-analysis",
      { message: message.content },
      { organizationId },
    );

    debugLog("perception", "Retrieved perception prompt", {
      promptLength: perceptionPrompt.length,
    });

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
        },
      },
      required: ["intent", "sentiment"],
    };

    debugLog("perception", "Invoking LLM for perception analysis");

    const perception = await this.llmService.invoke({
      prompt: perceptionPrompt,
      jsonSchema: perceptionSchema,
    });

    const result = JSON.parse(perception) as Perception;

    debugLog("perception", "Perception analysis complete", {
      intent: result.intent.label,
      intentScore: result.intent.score,
      sentiment: result.sentiment.label,
      sentimentScore: result.sentiment.score,
    });

    return result;
  }

  async getAgentCandidate(
    message: Message,
    agents: Agent[],
    organizationId?: string,
  ): Promise<Agent | null> {
    debugLog("perception", "Starting agent candidate selection", {
      messageId: message.id,
      availableAgentsCount: agents.length,
      organizationId,
    });

    if (agents.length === 0) {
      debugLog("perception", "No agents available, returning null");
      return null;
    }

    // Filter agents that have triggers defined
    const agentsWithTriggers = agents.filter(
      (agent) => agent.trigger && agent.trigger.trim().length > 0,
    );

    debugLog("perception", "Filtered agents with triggers", {
      agentsWithTriggersCount: agentsWithTriggers.length,
      totalAgentsCount: agents.length,
    });

    if (agentsWithTriggers.length === 0) {
      // Return first available agent if no triggers defined
      debugLog("perception", "No agents with triggers, using first available agent", {
        selectedAgentId: agents[0].id,
        selectedAgentName: agents[0].name,
      });
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
      { organizationId },
    );

    debugLog("perception", "Retrieved agent selection prompt, invoking LLM");

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
          },
        },
      },
      required: ["candidates"],
    };

    const result = await this.llmService.invoke({
      prompt: candidatePrompt,
      jsonSchema: candidateSchema,
    });

    const parsed = JSON.parse(result) as {
      candidates: Array<{ id: string; score: number; rationale: string }>;
    };

    debugLog("perception", "Agent candidate analysis complete", {
      candidatesCount: parsed.candidates.length,
      candidates: parsed.candidates.map((c) => ({
        id: c.id,
        score: c.score,
        rationale: c.rationale.substring(0, 100),
      })),
    });

    const topCandidate = parsed.candidates
      .filter((c) => c.score > 0.7)
      .sort((a, b) => b.score - a.score)[0];

    if (!topCandidate) {
      debugLog("perception", "No candidate scored above 0.7, falling back to first agent", {
        fallbackAgentId: agents[0].id,
        fallbackAgentName: agents[0].name,
      });
      return agents[0]; // Fallback to first agent
    }

    const selectedAgent = agents.find((a) => a.id === topCandidate.id) || agents[0];

    debugLog("perception", "Agent selected", {
      selectedAgentId: selectedAgent.id,
      selectedAgentName: selectedAgent.name,
      score: topCandidate.score,
      rationale: topCandidate.rationale,
    });

    return selectedAgent;
  }
}
