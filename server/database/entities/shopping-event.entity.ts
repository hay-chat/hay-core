import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from "typeorm";

/** What the shopper did with a recommended product. */
export const SHOPPING_EVENT_TYPES = ["card_click", "buy_click", "cart_add"] as const;
export type ShoppingEventType = (typeof SHOPPING_EVENT_TYPES)[number];

/**
 * One step of the shopping funnel after a recommendation was shown: the
 * shopper opened a product card, followed its buy link, or added the product
 * to the store's cart from the chat. Recommendations
 * shown are not stored here: they are the ProductRecommendation messages.
 */
@Entity("shopping_events")
@Index("idx_shopping_events_org_created", ["organizationId", "createdAt"])
@Index("idx_shopping_events_conversation", ["conversationId"])
export class ShoppingEvent {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  organizationId!: string;

  @Column({ type: "uuid" })
  conversationId!: string;

  /** The ProductRecommendation message whose card was clicked. */
  @Column({ type: "uuid" })
  messageId!: string;

  /** Not a foreign key: the event outlives a product removed from the catalog. */
  @Column({ type: "uuid" })
  productId!: string;

  @Column({ type: "varchar", length: 32 })
  type!: ShoppingEventType;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
