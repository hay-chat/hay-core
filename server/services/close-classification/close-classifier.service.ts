/**
 * Close classifier (D1-3 + D3-8): one LLM call per close that writes the
 * billing outcome and the Insights QA event.
 *
 * Flow
 * 1. `recordClose` runs inside the conversation repository when a
 *    conversation enters a closed status. It inserts a ConversationOutcome row
 *    with the rule outcome and `classified_at = NULL`. Cheap, no LLM, so the
 *    close path is never blocked.
 * 2. The `close-classification` scheduled job calls `processPending`, which
 *    leases pending rows (FOR UPDATE SKIP LOCKED + `claimed_until`) and
 *    classifies each one with a single structured LLM call through the org's
 *    provider. The outcome row and the insight issue are written in one
 *    transaction, guarded by `classified_at IS NULL` and a unique key, so a
 *    retry or a second worker never writes twice.
 * 3. A customer message calls `reverseOnCustomerReturn`: closes of the same
 *    conversation, or of the same identified customer, in the last 72 h are
 *    marked reversed and drop out of the billable count.
 *
 * LLM failure default: after MAX_ATTEMPTS failed calls the rule outcome
 * stays (`classified_by = rule`) and no insight issue is written. The rule
 * never bills a handed-off conversation and bills a silent close only when
 * the AI's last reply was an answer, not a question (see outcome-rules.ts).
 */
import { AppDataSource } from "@server/database/data-source";
import { ConversationOutcome } from "@server/database/entities/conversation-outcome.entity";
import { InsightIssue } from "@server/database/entities/insight-issue.entity";
import { Conversation } from "@server/database/entities/conversation.entity";
import { Message, MessageType } from "@server/database/entities/message.entity";
import { IsNull, type QueryDeepPartialEntity } from "typeorm";
import { LLMService } from "@server/services/core/llm.service";
import { PromptService } from "@server/services/prompt.service";
import { redactString } from "@server/lib/logger/redaction";
import { createLogger } from "@server/lib/logger";
import {
  INSIGHT_ACTION_TYPES,
  INSIGHT_POLARITIES,
  INSIGHT_SEVERITIES,
  REVERSAL_WINDOW_MS,
  assessByRule,
  collectCloseFacts,
  computeRelevance,
  decideOutcome,
  isInactivityClose,
  needsClassifier,
  type CloseFacts,
  type InsightActionType,
  type InsightPolarity,
  type InsightSeverity,
  type OutcomeDecision,
} from "./outcome-rules";

const logger = createLogger("close-classifier");

export const MAX_ATTEMPTS = 3;
const LEASE_MS = 2 * 60 * 1000;
const RETRY_BACKOFF_MS = 60 * 1000;
const MAX_TRANSCRIPT_MESSAGES = 40;
const MAX_TRANSCRIPT_CHARS = 12_000;

/** Structured LLM output, validated before use. */
export interface ClassifierResponse {
  is_spam: boolean;
  had_real_request: boolean;
  ai_resolved: boolean;
  outcome_reason: string;
  summary: string;
  polarity: InsightPolarity;
  action_type: InsightActionType;
  severity: InsightSeverity;
  confidence: number;
  relevance: number;
  root_cause: string;
  area: string;
  snippet: string;
  paraphrase: string;
}

export const CLASSIFIER_JSON_SCHEMA = {
  type: "object",
  properties: {
    is_spam: { type: "boolean" },
    had_real_request: { type: "boolean" },
    ai_resolved: { type: "boolean" },
    outcome_reason: { type: "string" },
    summary: { type: "string" },
    polarity: { type: "string", enum: [...INSIGHT_POLARITIES] },
    action_type: { type: "string", enum: [...INSIGHT_ACTION_TYPES] },
    severity: { type: "string", enum: [...INSIGHT_SEVERITIES] },
    confidence: { type: "number" },
    relevance: { type: "number" },
    root_cause: { type: "string" },
    area: { type: "string" },
    snippet: { type: "string" },
    paraphrase: { type: "string" },
  },
  required: [
    "is_spam",
    "had_real_request",
    "ai_resolved",
    "outcome_reason",
    "summary",
    "polarity",
    "action_type",
    "severity",
    "confidence",
    "relevance",
    "root_cause",
    "area",
    "snippet",
    "paraphrase",
  ],
  additionalProperties: false,
} as const;

