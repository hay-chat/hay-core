/**
 * Feedback → insight issues (D3-9).
 *
 * 1. `createPendingIssue` runs in the same transaction as the
 *    `message_feedback` insert: every rating becomes one insight issue
 *    (`source = user_feedback`, unique on the feedback id) with the polarity
 *    from the rating, the redacted staff comment and a redacted excerpt of the
 *    rated reply. `enriched_at` is NULL: pending.
 * 2. The `insight-feedback-enrichment` scheduled job calls `enrichPending`,
 *    which leases pending issues (FOR UPDATE SKIP LOCKED + a claim deadline)
 *    and makes one easy-tier structured call per issue over the rated reply,
 *    the conversation before it, the rating and the comment. It fills
 *    `detail`, the action, the scores and the paraphrase. After MAX_ATTEMPTS
 *    failures the issue is finalized as-is (still counted, `detail` NULL), so
 *    a rating never disappears from Insights.
 *
 * The backfill script (`npm run insights:backfill-feedback`) calls
 * `backfillMissing` for ratings saved before this existed.
 */
import type { EntityManager } from "typeorm";
import { AppDataSource } from "@server/database/data-source";
import { InsightIssue } from "@server/database/entities/insight-issue.entity";
import { MessageFeedback } from "@server/database/entities/message-feedback.entity";
import { Message } from "@server/database/entities/message.entity";
import { Conversation } from "@server/database/entities/conversation.entity";
import { LLMService } from "@server/services/core/llm.service";
import { PromptService } from "@server/services/prompt.service";
import { createLogger } from "@server/lib/logger";
import { insightRunsService } from "./insight-runs.service";
import { FeedbackRating } from "@server/types/message-feedback.types";
import {
  INSIGHT_ACTION_TYPES,
  INSIGHT_SEVERITIES,
  computeRelevance,
  type InsightPolarity,
} from "@server/services/close-classification/outcome-rules";
import {
  buildTranscript,
  redactInsightText,
} from "@server/services/close-classification/close-classifier.service";

const logger = createLogger("feedback-insights");

export const ENRICH_MAX_ATTEMPTS = 3;
const LEASE_MS = 2 * 60 * 1000;
const RETRY_BACKOFF_MS = 60 * 1000;
/** Messages of context before the rated reply. */
const CONTEXT_MESSAGES = 12;

const POLARITY_BY_RATING: Record<FeedbackRating, InsightPolarity> = {
  [FeedbackRating.GOOD]: "positive",
  [FeedbackRating.BAD]: "negative",
  [FeedbackRating.NEUTRAL]: "neutral",
};

export const FEEDBACK_ENRICHMENT_JSON_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    detail: { type: "string" },
    action_type: { type: "string", enum: [...INSIGHT_ACTION_TYPES] },
    severity: { type: "string", enum: [...INSIGHT_SEVERITIES] },
    confidence: { type: "number" },
    relevance: { type: "number" },
    root_cause: { type: "string" },
    area: { type: "string" },
    paraphrase: { type: "string" },
  },
  required: [
    "summary",
    "detail",
    "action_type",
    "severity",
    "confidence",
    "relevance",
    "root_cause",
    "area",
    "paraphrase",
  ],
  additionalProperties: false,
} as const;

export interface EnrichmentRunResult {
  organizationId: string;
  model: string | null;
  usage: Record<string, unknown> | null;
  durationMs: number;
  succeeded: boolean;
}

/** The rated message and its conversation, only if both belong to the organization. */
export async function findRatedMessage(
  organizationId: string,
  messageId: string,
  manager: EntityManager = AppDataSource.manager,
): Promise<{ message: Message; conversation: Conversation } | null> {
  const message = await manager.getRepository(Message).findOneBy({ id: messageId });
  if (!message) return null;
  const conversation = await manager
    .getRepository(Conversation)
    .findOneBy({ id: message.conversation_id, organization_id: organizationId });
  return conversation ? { message, conversation } : null;
}

export class FeedbackInsightService {
  private llmService = new LLMService();

