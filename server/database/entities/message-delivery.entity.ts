import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn, Index } from "typeorm";

/**
 * - pending: waiting for a consumer (first attempt or a retry).
 * - processing: claimed by one consumer.
 * - delivered: the provider accepted it, or there was nothing to send.
 * - failed: gave up.
 * - dead: gave up after every retry and the team has been told.
 */
export type MessageDeliveryStatus = "pending" | "processing" | "delivered" | "failed" | "dead";

export type MessageDeliveryKind = "message" | "escalation";

/**
 * One outbound call to a channel plugin. Only the consumer that claims the row
 * makes the call, however many server instances are running. For kind "message"
 * the id is the message id, so a message is queued at most once.
 */
@Entity("message_deliveries")
@Index("idx_message_deliveries_due", ["nextAttemptAt"], { where: `"status" = 'pending'` })
@Index("idx_message_deliveries_claimed", ["claimedAt"], { where: `"status" = 'processing'` })
@Index("idx_message_deliveries_conversation", ["conversationId", "createdAt"])
export class MessageDelivery {
  @PrimaryColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 20 })
  kind!: MessageDeliveryKind;

  @Column({ type: "uuid" })
  organizationId!: string;

  @Column({ type: "uuid" })
  conversationId!: string;

  @Column({ type: "varchar", length: 20, default: "pending" })
  status!: MessageDeliveryStatus;

  @Column({ type: "int", default: 0 })
  attempts!: number;

  @Column({ type: "timestamptz", default: () => "now()" })
  nextAttemptAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  claimedAt!: Date | null;

  @Column({ type: "text", nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
