import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from "typeorm";

export type OrderLinkSource = "tool_input" | "tool_output" | "message_text";

/**
 * A conversation that talked about an order (D2-4). The order index behind
 * the evidence pack: plugin tool calls and message text write these rows.
 * Unique per (conversation, plugin, order key, order label); see the migration.
 */
@Entity("order_conversation_links")
@Index("idx_order_conversation_links_org_key", ["organization_id", "order_key"])
@Index("idx_order_conversation_links_org_label", ["organization_id", "order_label"])
@Index("idx_order_conversation_links_conversation", ["conversation_id"])
export class OrderConversationLink {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  organization_id!: string;

  @Column({ type: "uuid" })
  conversation_id!: string;

  /** The message that named the order (first one seen). */
  @Column({ type: "uuid", nullable: true })
  message_id!: string | null;

  /** Plugin whose tool named the order; null when found in message text. */
  @Column({ type: "varchar", length: 255, nullable: true })
  plugin_id!: string | null;

  /** The platform's order id when known, else the order number. Lowercase, no "#". */
  @Column({ type: "varchar", length: 64 })
  order_key!: string;

  /** Human order number ("1001" for "#1001"), when known. */
  @Column({ type: "varchar", length: 64, nullable: true })
  order_label!: string | null;

  @Column({ type: "varchar", length: 16 })
  source!: OrderLinkSource;

  @CreateDateColumn({ type: "timestamptz" })
  created_at!: Date;
}
