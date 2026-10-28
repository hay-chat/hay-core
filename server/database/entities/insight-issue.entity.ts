import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index, Unique } from "typeorm";
import type {
  InsightActionType,
  InsightPolarity,
  InsightSeverity,
  InsightSource,
} from "../../services/close-classification/outcome-rules";

/**
 * A QA event for the Insights engine: the unit that clustering (D3 phase 2)
 * groups into insights. Two sources write it:
 *
 * - `ai_review` (D3-8): the close classifier, one per classified close, in
 *   the same LLM call as the billing outcome. Written already enriched.
 * - `user_feedback` (D3-9): one per `message_feedback` row, inserted when
 *   the feedback is saved (`enriched_at` NULL), then analysed by the
 *   `insight-feedback-enrichment` job with one easy-tier call that fills
 *   `detail`, the action and the scores.
 *
 * Every text field is PII-redacted (the model is told to write `[redacted]`,
 * then the log redaction regexes run), so a row may outlive the
 * conversation's retention (Roger, D3 decision 8). Links to the
 * conversation, outcome, message and feedback are ON DELETE SET NULL; the
 * organization cascades. Columns: migrations 1785100000000 and 1785810000000.
 *
 * Embeddings live in `insight_issue_embeddings` (raw SQL, pgvector, one row
 * per enriched issue; see insight-embedding.service.ts). Consumers should
 * read only rows with `enriched_at IS NOT NULL`.
 */
@Entity("insight_issues")
@Index("idx_insight_issues_org_created_at", ["organization_id", "created_at"])
@Unique("uq_insight_issues_conversation_outcome", ["conversation_outcome_id"])
@Unique("uq_insight_issues_message_feedback", ["message_feedback_id"])
export class InsightIssue {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  organization_id!: string;

  @Column({ type: "varchar", length: 32 })
  source!: InsightSource;

  @Column({ type: "uuid", nullable: true })
  conversation_id!: string | null;

  /** The close this review belongs to; unique, which makes the write idempotent. */
  @Column({ type: "uuid", nullable: true })
  conversation_outcome_id!: string | null;

  /** user_feedback: the rated AI message. */
  @Column({ type: "uuid", nullable: true })
  message_id!: string | null;

  /** user_feedback: the feedback row; unique, which makes the write idempotent. */
  @Column({ type: "uuid", nullable: true })
  message_feedback_id!: string | null;

  @Column({ type: "varchar", length: 16 })
  polarity!: InsightPolarity;

  @Column({ type: "varchar", length: 32 })
  action_type!: InsightActionType;

  @Column({ type: "varchar", length: 16 })
  severity!: InsightSeverity;

  /** Model confidence, 0-1. */
  @Column({ type: "real" })
  confidence!: number;

  /** 0-100, model score plus signal weights (see computeRelevance). */
  @Column({ type: "int" })
  relevance!: number;

  @Column({ type: "text" })
  summary!: string;

  @Column({ type: "text", nullable: true })
  root_cause!: string | null;

  /** Short topic label, e.g. "shipping", "returns". */
  @Column({ type: "varchar", length: 64, nullable: true })
  area!: string | null;

  /** user_feedback: what went wrong (or right) in the rated reply, per the enrichment call. */
  @Column({ type: "text", nullable: true })
  detail!: string | null;

  /** Redacted verbatim excerpt (<= 300 chars). */
  @Column({ type: "text", nullable: true })
  snippet!: string | null;

  @Column({ type: "text", nullable: true })
  paraphrase!: string | null;

  /**
   * Context for the engine. ai_review: outcome, hand-off, channel, playbook at
   * close. user_feedback: rating, channel, playbook of the conversation.
   */
  @Column({ type: "jsonb", nullable: true })
  signals!: Record<string, string | number | boolean | null> | null;

  /** NULL while the issue waits for enrichment; set once it is analysed. */
  @Column({ type: "timestamptz", nullable: true })
  enriched_at!: Date | null;

  @Column({ type: "int", default: 0 })
  enrich_attempts!: number;

  /** Enrichment lease (FOR UPDATE SKIP LOCKED + this deadline). */
  @Column({ type: "timestamptz", nullable: true })
  enrich_claimed_until!: Date | null;

  @Column({ type: "text", nullable: true })
  enrich_last_error!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  created_at!: Date;
}
