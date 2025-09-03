import { Message } from "@server/database/entities/message.entity";
import { LLMService } from "@server/services/orchestrator/llm.service";
import { PlaybookRepository } from "@server/repositories/playbook.repository";
import { PlaybookStatus } from "@server/database/entities/playbook.entity";
import { Intent, Sentiment, Perception } from "./types";

export class PerceptionLayer {
  private llmService: LLMService;
  private playbookRepository: PlaybookRepository;

  constructor() {
    console.log("PerceptionLayer initialized");
    this.llmService = new LLMService();
    this.playbookRepository = new PlaybookRepository();
  }

  async perceive(message: Message, organizationId: string): Promise<Perception> {
    console.log(`[PerceptionLayer] Perceiving message: ${message.content}`);
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
              enum: [
                "greet",
                "question",
                "request",
                "handoff",
                "close_satisfied",
                "close_unsatisfied",
                "other",
                "unknown",
              ],
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
              enum: ["positive", "neutral", "negative"],
            },
            score: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["label", "score"],
        },
      },
      required: ["intent", "sentiment"],
    };

    const llmPerception = await this.llmService.chat<{
      intent: { label: Intent; score: number; rationale?: string };
      sentiment: { label: Sentiment; score: number };
    }>({
      message: message.content,
      jsonSchema: perceptionSchema,
      systemPrompt: perceptionPrompt,
    });

    console.log(
      `[PerceptionLayer] LLM perception: ${JSON.stringify(llmPerception)}`
    );

    const playbookCandidates = await this.findPlaybookCandidates(message, organizationId);

    console.log(
      `[PerceptionLayer] Playbook candidates: ${JSON.stringify(
        playbookCandidates
      )}`
    );

    return {
      intent: llmPerception.intent,
      sentiment: llmPerception.sentiment,
      playbookCandidates,
    };
  }

  private async findPlaybookCandidates(
    message: Message,
    organizationId: string
  ): Promise<Array<{ id: string; score: number; rationale?: string }>> {
    try {
      const playbooks = await this.playbookRepository.findByStatus(organizationId, PlaybookStatus.ACTIVE);

      if (playbooks.length === 0) {
        return [];
      }

      const candidatePrompt = `Given the user message below, score how relevant each playbook is (0-1 scale).
Consider the trigger phrases, descriptions, and overall context match.

User message: "${message.content}"

Available playbooks:
${playbooks
  .map(
    (p) =>
      `- ID: ${p.id}, Title: "${p.title}", Trigger: "${
        p.trigger
      }", Description: "${p.description || "No description"}"`
  )
  .join("\n")}

For each playbook, provide a relevance score and brief rationale.`;

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

      console.log(`[findPlaybookCandidates]`, message.content, candidatePrompt);

      const result = await this.llmService.chat<{
        candidates: Array<{ id: string; score: number; rationale: string }>;
      }>({
        message: message.content,
        jsonSchema: candidateSchema,
        systemPrompt: candidatePrompt,
      });

      console.log(result);

      return result.candidates
        .filter((c: { score: number }) => c.score > 0.1)
        .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
        .slice(0, 5);
    } catch (error) {
      console.error("Error finding playbook candidates:", error);
      return [];
    }
  }
}
