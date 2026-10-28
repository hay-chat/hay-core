import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from "typeorm";

/**
 * - success: the tool ran and returned a result
 * - error: the tool ran (or tried to) and failed; see error_code
 * - simulated: dry-run; the write was not sent, a mock came back
 * - held: a write was stopped and is waiting for a person's approval
 * - confirming: the AI was told to ask the shopper first; nothing ran (D4-10)
 */
export type ActionOutcome = "success" | "error" | "simulated" | "held" | "confirming";

/**
 * One row per tool call the AI (or an approved pending action) makes (D6-5).
 * The audit trail for "what did the AI do to my store": args are redacted
 * before they are stored, and outputs are not stored at all.
 */
@Entity("action_log")
@Index("idx_action_log_org_created", ["organization_id", "created_at"])
@Index("idx_action_log_conversation", ["conversation_id"])
export class ActionLog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  organization_id!: string;

  @Column({ type: "uuid" })
  conversation_id!: string;

  /** The TOOL message in the thread, when there is one. */
  @Column({ type: "uuid", nullable: true })
  message_id!: string | null;

  /** Null for core (built-in) tools. */
  @Column({ type: "varchar", length: 255, nullable: true })
  plugin_id!: string | null;

  @Column({ type: "varchar", length: 255 })
  tool_name!: string;

  /** Write category from the tool's risk class; null for reads. */
  @Column({ type: "varchar", length: 32, nullable: true })
  category!: string | null;

  @Column({ type: "boolean" })
  read_only!: boolean;

  @Column({ type: "jsonb", default: () => "'{}'" })
  args!: Record<string, unknown>;

  @Column({ type: "varchar", length: 16 })
  outcome!: ActionOutcome;

  /** A code from @hay/plugin-sdk/tool-errors, or INTERNAL. */
  @Column({ type: "varchar", length: 32, nullable: true })
  error_code!: string | null;

  @Column({ type: "integer", default: 0 })
  duration_ms!: number;

  @Column({ type: "varchar", length: 64, nullable: true })
  idempotency_key!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  created_at!: Date;
}
