/**
 * Judge and scorer (D7-10).
 *
 * After the AI answers a replayed or test-case turn, this reads what it did
 * (its reply, the tool calls in action_log, whether it handed off, whether
 * the action-claim guardrail had to step in) and scores it:
 *
 * - deterministic checks: replied or handed off, tools that must / must not
 *   be called, hand-off expected or not, no unbacked action claim;
 * - an LLM judge against the reply that was really sent (replays) or the
 *   expected outcome (test cases): agreement, wrong, risky, knowledge missing.
 *
 * The result is a bucket for the replay report (answered, handed off, needed
 * an action, wrong or risky, knowledge missing) and pass/fail for test cases.
 * The judge never throws: when the LLM call fails, only the deterministic
 * checks count and `passed` is null ("could not judge").
 */

import { AppDataSource } from "@server/database/data-source";
import { Conversation } from "@server/database/entities/conversation.entity";
import { Message, MessageType } from "@server/database/entities/message.entity";
import { ActionLog } from "@server/database/entities/action-log.entity";
import type {
  SimulationExpectations,
  SimulationSeedTurn,
} from "@server/database/entities/simulation-run-item.entity";
import { LLMService } from "@server/services/core/llm.service";
import { PromptService } from "@server/services/prompt.service";
import { createLogger } from "@server/lib/logger";
import { storeDataMayHaveChanged } from "./replay.service";

const logger = createLogger("turn-judge");

export const REPLAY_BUCKETS = [
  "answered",
  "handed_off",
  "needed_action",
  "wrong_or_risky",
  "knowledge_missing",
] as const;
export type ReplayBucket = (typeof REPLAY_BUCKETS)[number];

export type CheckId =
  | "replied"
  | "action_claim"
  | "must_call"
  | "must_not_call"
  | "handoff"
  | "reply_quality"
  | "safe";

export interface VerdictCheck {
  id: CheckId;
  passed: boolean;
  /** Tool names, for the tool checks. */
  detail?: string[];
}

export interface VerdictTool {
  name: string;
  readOnly: boolean;
  /** action_log outcome: success, error, simulated (a write, not sent), held, confirming. */
  outcome: string;
  args: Record<string, unknown>;
}

export interface JudgeOpinion {
  agreement: "same" | "partial" | "different" | "no_reference";
  quality: "good" | "wrong";
  risky: boolean;
  knowledgeMissing: boolean;
  meetsExpectedOutcome: boolean | null;
  repeatsAvoidedReply: boolean;
  reasoning: string;
}

/** What the AI did on the turn, read from its simulation conversation. */
export interface TurnFacts {
  reply: string | null;
  handedOff: boolean;
  tools: VerdictTool[];
  /** The action-claim guardrail caught a claim no tool call backed. */
  actionClaimFlagged: boolean;
  /** The playbook the AI followed, for "Improve from conversation". */
  playbookId: string | null;
}

export interface SimulationVerdict extends TurnFacts {
  bucket: ReplayBucket;
  /** null = the LLM judge was needed but failed; only the checks ran. */
  passed: boolean | null;
  checks: VerdictCheck[];
  judge: JudgeOpinion | null;
  judgeFailed: boolean;
  storeDataChanged: boolean;
}

function needsJudge(expectations: SimulationExpectations): boolean {
  return !!(
    expectations.referenceReply?.trim() ||
    expectations.expectedOutcome?.trim() ||
    expectations.avoidReply?.trim()
  );
}

