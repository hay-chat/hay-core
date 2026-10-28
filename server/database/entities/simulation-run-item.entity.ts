import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";
import type { SimulationUsage } from "./simulation-run.entity";

export type SimulationItemStatus = "pending" | "running" | "completed" | "failed" | "skipped";

/** A turn written into the simulated conversation before the AI answers. */
export interface SimulationSeedTurn {
  /** "customer" turns are the shopper; "agent" turns are earlier replies (a person's). */
  role: "customer" | "agent";
  text: string;
}

/**
 * One simulated conversation of a run (D7-7). The seed turns are written into
 * a new conversation, which must end with a customer turn; the orchestrator
 * then answers it once. The reply, tool calls and simulated writes are read
 * from that conversation (messages, action_log).
 */
@Entity("simulation_run_items")
@Index("idx_simulation_run_items_run_position", ["run_id", "position"])
@Index("idx_simulation_run_items_org_created", ["organization_id", "created_at"])
@Index("idx_simulation_run_items_conversation", ["conversation_id"])
export class SimulationRunItem {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  run_id!: string;

  @Column({ type: "uuid" })
  organization_id!: string;

  @Column({ type: "integer" })
  position!: number;

  @Column({ type: "varchar", length: 16, default: "pending" })
  status!: SimulationItemStatus;

  @Column({ type: "jsonb" })
  seed!: SimulationSeedTurn[];

  /** Where the case came from, for the caller (e.g. a transcript id and turn). */
  @Column({ type: "varchar", length: 255, nullable: true })
  source_ref!: string | null;

  /** Set when the item is dispatched. */
  @Column({ type: "uuid", nullable: true })
  conversation_id!: string | null;

  @Column({ type: "text", nullable: true })
  error!: string | null;

  @Column({ type: "jsonb", default: () => "'{}'" })
  usage!: SimulationUsage;

  @Column({ type: "timestamptz", nullable: true })
  started_at!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  completed_at!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updated_at!: Date;
}
