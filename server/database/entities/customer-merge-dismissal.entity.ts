import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from "typeorm";

/**
 * Two customers a person marked as "not the same person" (D13-13), so the
 * suggested merge is not shown again. Stored ordered: customer_a_id < customer_b_id.
 */
@Entity("customer_merge_dismissals")
@Index(["customer_a_id", "customer_b_id"], { unique: true })
export class CustomerMergeDismissal {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  organization_id!: string;

  @Column({ type: "uuid" })
  customer_a_id!: string;

  @Column({ type: "uuid" })
  customer_b_id!: string;

  @CreateDateColumn({ type: "timestamptz" })
  created_at!: Date;
}
