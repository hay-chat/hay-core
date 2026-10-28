import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from "typeorm";
import type { ConversationOutcomeKind } from "../../services/close-classification/outcome-rules";

export type ResolutionExclusionStatus = "excluded" | "pending_review";

/**
 * One row per close of a conversation (D1-3): the billing outcome, written at
 * close by a rule and refined by the close classifier. The billable count
 * reads this table, by `closed_at`, so deleting or reopening a conversation
 * no longer rewrites past bills.
 *
 * `conversation_id` is SET NULL on delete so a billed resolution survives a
 * hard delete of its conversation.
 */
@Entity("conversation_outcomes")
@Index("idx_conversation_outcomes_org_closed_at", ["organization_id", "closed_at"])
@Index("idx_conversation_outcomes_pending", ["created_at"], { where: `"classified_at" IS NULL` })
@Unique("uq_conversation_outcomes_conversation_closed_at", ["conversation_id", "closed_at"])
export class ConversationOutcome {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  organization_id!: string;

  @Column({ type: "uuid", nullable: true })
  conversation_id!: string | null;

  /** When the conversation entered a closed status; the billing timestamp. */
  @Column({ type: "timestamptz" })
  closed_at!: Date;

  /** Status the conversation closed with (resolved, unresolved or closed). */
  @Column({ type: "varchar", length: 32 })
  close_status!: string;

  /** resolution_metadata.reason at close (e.g. inactivity_timeout), or null for staff closes. */
  @Column({ type: "varchar", length: 64, nullable: true })
  close_reason!: string | null;

  @Column({ type: "varchar", length: 32 })
  outcome!: ConversationOutcomeKind;

  @Column({ type: "boolean" })
  billable!: boolean;

  @Column({ type: "boolean" })
  ai_resolved!: boolean;

  @Column({ type: "boolean" })
  handed_off!: boolean;

  /** rule (deterministic, also the LLM-failure default), llm, backfill, or staff (marked spam). */
  @Column({ type: "varchar", length: 16 })
  classified_by!: "rule" | "llm" | "backfill" | "staff";

  /** Short PII-free explanation from the classifier. */
  @Column({ type: "text", nullable: true })
  classification_reason!: string | null;

  /** Null while the LLM classification is pending. */
  @Column({ type: "timestamptz", nullable: true })
  classified_at!: Date | null;

  @Column({ type: "int", default: 0 })
  attempts!: number;

  /** Lease for the worker that claimed this row; also the retry backoff. */
  @Column({ type: "timestamptz", nullable: true })
  claimed_until!: Date | null;

  @Column({ type: "text", nullable: true })
  last_error!: string | null;

  /** Set when the shopper came back within the reversal window. */
  @Column({ type: "timestamptz", nullable: true })
  reversed_at!: Date | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  reversal_reason!: string | null;

  /**
   * Merchant exclusion (D1-6). `excluded` drops the row from the billable
   * count (`excluded_at` set); `pending_review` was over the self-serve
   * allowance and waits for Hay.chat, still billed.
   */
  @Column({ type: "varchar", length: 16, nullable: true })
  exclusion_status!: ResolutionExclusionStatus | null;

  @Column({ type: "text", nullable: true })
  exclusion_reason!: string | null;

  @Column({ type: "uuid", nullable: true })
  exclusion_requested_by!: string | null;

  @Column({ type: "timestamptz", nullable: true })
  exclusion_requested_at!: Date | null;

  /** When the exclusion took effect; null while pending review. */
  @Column({ type: "timestamptz", nullable: true })
  excluded_at!: Date | null;

  @Column({ type: "varchar", length: 128, nullable: true })
  llm_model!: string | null;

  /** Token usage of the classifier call, for per-org LLM cost tracking. */
  @Column({ type: "jsonb", nullable: true })
  llm_usage!: Record<string, unknown> | null;

  @CreateDateColumn({ type: "timestamptz" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updated_at!: Date;
}