/** Pure scoring: checks, bucket and pass/fail from the facts and the judge. */
export function scoreTurn(
  facts: TurnFacts,
  expectations: SimulationExpectations,
  judge: JudgeOpinion | null,
  options: { judgeFailed?: boolean; now?: Date } = {},
): SimulationVerdict {
  const called = new Set(facts.tools.map((t) => t.name));
  const checks: VerdictCheck[] = [
    { id: "replied", passed: !!facts.reply?.trim() || facts.handedOff },
    { id: "action_claim", passed: !facts.actionClaimFlagged },
  ];
  if (expectations.mustCallTools?.length) {
    const missing = expectations.mustCallTools.filter((name) => !called.has(name));
    checks.push({ id: "must_call", passed: missing.length === 0, detail: missing });
  }
  if (expectations.mustNotCallTools?.length) {
    const forbidden = expectations.mustNotCallTools.filter((name) => called.has(name));
    checks.push({ id: "must_not_call", passed: forbidden.length === 0, detail: forbidden });
  }
  if (typeof expectations.expectHandoff === "boolean") {
    checks.push({ id: "handoff", passed: facts.handedOff === expectations.expectHandoff });
  }
  if (judge) {
    checks.push({
      id: "reply_quality",
      passed:
        judge.quality === "good" &&
        !judge.repeatsAvoidedReply &&
        judge.meetsExpectedOutcome !== false,
    });
    checks.push({ id: "safe", passed: !judge.risky });
  }

  const judgeFailed = !!options.judgeFailed;
  const allChecksPassed = checks.every((c) => c.passed);
  // A failed check is a fail either way; a pass needs the judge when it was due.
  const passed = !allChecksPassed ? false : judgeFailed ? null : true;

  const writes = facts.tools.filter((t) => !t.readOnly);
  let bucket: ReplayBucket;
  if (facts.handedOff) bucket = "handed_off";
  else if (!facts.reply?.trim() || facts.actionClaimFlagged || judge?.risky) {
    bucket = "wrong_or_risky";
  } else if (judge?.knowledgeMissing) bucket = "knowledge_missing";
  else if (judge?.quality === "wrong") bucket = "wrong_or_risky";
  else if (writes.length > 0) bucket = "needed_action";
  else bucket = "answered";

  const successfulReads = facts.tools.filter((t) => t.readOnly && t.outcome === "success").length;

  return {
    ...facts,
    bucket,
    passed,
    checks,
    judge,
    judgeFailed,
    storeDataChanged: storeDataMayHaveChanged(expectations, successfulReads, options.now),
  };
}

export async function gatherTurnFacts(conversationId: string): Promise<TurnFacts> {
  const conversation = await AppDataSource.getRepository(Conversation).findOne({
    where: { id: conversationId },
  });
  const messages = await AppDataSource.getRepository(Message).find({
    where: { conversation_id: conversationId, type: MessageType.BOT_AGENT },
    order: { created_at: "ASC" },
  });
  const actions = await AppDataSource.getRepository(ActionLog).find({
    where: { conversation_id: conversationId },
    order: { created_at: "ASC" },
  });

  // Seeded history has no AI messages: every BOT_AGENT message is this turn's.
  const reply = messages
    .map((m) => m.content?.trim())
    .filter(Boolean)
    .join("\n\n");
  const handedOff =
    !!conversation?.handed_off_at ||
    conversation?.status === "pending-human" ||
    messages.some((m) => m.metadata?.isHandoffMessage === true);
  // A retry that ended in a clean reply is the guardrail working, not a fail;
  // a final assessment that still failed (fallback, escalation) is.
  const actionClaimFlagged = messages.some((m) => m.metadata?.actionClaim?.passed === false);

  return {
    reply: reply || null,
    handedOff,
    tools: actions.map((a) => ({
      name: a.tool_name,
      readOnly: a.read_only,
      outcome: a.outcome,
      args: a.args ?? {},
    })),
    actionClaimFlagged,
    playbookId: conversation?.playbook_id ?? null,
  };
}

function formatContext(seed: SimulationSeedTurn[]): string {
  return seed
    .slice(-12)
    .map((t) => `${t.role === "customer" ? "Customer" : "Store"}: ${t.text}`)
    .join("\n");
}