  /** Insert the pending issue for a feedback row. Idempotent (unique feedback id). */
  async createPendingIssue(
    feedback: MessageFeedback,
    rated: { message: Message; conversation: Conversation },
    manager: EntityManager = AppDataSource.manager,
  ): Promise<void> {
    const { message, conversation } = rated;
    const negative = feedback.rating === FeedbackRating.BAD;
    await manager
      .getRepository(InsightIssue)
      .createQueryBuilder()
      .insert()
      .values({
        organization_id: feedback.organizationId,
        source: "user_feedback",
        conversation_id: conversation.id,
        message_id: message.id,
        message_feedback_id: feedback.id,
        polarity: POLARITY_BY_RATING[feedback.rating] ?? "neutral",
        action_type: "none",
        severity: negative ? "medium" : "low",
        confidence: 0,
        relevance: computeRelevance(0, {
          handedOff: false,
          actionType: "none",
          negativeFeedback: negative,
        }),
        summary: redactInsightText(feedback.comment, 1000) ?? "",
        snippet: redactInsightText(message.content, 300),
        enriched_at: null,
        signals: {
          rating: feedback.rating,
          hasComment: Boolean(feedback.comment?.trim()),
          messageType: message.type,
          channel: conversation.channel,
          playbookId: conversation.playbook_id,
          playbookVersionId: conversation.playbook_version_id,
          agentId: conversation.agent_id,
        },
      })
      .orIgnore()
      .execute();
  }

  /** Lease and enrich up to `limit` pending feedback issues. */
  async enrichPending(limit = 5): Promise<EnrichmentRunResult[]> {
    const [rows]: [Array<{ id: string; enrich_attempts: number }>, number] =
      await AppDataSource.query(
        `UPDATE insight_issues
         SET enrich_claimed_until = now() + ($2 || ' milliseconds')::interval,
             enrich_attempts = enrich_attempts + 1
         WHERE id IN (
           SELECT id FROM insight_issues
           WHERE enriched_at IS NULL
             AND source = 'user_feedback'
             AND (enrich_claimed_until IS NULL OR enrich_claimed_until < now())
           ORDER BY created_at ASC
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         RETURNING id, enrich_attempts`,
        [limit, String(LEASE_MS)],
      );
    if (!rows || rows.length === 0) return [];
    const settled = await Promise.allSettled(
      rows.map((row) => this.enrich(row.id, row.enrich_attempts)),
    );
    return settled.flatMap((s) => (s.status === "fulfilled" && s.value ? [s.value] : []));
  }

  /** Enrich one leased issue. Exposed for tests; normal callers use enrichPending. */
  async enrich(issueId: string, attempt: number): Promise<EnrichmentRunResult | null> {
    const issues = AppDataSource.getRepository(InsightIssue);
    const issue = await issues.findOneBy({ id: issueId });
    if (!issue || issue.enriched_at) return null;
    const startedAt = Date.now();
    const log = logger.child({ organizationId: issue.organization_id, issueId });

    const message = issue.message_id
      ? await AppDataSource.getRepository(Message).findOneBy({ id: issue.message_id })
      : null;
    if (!message) {
      // Retention removed the message before enrichment: keep what we have.
      await this.finalize(issue.id, "message_deleted");
      return null;
    }

    const feedback = issue.message_feedback_id
      ? await AppDataSource.getRepository(MessageFeedback).findOneBy({
          id: issue.message_feedback_id,
        })
      : null;
    const rating = String(issue.signals?.rating ?? feedback?.rating ?? FeedbackRating.NEUTRAL);
    const comment = redactInsightText(feedback?.comment, 2000) ?? "";

    try {
      const history = await AppDataSource.getRepository(Message).find({
        where: { conversation_id: message.conversation_id },
        order: { created_at: "ASC" },
      });
      const index = history.findIndex((m) => m.id === message.id);
      const before = history.slice(Math.max(0, index - CONTEXT_MESSAGES), Math.max(0, index));

      const prompt = await PromptService.getInstance().getPrompt(
        "insights/feedback-enrichment",
        {
          rating,
          comment,
          context: buildTranscript(before) || "(no earlier messages)",
          ratedReply: message.content?.trim() || "(empty)",
        },
        // The owner reads the result: their language, not the shopper's.
        { organizationId: issue.organization_id },
      );
      const result = await this.llmService.invokeWithMeta<string>({
        prompt,
        jsonSchema: FEEDBACK_ENRICHMENT_JSON_SCHEMA,
        tier: "easy",
        temperature: 0,
        max_tokens: 800,
        organizationId: issue.organization_id,
      });
      const parsed = parseEnrichmentResponse(result.content);
      const negative = rating === FeedbackRating.BAD;

      await issues
        .createQueryBuilder()
        .update(InsightIssue)
        .set({
          summary: redactInsightText(parsed.summary, 1000) ?? issue.summary,
          detail: redactInsightText(parsed.detail, 1500),
          action_type: parsed.action_type,
          severity: parsed.severity,
          confidence: parsed.confidence,
          relevance: computeRelevance(parsed.relevance, {
            handedOff: false,
            actionType: parsed.action_type,
            negativeFeedback: negative,
          }),
          root_cause: redactInsightText(parsed.root_cause, 500),
          area: redactInsightText(parsed.area, 64),
          paraphrase: redactInsightText(parsed.paraphrase, 500),
          enriched_at: new Date(),
          enrich_claimed_until: null,
          enrich_last_error: null,
        })
        .where("id = :id AND enriched_at IS NULL", { id: issue.id })
        .execute();
      await insightRunsService.record({
        organizationId: issue.organization_id,
        kind: "feedback_enrichment",
        model: result.model,
        usage: result.usage,
        durationMs: Date.now() - startedAt,
        succeeded: true,
      });
      return {
        organizationId: issue.organization_id,
        model: result.model,
        usage: result.usage as unknown as Record<string, unknown>,
        durationMs: Date.now() - startedAt,
        succeeded: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= ENRICH_MAX_ATTEMPTS) {
        log.warn({ err: error, attempt }, "Feedback enrichment gave up; keeping the bare issue");
        await this.finalize(issue.id, message);
      } else {
        log.warn({ err: error, attempt }, "Feedback enrichment failed; will retry");
        await issues.update(
          { id: issue.id },
          {
            enrich_last_error: message.slice(0, 2000),
            enrich_claimed_until: new Date(Date.now() + RETRY_BACKOFF_MS * attempt),
          },
        );
      }
      await insightRunsService.record({
        organizationId: issue.organization_id,
        kind: "feedback_enrichment",
        model: null,
        usage: null,
        durationMs: Date.now() - startedAt,
        succeeded: false,
      });
      return {
        organizationId: issue.organization_id,
        model: null,
        usage: null,
        durationMs: Date.now() - startedAt,
        succeeded: false,
      };
    }
  }

