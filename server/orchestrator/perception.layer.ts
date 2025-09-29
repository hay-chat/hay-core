import { Message, MessageIntent, MessageSentiment } from "@server/database/entities/message.entity";
import { Agent } from "@server/database/entities/agent.entity";
import { LLMService } from "../services/core/llm.service";
import { PromptService } from "../services/prompt.service";

export interface Perception {
  intent: { label: MessageIntent; score: number; rationale?: string };
  sentiment: { label: MessageSentiment; score: number };
}

export class PerceptionLayer {
  private llmService: LLMService;
  private promptService: PromptService;

  constructor() {
    // console.log("PerceptionLayer initialized");
    this.llmService = new LLMService();
    this.promptService = PromptService.getInstance();
  }

  async perceive(message: Message, organizationId?: string): Promise<Perception> {
    // Get prompt from PromptService with organization's language
    const perceptionPrompt = await this.promptService.getPrompt(
      "perception/intent-analysis",
      { message: message.content },
      { organizationId }
    );

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

    const perception = await this.llmService.invoke({
      prompt: perceptionPrompt,
      jsonSchema: perceptionSchema,
    });

    return JSON.parse(perception) as Perception;
  }

  async getAgentCandidate(message: Message, agents: Agent[], organizationId?: string): Promise<Agent | null> {
    if (agents.length === 0) {
      return null;
    }

    // Filter agents that have triggers defined
    const agentsWithTriggers = agents.filter(
      (agent) => agent.trigger && agent.trigger.trim().length > 0,
    );

    if (agentsWithTriggers.length === 0) {
      // Return first available agent if no triggers defined
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
      { organizationId }
    );

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

    const topCandidate = parsed.candidates
      .filter((c) => c.score > 0.7)
      .sort((a, b) => b.score - a.score)[0];

    if (!topCandidate) {
      return agents[0]; // Fallback to first agent
    }

    return agents.find((a) => a.id === topCandidate.id) || agents[0];
  }
}