function formatTools(tools: VerdictTool[]): string {
  if (tools.length === 0) return "(none)";
  return tools
    .map((t) => {
      const kind = t.readOnly ? "read" : "write";
      const outcome = t.outcome === "simulated" ? "simulated, not sent" : t.outcome;
      return `- ${t.name} (${kind}, ${outcome})`;
    })
    .join("\n");
}

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    agreement: { type: "string", enum: ["same", "partial", "different", "no_reference"] },
    quality: { type: "string", enum: ["good", "wrong"] },
    risky: { type: "boolean" },
    knowledgeMissing: { type: "boolean" },
    meetsExpectedOutcome: { type: ["boolean", "null"] },
    repeatsAvoidedReply: { type: "boolean" },
    reasoning: { type: "string" },
  },
  required: [
    "agreement",
    "quality",
    "risky",
    "knowledgeMissing",
    "meetsExpectedOutcome",
    "repeatsAvoidedReply",
    "reasoning",
  ],
  additionalProperties: false,
};

export class TurnJudgeService {
  private llm = new LLMService();

  async askJudge(input: {
    organizationId: string;
    seed: SimulationSeedTurn[];
    reply: string;
    tools: VerdictTool[];
    expectations: SimulationExpectations;
  }): Promise<JudgeOpinion> {
    const prompt = await PromptService.getInstance().getPrompt("simulation/turn-judge", {
      context: formatContext(input.seed),
      aiReply: input.reply,
      tools: formatTools(input.tools),
      referenceReply: input.expectations.referenceReply?.trim() ?? "",
      expectedOutcome: input.expectations.expectedOutcome?.trim() ?? "",
      avoidReply: input.expectations.avoidReply?.trim() ?? "",
    });
    const raw = await this.llm.invoke<string>({
      prompt,
      jsonSchema: JUDGE_SCHEMA,
      temperature: 0,
      tier: "medium",
      organizationId: input.organizationId,
    });
    const parsed = JSON.parse(raw) as Partial<JudgeOpinion>;
    return {
      agreement: input.expectations.referenceReply?.trim()
        ? (parsed.agreement ?? "different")
        : "no_reference",
      quality: parsed.quality === "wrong" ? "wrong" : "good",
      risky: parsed.risky === true,
      knowledgeMissing: parsed.knowledgeMissing === true,
      meetsExpectedOutcome: input.expectations.expectedOutcome?.trim()
        ? (parsed.meetsExpectedOutcome ?? null)
        : null,
      repeatsAvoidedReply: input.expectations.avoidReply?.trim()
        ? parsed.repeatsAvoidedReply === true
        : false,
      reasoning: String(parsed.reasoning ?? "").slice(0, 1000),
    };
  }

  /**
   * Score the AI's turn in a judged simulation conversation. Called by the
   * harness right after the orchestrator answered, before the conversation
   * is closed; its LLM tokens count toward the run's usage.
   */
  async judge(input: {
    organizationId: string;
    conversationId: string;
    seed: SimulationSeedTurn[];
    expectations: SimulationExpectations;
  }): Promise<SimulationVerdict> {
    const facts = await gatherTurnFacts(input.conversationId);
    let judge: JudgeOpinion | null = null;
    let judgeFailed = false;
    // Without a reply there is nothing to compare; with no reference, the
    // judge still looks for wrong, risky and missing-knowledge answers.
    if (facts.reply && !facts.handedOff) {
      try {
        judge = await this.askJudge({
          organizationId: input.organizationId,
          seed: input.seed,
          reply: facts.reply,
          tools: facts.tools,
          expectations: input.expectations,
        });
      } catch (err) {
        logger.warn({ err, conversationId: input.conversationId }, "Turn judge failed");
        judgeFailed = needsJudge(input.expectations);
      }
    }
    return scoreTurn(facts, input.expectations, judge, { judgeFailed });
  }
}

export const turnJudgeService = new TurnJudgeService();
