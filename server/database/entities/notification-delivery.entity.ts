import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from "typeorm";

/**
 * Which alert a row records.
 * - initial / repush / email: the ladder of a hand-off to a person (D11-8).
 * - customer_reply: the shopper wrote in a conversation a person holds (D11-7).
 * - followup: another shopper message on a conversation already waiting (D11-7).
 * - unanswered / unanswered_email: a held conversation's last shopper message
 *   got no reply from a person for 10 minutes (D11-7); email only when the push
 *   reached no device.
 */
export type NotificationStep =
  | "initial"
  | "repush"
  | "email"
  | "customer_reply"
  | "followup"
  | "unanswered"
  | "unanswered_email";
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
 * `cycle_started_at` is when the conversation entered pending-human (a new
 * hand-off starts a new cycle); for shopper-message alerts it is the start of
 * the collapse window, and for "unanswered" the time of the unanswered message. Unique per (conversation, cycle, step, user) so
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