function pick<T extends string>(value: unknown, allowed: ReadonlyArray<T>, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function clean(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = redactString(value.trim()).slice(0, maxLength);
  return text.length > 0 ? text : null;
}

/** Parse and validate the model's JSON. Throws on anything unusable so the row is retried. */
export function parseClassifierResponse(raw: string): ClassifierResponse {
  const data = JSON.parse(raw) as Record<string, unknown>;
  for (const key of ["is_spam", "had_real_request", "ai_resolved"]) {
    if (typeof data[key] !== "boolean") {
      throw new Error(`Classifier response field ${key} is not a boolean`);
    }
  }
  const confidence = Number(data.confidence);
  const relevance = Number(data.relevance);
  return {
    is_spam: data.is_spam as boolean,
    had_real_request: data.had_real_request as boolean,
    ai_resolved: data.ai_resolved as boolean,
    outcome_reason: String(data.outcome_reason ?? ""),
    summary: String(data.summary ?? ""),
    polarity: pick(data.polarity, INSIGHT_POLARITIES, "neutral"),
    action_type: pick(data.action_type, INSIGHT_ACTION_TYPES, "none"),
    severity: pick(data.severity, INSIGHT_SEVERITIES, "low"),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    relevance: Number.isFinite(relevance) ? relevance : 0,
    root_cause: String(data.root_cause ?? ""),
    area: String(data.area ?? ""),
    snippet: String(data.snippet ?? ""),
    paraphrase: String(data.paraphrase ?? ""),
  };
}

/** Customer, AI and human lines only, most recent last, capped in size. */
export function buildTranscript(messages: Message[]): string {
  const labels: Partial<Record<string, string>> = {
    [MessageType.CUSTOMER]: "Customer",
    [MessageType.BOT_AGENT]: "AI",
    [MessageType.HUMAN_AGENT]: "Human agent",
  };
  const lines = messages
    .filter((m) => labels[m.type] && m.content?.trim())
    .slice(-MAX_TRANSCRIPT_MESSAGES)
    .map((m) => `${labels[m.type]}: ${m.content.trim()}`);
  let transcript = lines.join("\n");
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    transcript = transcript.slice(transcript.length - MAX_TRANSCRIPT_CHARS);
  }
  return transcript;
}

export class CloseClassifierService {
  private llmService = new LLMService();
  private promptService = PromptService.getInstance();

  private get outcomes() {
    return AppDataSource.getRepository(ConversationOutcome);
  }

  /**
   * Record a close. Called by the conversation repository on the transition
   * into a closed status, with the updated conversation and its messages.
   * Never throws: a failure here must not fail the close itself.
   */
  async recordClose(conversation: Conversation, messages: Message[]): Promise<void> {
    try {
      const facts = collectCloseFacts(conversation, messages);
      const decision = decideOutcome(facts, assessByRule(facts));
      await this.outcomes
        .createQueryBuilder()
        .insert()
        .into(ConversationOutcome)
        .values({
          organization_id: conversation.organization_id,
          conversation_id: conversation.id,
          closed_at: new Date(),
          close_status: conversation.status,
          close_reason: facts.closeReason,
          outcome: decision.outcome,
          billable: decision.billable,
          ai_resolved: decision.aiResolved,
          handed_off: facts.handedOff,
          classified_by: "rule",
          classified_at: null,
        })
        .orIgnore()
        .execute();
    } catch (error) {
      logger.error(
        {
          err: error,
          conversationId: conversation.id,
          organizationId: conversation.organization_id,
        },
        "Failed to record conversation close",
      );
    }
  }

  /**
   * The shopper is back: reverse closes of this conversation, or of this
   * customer's other conversations, from the last REVERSAL_WINDOW_MS.
   * Non-billable rows are marked too (harmless); the classifier may still
   * turn a pending row billable, and it must stay reversed.
   */
  async reverseOnCustomerReturn(params: {
    organizationId: string;
    conversationId: string;
    customerId: string | null;
    at?: Date;
  }): Promise<number> {
    const at = params.at ?? new Date();
    const windowStart = new Date(at.getTime() - REVERSAL_WINDOW_MS);
    const [, affected]: [unknown, number] = await AppDataSource.query(
      `UPDATE conversation_outcomes o
       SET reversed_at = $5,
           reversal_reason = CASE WHEN o.conversation_id = $2
             THEN 'shopper_returned' ELSE 'shopper_returned_new_conversation' END,
           updated_at = now()
       WHERE o.organization_id = $1
         AND o.reversed_at IS NULL
         AND o.closed_at >= $4
         AND o.closed_at < $5
         AND (
           o.conversation_id = $2
           OR ($3::uuid IS NOT NULL AND o.conversation_id IN (
             SELECT c.id FROM conversations c
             WHERE c.organization_id = $1 AND c.customer_id = $3::uuid AND c.id <> $2
           ))
         )`,
      [params.organizationId, params.conversationId, params.customerId, windowStart, at],
    );
    if (affected > 0) {
      logger.info(
        { organizationId: params.organizationId, conversationId: params.conversationId, affected },
        "Shopper returned within the reversal window; resolutions reversed",
      );
    }
    return affected;
  }

