import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from "typeorm";

/** Which rung of the alert ladder a row records (D11-8). */
export type NotificationStep = "initial" | "repush" | "email";
export type NotificationChannel = "push" | "email";
/**
 * - pending: claimed, being sent
 * - sent: at least one device / the mail server accepted it
 * - failed: every attempt failed
 * - no_device: push step for a recipient with no opted-in device (or push not configured)
 */
export type NotificationStatus = "pending" | "sent" | "failed" | "no_device";

/**
 * One alert step for one recipient about a conversation waiting for a human.
 * `cycle_started_at` is when the conversation entered pending-human; a new
 * hand-off starts a new cycle. Unique per (conversation, cycle, step, user) so
 * a step is claimed (inserted) before it is sent, and never sent twice.
 */
@Entity("notification_deliveries")
@Unique("uq_notification_deliveries_step", [
  "conversation_id",
  "cycle_started_at",
  "step",
  "user_id",
])
@Index("idx_notification_deliveries_org_created", ["organization_id", "created_at"])
export class NotificationDelivery {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  organization_id!: string;

  @Column({ type: "uuid" })
  conversation_id!: string;

  @Column({ type: "uuid" })
  user_id!: string;

  @Column({ type: "timestamptz" })
  cycle_started_at!: Date;

  @Column({ type: "varchar", length: 16 })
  step!: NotificationStep;

  @Column({ type: "varchar", length: 16 })
  channel!: NotificationChannel;

  @Column({ type: "varchar", length: 16 })
  status!: NotificationStatus;

  /** Failure reason or device counts, for debugging. */
  @Column({ type: "text", nullable: true })
  detail!: string | null;

  @Column({ type: "timestamptz", nullable: true })
  sent_at!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updated_at!: Date;
}
