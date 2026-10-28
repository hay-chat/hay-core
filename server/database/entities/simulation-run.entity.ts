import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

/**
 * - running: conversations are queued or in progress
 * - completed: every conversation finished (some may have failed)
 * - capped: stopped at the run's token ceiling; the rest was skipped
 * - cancelled: stopped by a person; the rest was skipped
 */
export type SimulationRunStatus = "running" | "completed" | "capped" | "cancelled";

/** LLM tokens per `provider:model`. No prices: those live outside core. */
export type SimulationUsage = Record<
  string,
  { calls: number; promptTokens: number; cachedPromptTokens: number; completionTokens: number }
>;

/**
 * One batch of simulated conversations (D7-7). Each item becomes a
 * `runKind: "simulation"` conversation that the orchestrator answers through
 * the normal queue, in dry run, never delivered and never billed.
 */
@Entity("simulation_runs")
@Index("idx_simulation_runs_org_created", ["organization_id", "created_at"])
export class SimulationRun {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  organization_id!: string;

  /** What made the run: "manual" here; replay and test-case runs add their own. */
  @Column({ type: "varchar", length: 32, default: "manual" })
  kind!: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  label!: string | null;

  @Column({ type: "varchar", length: 16, default: "running" })
  status!: SimulationRunStatus;

  /** Null: the organization's default agent at the time of each conversation. */
  @Column({ type: "uuid", nullable: true })
  agent_id!: string | null;

  /** A playbook draft (or any version) to run instead of the live one (D7-5). */
  @Column({ type: "uuid", nullable: true })
  playbook_id!: string | null;

  @Column({ type: "uuid", nullable: true })
  playbook_version_id!: string | null;

  @Column({ type: "integer", default: 0 })
  item_count!: number;

  @Column({ type: "integer", default: 0 })
  completed_count!: number;

  @Column({ type: "integer", default: 0 })
  failed_count!: number;

  @Column({ type: "integer", default: 0 })
  skipped_count!: number;

  @Column({ type: "jsonb", default: () => "'{}'" })
  usage!: SimulationUsage;

  @Column({ type: "uuid", nullable: true })
  created_by_id!: string | null;

  @Column({ type: "timestamptz", nullable: true })
  completed_at!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updated_at!: Date;
}
