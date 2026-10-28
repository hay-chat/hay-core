import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";
import type { SimulationUsage } from "./simulation-run.entity";
import type {
  ReplayBucket,
  SimulationVerdict,
} from "@server/services/simulation/turn-judge.service";

/**
 * What a case is checked against (D7-9/D7-10/D7-12). Set for replays and test
 * cases; null for plain simulation runs, which are not judged.
 */
export interface SimulationExpectations {
  /** What was actually sent at this point (a person's reply, or the AI's then). */
  referenceReply?: string | null;
  /** Free text: what a good answer does ("asks for the order number"). */
  expectedOutcome?: string | null;
  /** A reply the AI should not repeat (an edited or thumbed-down answer). */
  avoidReply?: string | null;
  /** Tools the AI must call / must not call (tool names). */
  mustCallTools?: string[];
  mustNotCallTools?: string[];
  /** true: must hand off; false: must not; missing/null: either. */
  expectHandoff?: boolean | null;
  /** A replay of a past turn: live store reads may differ from what was true then. */
  replay?: boolean;
  /** When the replayed turn happened (ISO), when the source says. */
  originalAt?: string | null;
  /** The source conversation's title, for the report. */
  title?: string | null;
}

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
@Index("idx_simulation_run_items_run_bucket", ["run_id", "bucket"])
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

  /** What the run is checked against; null = not judged (plain simulation). */
  @Column({ type: "jsonb", nullable: true })
  expectations!: SimulationExpectations | null;

  /** The judge's verdict (D7-10); null until judged, or when not judged. */
  @Column({ type: "jsonb", nullable: true })
  verdict!: SimulationVerdict | null;

  /** The replay-report bucket, copied out of the verdict for grouping. */
  @Column({ type: "varchar", length: 32, nullable: true })
  bucket!: ReplayBucket | null;

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
