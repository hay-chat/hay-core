import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

export type DisputeStatus = "needs_response" | "under_review" | "won" | "lost" | "closed";
export type DisputeEvidenceStatus = "none" | "drafted" | "failed";

/**
 * A payment dispute (chargeback) a plugin with the `disputes` capability
 * reported (D2-7/D2-8). `pluginId` is the reporting plugin, stamped by core.
 * Core matches it to an order in the order index and can push the evidence
 * pack to the platform as a draft; the merchant always submits on the platform.
 */
@Entity("disputes")
@Index("idx_disputes_org_due", ["organizationId", "evidenceDueBy"])
export class Dispute {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  organizationId!: string;

  @Column({ type: "varchar", length: 255 })
  pluginId!: string;

  @Column({ type: "varchar", length: 255 })
  externalId!: string;

  @Column({ type: "varchar", length: 24 })
  status!: DisputeStatus;

  /** Major units as text ("42.50"). */
  @Column({ type: "varchar", length: 32, nullable: true })
  amount!: string | null;

  @Column({ type: "varchar", length: 3, nullable: true })
  currency!: string | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  reason!: string | null;

  @Column({ type: "timestamptz", nullable: true })
  evidenceDueBy!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  initiatedAt!: Date | null;

  @Column({ type: "jsonb", default: () => "'[]'" })
  orderRefs!: string[];

  @Column({ type: "varchar", length: 64, nullable: true })
  orderLabel!: string | null;

  @Column({ type: "text", nullable: true })
  providerUrl!: string | null;

  /** Matched order in the order index (null until a ref matches). */
  @Column({ type: "varchar", length: 64, nullable: true })
  orderKey!: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  orderPluginId!: string | null;

  @Column({ type: "varchar", length: 16, default: "none" })
  evidenceStatus!: DisputeEvidenceStatus;

  @Column({ type: "timestamptz", nullable: true })
  evidencePushedAt!: Date | null;

  @Column({ type: "uuid", nullable: true })
  evidencePushedBy!: string | null;

  @Column({ type: "text", nullable: true })
  evidenceError!: string | null;

  @Column({ type: "timestamptz", nullable: true })
  alertedAt!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  remindedAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