  /** Stop retrying: the issue counts with its rating, comment and excerpt only. */
  private async finalize(issueId: string, error: string): Promise<void> {
    await AppDataSource.getRepository(InsightIssue)
      .createQueryBuilder()
      .update(InsightIssue)
      .set({
        enriched_at: new Date(),
        enrich_claimed_until: null,
        enrich_last_error: error.slice(0, 2000),
      })
      .where("id = :id AND enriched_at IS NULL", { id: issueId })
      .execute();
  }

  /**
   * Create the missing issue for every feedback row saved before D3-9 (or
   * whose issue insert was lost). Safe to run again. Returns how many issues
   * were created.
   */
  async backfillMissing(options: { organizationId?: string; batchSize?: number } = {}) {
    const batchSize = options.batchSize ?? 200;
    let created = 0;
    const skippedIds: string[] = [];
    for (;;) {
      const rows: Array<{ id: string }> = await AppDataSource.query(
        `SELECT f.id FROM message_feedback f
         WHERE NOT EXISTS (SELECT 1 FROM insight_issues i WHERE i.message_feedback_id = f.id)
           AND ($1::uuid IS NULL OR f.organization_id = $1::uuid)
           AND f.id <> ALL($3::uuid[])
         ORDER BY f.created_at ASC
         LIMIT $2`,
        [options.organizationId ?? null, batchSize, skippedIds],
      );
      if (rows.length === 0) break;
      for (const { id } of rows) {
        const feedback = await AppDataSource.getRepository(MessageFeedback).findOneBy({ id });
        const rated = feedback
          ? await findRatedMessage(feedback.organizationId, feedback.messageId)
          : null;
        if (!feedback || !rated) {
          // A rating of a message outside its organization: never turned into an issue.
          skippedIds.push(id);
          continue;
        }
        await this.createPendingIssue(feedback, rated);
        created++;
      }
    }
    return { created, skipped: skippedIds.length };
  }
}

/** Parse and validate the enrichment JSON; throws on anything unusable so it is retried. */
export function parseEnrichmentResponse(raw: string) {
  const data = JSON.parse(raw) as Record<string, unknown>;
  if (typeof data.summary !== "string" || typeof data.detail !== "string") {
    throw new Error("Feedback enrichment response is missing summary or detail");
  }
  const confidence = Number(data.confidence);
  const relevance = Number(data.relevance);
  const actionType = INSIGHT_ACTION_TYPES.find((value) => value === data.action_type) ?? "none";
  const severity = INSIGHT_SEVERITIES.find((value) => value === data.severity) ?? "low";
  return {
    summary: data.summary,
    detail: data.detail,
    action_type: actionType,
    severity,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    relevance: Number.isFinite(relevance) ? relevance : 0,
    root_cause: String(data.root_cause ?? ""),
    area: String(data.area ?? ""),
    paraphrase: String(data.paraphrase ?? ""),
  };
}

export const feedbackInsightService = new FeedbackInsightService();
