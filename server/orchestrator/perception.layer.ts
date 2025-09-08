import {
  Message,
  MessageIntent,
  MessageSentiment,
} from "@server/database/entities/message.entity";
import { Agent } from "@server/database/entities/agent.entity";
import { LLMService } from "../services/core/llm.service";

export interface Perception {
  intent: { label: MessageIntent; score: number; rationale?: string };
  sentiment: { label: MessageSentiment; score: number };
}

export class PerceptionLayer {
  private llmService: LLMService;

  constructor() {
    // console.log("PerceptionLayer initialized");
    this.llmService = new LLMService();
  }

  async perceive(message: Message): Promise<Perception> {
    const perceptionPrompt = `Analyze the following user message and determine:
1. The intent (what the user wants to accomplish)
2. The sentiment (emotional tone of the message)

User message: "${message.content}"`;

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

  async getAgentCandidate(
    message: Message,
    agents: Agent[]
  ): Promise<Agent | null> {
    if (agents.length === 0) {
      return null;
    }

    // Filter agents that have triggers defined
    const agentsWithTriggers = agents.filter(
      (agent) => agent.trigger && agent.trigger.trim().length > 0
    );

    if (agentsWithTriggers.length === 0) {
      // Return first available agent if no triggers defined
      return agents[0];
    }

    const candidatePrompt = `Given the user message below, score how relevant each agent is (0-1 scale).
Consider the trigger phrases, descriptions, and overall context match.

User message: "${message.content}"

Available agents:
${agentsWithTriggers
  .map(
    (a) =>
      `- ID: ${a.id}, Name: "${a.name}", Trigger: "${
        a.trigger
      }", Description: "${a.description || "No description"}"`
  )
  .join("\n")}

For each agent, provide a relevance score and brief rationale.`;

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
