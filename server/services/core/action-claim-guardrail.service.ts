import { LLMService } from "./llm.service";
import { fenceData } from "@server/services/core/prompt-data";
import { PromptService } from "../prompt.service";
import { Message, MessageType } from "@server/database/entities/message.entity";
import { createLogger } from "@server/lib/logger";
import { isWriteAdjacentReply } from "./reply-risk";
import {
  type ActionClaimGuardrailConfig,
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
  /** Held for a person's approval (D4-4): requested, not done. */
  pending?: boolean;
  /** Ran in the visitor's browser: only the page says what happened. */
  pageTool?: boolean;
  /** A team member decided an earlier held call; this turn answers that decision. */
  decision?: "approved" | "declined";
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
  /** The check itself failed; the reply was held because it could not be verified. */
  evaluationFailed?: boolean;
}

/**
 * Context for action-claim evaluation
 */
export interface ActionClaimContext {
  response: string; // The AI response to evaluate
  customerQuery: string; // The last customer message
  conversationHistory: Message[]; // Full conversation context
  toolsCalledThisTurn: ToolLedgerEntry[]; // Ledger of tool calls made this turn
  organizationId: string; // Routes the evaluation through the org's AI provider and region
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
      response: fenceData(context.response),
      customerQuery: fenceData(context.customerQuery),
      conversationHistory: fenceData(this.formatConversationHistory(context.conversationHistory)),
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
        caller: "guardrail-action-claim",
        prompt: evaluationPrompt,
        jsonSchema: schema,
        temperature: 0.2, // Low temperature for consistent evaluation
        tier: "medium",
        organizationId: context.organizationId,
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
      // A reply that could not be checked passes only when it cannot claim an
      // action: no tool ran this turn and it states no amount, link or
      // state-changing verb. Anything else goes to a person.
      if (context.toolsCalledThisTurn.length > 0 || isWriteAdjacentReply(context.response)) {
        return {
          claimsAction: true,
          claimedActions: [],
          backedByTools: false,
          reasoning: "Action claim check unavailable - reply needs review",
          passed: false,
          evaluationFailed: true,
        };
      }
      return this.createPassingAssessment("Error during evaluation - reply claims no action");
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
    const recentMessages = messages.filter((msg) => msg.type !== MessageType.DOCUMENT).slice(-5);

    return recentMessages
      .map((msg) => {
        const role =
          msg.type === MessageType.CUSTOMER
            ? "Customer"
            : msg.type === MessageType.SYSTEM
              ? "System note"
              : msg.type === MessageType.TOOL
                ? "Tool result"
                : "Assistant";
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
      .map((entry) => {
        return `- ${entry.name} — ${this.ledgerStatus(entry)}`;
      })
      .join("\n");
  }

  private ledgerStatus(entry: ToolLedgerEntry): string {
    if (entry.decision === "declined") return "DECLINED_BY_TEAM";
    if (entry.pending) return "PENDING_APPROVAL";
    if (entry.pageTool && entry.success) return "UNVERIFIED_PAGE_TOOL";
    const status = entry.success ? "SUCCESS" : "FAILED";
    return entry.decision === "approved" ? `${status} (approved by the team)` : status;
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