  /** Lease and classify up to `limit` pending closes. Returns how many were processed. */
  async processPending(limit = 5): Promise<number> {
    const [rows]: [Array<{ id: string; attempts: number }>, number] = await AppDataSource.query(
      `UPDATE conversation_outcomes
       SET claimed_until = now() + ($2 || ' milliseconds')::interval,
           attempts = attempts + 1,
           updated_at = now()
       WHERE id IN (
         SELECT id FROM conversation_outcomes
         WHERE classified_at IS NULL
           AND (claimed_until IS NULL OR claimed_until < now())
         ORDER BY created_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, attempts`,
      [limit, String(LEASE_MS)],
    );
    if (!rows || rows.length === 0) return 0;
    await Promise.allSettled(rows.map((row) => this.classify(row.id, row.attempts)));
    return rows.length;
  }

  /** Classify one leased row. Exposed for tests; normal callers use processPending. */
  async classify(outcomeId: string, attempt: number): Promise<void> {
    const row = await this.outcomes.findOneBy({ id: outcomeId });
    if (!row || row.classified_at) return;
    const log = logger.child({
      organizationId: row.organization_id,
      conversationId: row.conversation_id,
      outcomeId,
    });

    const conversation = row.conversation_id
      ? await AppDataSource.getRepository(Conversation).findOneBy({ id: row.conversation_id })
      : null;
    if (!conversation) {
      await this.finalizeWithRule(row, null, "conversation_deleted");
      return;
    }

    // All messages, even ones after a reopen: classification runs seconds
    // after the close, and a shopper who came back that fast has already
    // reversed the charge. (messages.created_at is timestamp without time
    // zone, so comparing it with closed_at would also be time-zone fragile.)
    const messages = await AppDataSource.getRepository(Message).find({
      where: { conversation_id: conversation.id },
      order: { created_at: "ASC" },
    });

    // Facts as of the close: the snapshot on the row beats the live row,
    // which may have been reopened and handed off since.
    const facts: CloseFacts = {
      ...collectCloseFacts(conversation, messages),
      closeReason: row.close_reason,
      handedOff: row.handed_off,
    };

    if (!needsClassifier(facts)) {
      await this.finalizeWithRule(
        row,
        conversation,
        null,
        decideOutcome(facts, assessByRule(facts)),
      );
      return;
    }

    try {
      const prompt = await this.promptService.getPrompt(
        "conversation/close-classification",
        {
          transcript: buildTranscript(messages),
          closeReason: row.close_reason ?? `closed by staff (${row.close_status})`,
          handedOff: row.handed_off ? "yes" : "no",
          channel: conversation.channel,
        },
        // Owner's language, not the shopper's: the QA text is read by the owner.
        { organizationId: row.organization_id },
      );
      const result = await this.llmService.invokeWithMeta<string>({
        prompt,
        jsonSchema: CLASSIFIER_JSON_SCHEMA,
        // A billing decision over a transcript: not "easy", no tools needed.
        tier: "medium",
        temperature: 0,
        max_tokens: 1200,
        organizationId: row.organization_id,
      });
      const response = parseClassifierResponse(result.content);
      const decision = decideOutcome(facts, {
        isSpam: response.is_spam,
        hadRealRequest: response.had_real_request,
        aiResolved: response.ai_resolved,
      });
      await this.writeClassification(row, conversation, decision, response, {
        model: result.model,
        usage: result.usage as unknown as Record<string, unknown>,
      });
      log.debug({ outcome: decision.outcome, billable: decision.billable }, "Classified close");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= MAX_ATTEMPTS) {
        log.warn({ err: error, attempt }, "Close classifier gave up; keeping the rule outcome");
        await this.finalizeWithRule(row, conversation, message);
        return;
      }
      log.warn({ err: error, attempt }, "Close classifier failed; will retry");
      await this.outcomes.update(
        { id: row.id },
        {
          last_error: message.slice(0, 2000),
          claimed_until: new Date(Date.now() + RETRY_BACKOFF_MS * attempt),
        },
      );
    }
  }

  /** Keep (or set) the rule outcome and stop retrying. */
  private async finalizeWithRule(
    row: ConversationOutcome,
    conversation: Conversation | null,
    error: string | null,
    decision?: OutcomeDecision,
  ): Promise<void> {
    const update: QueryDeepPartialEntity<ConversationOutcome> = {
      classified_at: new Date(),
      classified_by: "rule",
      claimed_until: null,
      last_error: error ? error.slice(0, 2000) : null,
    };
    if (decision) {
      update.outcome = decision.outcome;
      update.billable = decision.billable;
      update.ai_resolved = decision.aiResolved;
    }
    const result = await this.outcomes
      .createQueryBuilder()
      .update(ConversationOutcome)
      .set(update)
      .where("id = :id AND classified_at IS NULL", { id: row.id })
      .execute();
    if ((result.affected ?? 0) > 0 && conversation) {
      await this.settleStatus(row, conversation, decision?.billable ?? row.billable);
    }
  }

  private async writeClassification(
    row: ConversationOutcome,
    conversation: Conversation,
    decision: OutcomeDecision,
    response: ClassifierResponse,
    llm: { model: string; usage: Record<string, unknown> },
  ): Promise<void> {
    const written = await AppDataSource.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(ConversationOutcome)
        .set({
          outcome: decision.outcome,
          billable: decision.billable,
          ai_resolved: decision.aiResolved,
          classified_by: "llm",
          classification_reason: clean(response.outcome_reason, 500),
          classified_at: new Date(),
          claimed_until: null,
          last_error: null,
          llm_model: llm.model.slice(0, 128),
          llm_usage: llm.usage,
        })
        .where("id = :id AND classified_at IS NULL", { id: row.id })
        .execute();
      if ((result.affected ?? 0) === 0) return false;

      // Test and spam never reach here (no LLM call for them) except spam the
      // model found; a spam review is noise for the owner.
      if (decision.outcome !== "spam") {
        await manager
          .getRepository(InsightIssue)
          .createQueryBuilder()
          .insert()
          .values({
            organization_id: row.organization_id,
            source: "ai_review",
            conversation_id: conversation.id,
            conversation_outcome_id: row.id,
            polarity: response.polarity,
            action_type: response.action_type,
            severity: response.severity,
            confidence: response.confidence,
            relevance: computeRelevance(response.relevance, {
              handedOff: row.handed_off,
              actionType: response.action_type,
            }),
            summary: clean(response.summary, 1000) ?? "",
            root_cause: clean(response.root_cause, 500),
            area: clean(response.area, 64),
            snippet: clean(response.snippet, 300),
            paraphrase: clean(response.paraphrase, 500),
            signals: {
              outcome: decision.outcome,
              billable: decision.billable,
              aiResolved: decision.aiResolved,
              handedOff: row.handed_off,
              closeReason: row.close_reason,
              closeStatus: row.close_status,
              channel: conversation.channel,
              playbookId: conversation.playbook_id,
              playbookVersionId: conversation.playbook_version_id,
              agentId: conversation.agent_id,
            },
          })
          .orIgnore()
          .execute();
      } else if (!conversation.spam_flagged_at) {
        await manager.update(
          Conversation,
          { id: conversation.id, spam_flagged_at: IsNull() },
          { spam_flagged_at: new Date(), spam_reason: "close_classifier" },
        );
      }
      return true;
    });

    if (written) await this.settleStatus(row, conversation, decision.billable);
  }

  /**
   * An inactivity close the classifier did not bill was not a resolution:
   * move it from `resolved` to `unresolved` (D5-5). Only if the conversation
   * is still in the state this close left it in, so a reopened chat is never
   * closed again by mistake.
   */
  private async settleStatus(
    row: ConversationOutcome,
    conversation: Conversation,
    billable: boolean,
  ): Promise<void> {
    if (billable || row.close_status !== "resolved" || !isInactivityClose(row.close_reason)) {
      return;
    }
    const result = await AppDataSource.getRepository(Conversation)
      .createQueryBuilder()
      .update(Conversation)
      .set({ status: "unresolved" })
      .where("id = :id AND status = 'resolved'", { id: conversation.id })
      .execute();
    if ((result.affected ?? 0) === 0) return;

    try {
      const updated = await AppDataSource.getRepository(Conversation).findOneBy({
        id: conversation.id,
      });
      if (updated) {
        const { conversationEventsService } = await import("../conversation-events.service");
        await conversationEventsService.broadcastConversationUpdated(updated, ["status"]);
      }
    } catch (error) {
      logger.warn({ err: error, conversationId: conversation.id }, "Status broadcast failed");
    }
  }
}

export const closeClassifierService = new CloseClassifierService();
