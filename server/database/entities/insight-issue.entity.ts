import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index, Unique } from "typeorm";
import type {
  InsightActionType,
  InsightPolarity,
  InsightSeverity,
} from "../../services/close-classification/outcome-rules";

/**
 * A QA event for the Insights engine (D3-8). The close classifier writes one
 * per classified close (`source = ai_review`); feedback and docs-audit
 * sources come later. Text fields are PII-redacted, so a row may outlive the
 * conversation's retention (Roger, D3 decision 8). All links are SET NULL.
 *
 * Embeddings and clustering are the Insights engine's job (D3 phase 2).
 */
@Entity("insight_issues")
@Index("idx_insight_issues_org_created_at", ["organization_id", "created_at"])
@Unique("uq_insight_issues_conversation_outcome", ["conversation_outcome_id"])
export class InsightIssue {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  organization_id!: string;

  @Column({ type: "varchar", length: 32 })
  source!: "ai_review";

  @Column({ type: "uuid", nullable: true })
  conversation_id!: string | null;

  /** The close this review belongs to; unique, which makes the write idempotent. */
  @Column({ type: "uuid", nullable: true })
  conversation_outcome_id!: string | null;

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

  /** Redacted verbatim excerpt (<= 300 chars). */
  @Column({ type: "text", nullable: true })
  snippet!: string | null;

  @Column({ type: "text", nullable: true })
  paraphrase!: string | null;

  /** Signals at close (outcome, hand-off, channel, playbook) for the engine. */
  @Column({ type: "jsonb", nullable: true })
  signals!: Record<string, string | number | boolean | null> | null;

  @CreateDateColumn({ type: "timestamptz" })
  created_at!: Date;
}
