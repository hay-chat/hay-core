import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

/**
 * - open: the shopper was told the AI is checking with the team; the T+5 / T+10
 *   timers run.
 * - timed_out: the shopper-facing wait ended (T+10, nobody reachable at T0, or
 *   the conversation was handed off another way). Still answerable: the answer
 *   is delivered late.
 * - answered: a teammate answered; `delivered_at` says when the shopper got it.
 * - dismissed: a teammate chose not to answer (an open one is handed off first).
 * - cancelled: someone took the conversation over; they answer it themselves.
 */
export const TEAM_QUESTION_STATUSES = [
  "open",
  "timed_out",
  "answered",
  "dismissed",
  "cancelled",
] as const;
export type TeamQuestionStatus = (typeof TEAM_QUESTION_STATUSES)[number];

/** Statuses a teammate can still answer. */
export const ANSWERABLE_TEAM_QUESTION_STATUSES: ReadonlyArray<TeamQuestionStatus> = [
  "open",
  "timed_out",
];

/** rephrase: the AI relays the answer in the shopper's words; verbatim: sent as written. */
export type TeamAnswerRelayMode = "rephrase" | "verbatim";

/**
 * A quick check (D19): a fact the AI could not answer, asked of the team
 * without handing the conversation off. At most one open question per
 * conversation (partial unique index).
 */
@Entity("team_questions")
@Index("idx_team_questions_org_status", ["organizationId", "status"])
@Index("idx_team_questions_conversation", ["conversationId"])
export class TeamQuestion {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  organizationId!: string;

  @Column({ type: "uuid" })
  conversationId!: string;

  /** The question for the team, written by the AI (or the shopper's own words). Untrusted text. */
  @Column({ type: "text" })
  question!: string;

  /** The shopper message that raised it, for context. Untrusted text. */
  @Column({ type: "text", nullable: true })
  customerMessage!: string | null;

  /** Shopper's language when asked (copy and relay). */
  @Column({ type: "varchar", length: 16, nullable: true })
  language!: string | null;

  @Column({ type: "varchar", length: 16, default: "open" })
  status!: TeamQuestionStatus;

  @Column({ type: "timestamptz" })
  askedAt!: Date;

  /** The T+5 "still checking" line went out (claimed before sending). */
  @Column({ type: "timestamptz", nullable: true })
  updateSentAt!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  timedOutAt!: Date | null;

  @Column({ type: "uuid", nullable: true })
  answeredBy!: string | null;

  @Column({ type: "text", nullable: true })
  answer!: string | null;

  @Column({ type: "timestamptz", nullable: true })
  answeredAt!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  deliveredAt!: Date | null;

  @Column({ type: "varchar", length: 16, nullable: true })
  relayMode!: TeamAnswerRelayMode | null;

  /** "Save to knowledge" (on by default); false = a one-off answer (D19-7). */
  @Column({ type: "boolean", default: true })
  saveToKnowledge!: boolean;

  /** Who dismissed it, or who took the conversation over (cancelled). */
  @Column({ type: "uuid", nullable: true })
  closedBy!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
