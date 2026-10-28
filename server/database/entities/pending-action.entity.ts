import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

/**
 * - pending: held, waiting for a person to decide
 * - approved: a person approved it; execution is claimed by whoever approved
 * - executed: approved and the tool ran successfully
 * - failed: approved but re-validation or the tool call failed
 * - rejected: a person declined it
 * - expired: nobody decided in time; the conversation went to a person
 */
export type PendingActionStatus =
  | "pending"
  | "approved"
  | "executed"
  | "failed"
  | "rejected"
  | "expired";

/**
 * Why the call was held: by the policy gate (money_move, category_policy = a
 * non-money category the org requires approval for, playbook_policy = the
 * active playbook requires it, unclassified_write, destructive_write = a
 * delete or account configuration change), or because a cap-enforcing
 * plugin refused it as above the merchant's cap (over_cap).
 */
export type PendingActionHoldReason =
  | "money_move"
  | "category_policy"
  | "playbook_policy"
  | "unclassified_write"
  | "destructive_write"
  | "over_cap";

/**
 * A write tool call held for human approval (D4-3). Status moves only forward,
 * through conditional UPDATEs, so two people approving at once execute it once.
 * The idempotency key is generated when the call is held and is the one sent to
 * the tool on execution, so a retried execution is deduplicated by the provider.
 */
@Entity("pending_actions")
@Index("idx_pending_actions_org_status", ["organization_id", "status"])
@Index("idx_pending_actions_conversation", ["conversation_id"])
export class PendingAction {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  organization_id!: string;

  @Column({ type: "uuid" })
  conversation_id!: string;

  /** The TOOL message in the thread that shows this action. */
  @Column({ type: "uuid", nullable: true })
  message_id!: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  plugin_id!: string | null;

  /** Full tool name as the AI called it (`pluginId:toolName`). */
  @Column({ type: "varchar", length: 255 })
  tool_name!: string;

  @Column({ type: "varchar", length: 32 })
  category!: string;

  /** Args exactly as the AI sent them; executed as-is on approval. */
  @Column({ type: "jsonb", default: () => "'{}'" })
  args!: Record<string, unknown>;

  /** Money amount found in the args, when there is one. */
  @Column({
    type: "numeric",
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: {
      to: (value: number | null | undefined) => value ?? null,
      from: (value: string | null) => (value === null ? null : Number(value)),
    },
  })
  amount!: number | null;

  @Column({ type: "varchar", length: 32 })
  hold_reason!: PendingActionHoldReason;

  @Column({ type: "varchar", length: 16, default: "pending" })
  status!: PendingActionStatus;

  @Column({ type: "varchar", length: 64, unique: true })
  idempotency_key!: string;

  @Column({ type: "timestamptz" })
  expires_at!: Date;

  @Column({ type: "uuid", nullable: true })
  decided_by!: string | null;

  @Column({ type: "timestamptz", nullable: true })
  decided_at!: Date | null;

  /** Rejection reason, or why execution failed. */
  @Column({ type: "text", nullable: true })
  decision_note!: string | null;

  @Column({ type: "varchar", length: 32, nullable: true })
  error_code!: string | null;

  @Column({ type: "timestamptz", nullable: true })
  executed_at!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updated_at!: Date;
}
