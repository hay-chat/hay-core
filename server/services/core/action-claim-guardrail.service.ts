import { LLMService } from "./llm.service";
import { PromptService } from "../prompt.service";
import { Message } from "@server/database/entities/message.entity";
import { createLogger } from "@server/lib/logger";
import {
  ActionClaimGuardrailConfig,
  DEFAULT_ACTION_CLAIM_GUARDRAIL_CONFIG,
} from "@server/types/organization-settings.types";

const logger = createLogger("action-claim-guardrail");

/**
 * A tool call made during the current execution loop (turn).
 * Failed calls are recorded but do NOT back a success claim.
 */
export interface ToolLedgerEntry {
  name: string;
  success: boolean;
}

/**
 * Result of action-claim evaluation
 */
export interface ActionClaimAssessment {
  claimsAction: boolean; // Whether the response asserts a state-changing action was performed/initiated
  claimedActions: string[]; // Short descriptions of the claimed actions
  backedByTools: boolean; // Whether ALL claims are backed by successful tool calls this turn
  reasoning: string; // Explanation of the decision
  passed: boolean; // !claimsAction || backedByTools
}

/**
 * Context for action-claim evaluation
 */
export interface ActionClaimContext {
  response: string; // The AI response to evaluate
  customerQuery: string; // The last customer message
  conversationHistory: Message[]; // Full conversation context
  toolsCalledThisTurn: ToolLedgerEntry[]; // Ledger of tool calls made this turn
}

/**
 * Stage 0 Guardrail: Action-Claim vs Tool-Call Consistency
 *
 * Prevents the orchestrator from sending responses that claim a state-changing
 * action was performed ("I've initiated the cancellation...") when no tool call
 * backed it during the current turn. The judge sees the turn's tool ledger
 * (names + success/failure) and decides semantically whether the claims are
 * backed — a failed tool call does not back a success claim.
 *
 * On violation the execution layer gives the planner one corrective retry
 * (call the tool or rephrase) before escalating to human handoff.
 */
export class ActionClaimGuardrailService {
  private llmService: LLMService;
  private promptService: PromptService;

  constructor() {
    this.llmService = new LLMService();
    this.promptService = PromptService.getInstance();
  }

  /**
   * Assess whether the response claims an action unbacked by the tool ledger
   */
  async assessActionClaim(
    context: ActionClaimContext,
    config?: Partial<ActionClaimGuardrailConfig>,
  ): Promise<ActionClaimAssessment> {
    const fullConfig = { ...DEFAULT_ACTION_CLAIM_GUARDRAIL_CONFIG, ...config };

    if (!fullConfig.enabled) {
      return this.createPassingAssessment("Action claim guardrail disabled");
    }

    const evaluationPrompt = await this.promptService.getPrompt("execution/action-claim-check", {
      response: context.response,
      customerQuery: context.customerQuery,
      conversationHistory: this.formatConversationHistory(context.conversationHistory),
      toolLedger: this.formatToolLedger(context.toolsCalledThisTurn),
    });

    try {
      const schema = {
        type: "object",
        properties: {
          claimsAction: {
            type: "boolean",
            description:
              "Whether the response asserts a state-changing action was performed or initiated",
          },
          claimedActions: {
            type: "array",
            items: { type: "string" },
            description: "Short descriptions of each claimed action (empty if none)",
          },
          backedByTools: {
            type: "boolean",
            description:
              "Whether ALL claimed actions are backed by successful tool calls this turn",
          },
          reasoning: { type: "string" },
        },
        required: ["claimsAction", "claimedActions", "backedByTools", "reasoning"],
        additionalProperties: false,
      };

      const result = await this.llmService.invoke<string>({
        prompt: evaluationPrompt,
        jsonSchema: schema,
        temperature: 0.2, // Low temperature for consistent evaluation
        tier: "medium",
      });

      const parsed = JSON.parse(result) as {
        claimsAction: boolean;
        claimedActions: string[];
        backedByTools: boolean;
        reasoning: string;
      };

      return {
        claimsAction: parsed.claimsAction,
        claimedActions: parsed.claimedActions ?? [],
        backedByTools: parsed.backedByTools,
        reasoning: parsed.reasoning,
        passed: !parsed.claimsAction || parsed.backedByTools,
      };
    } catch (error) {
      logger.error({ err: error }, "Error in action claim assessment");
      // Fail open: never block conversations on guardrail outages
      return this.createPassingAssessment("Error during evaluation - defaulting to allow");
    }
  }

  private createPassingAssessment(reasoning: string): ActionClaimAssessment {
    return {
      claimsAction: false,
      claimedActions: [],
      backedByTools: true,
      reasoning,
      passed: true,
    };
  }

  /**
   * Format conversation history for prompt
   */
  private formatConversationHistory(messages: Message[]): string {
    const recentMessages = messages.slice(-5);

    return recentMessages
      .map((msg) => {
        const role = msg.type === "Customer" ? "Customer" : "Assistant";
        return `${role}: ${msg.content}`;
      })
      .join("\n");
  }

  /**
   * Format the turn's tool ledger for the prompt
   */
  private formatToolLedger(entries: ToolLedgerEntry[]): string {
    if (entries.length === 0) {
      return "(none — no tools were called this turn)";
    }
    return entries
      .map((entry) => `- ${entry.name} — ${entry.success ? "SUCCESS" : "FAILED"}`)
      .join("\n");
  }

  /**
   * Get default configuration
   */
  static getDefaultConfig(): ActionClaimGuardrailConfig {
    return { ...DEFAULT_ACTION_CLAIM_GUARDRAIL_CONFIG };
  }

  /**
   * Merge organization/agent config with defaults
   */
  static mergeConfig(
    orgSettings?: Record<string, unknown>,
    agentSettings?: Record<string, unknown>,
  ): ActionClaimGuardrailConfig {
    const config = { ...DEFAULT_ACTION_CLAIM_GUARDRAIL_CONFIG };

    // Organization-level overrides
    if (orgSettings?.actionClaimGuardrail) {
      const orgConf = orgSettings.actionClaimGuardrail as Partial<ActionClaimGuardrailConfig>;
      Object.assign(config, orgConf);
    }

    // Agent-level overrides (highest priority)
    if (agentSettings?.actionClaimGuardrail) {
      const agentConf = agentSettings.actionClaimGuardrail as Partial<ActionClaimGuardrailConfig>;
      Object.assign(config, agentConf);
    }

    return config;
  }
}
