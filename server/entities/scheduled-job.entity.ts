import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity("scheduled_jobs")
export class ScheduledJob {
  @PrimaryColumn({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "text" })
  description!: string;

  @Column({ type: "text" })
  schedule!: string;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @Column({ type: "timestamptz", nullable: true })
  lastRun?: Date;

  @Column({ type: "varchar", length: 50, nullable: true })
  lastStatus?: "success" | "failed" | "timeout";

  @Column({ type: "text", nullable: true })
  lastError?: string;

  @Column({ type: "int", default: 0 })
  totalRuns!: number;

  @Column({ type: "int", default: 0 })
  totalFailures!: number;

  @Column({ type: "int", default: 0 })
  averageDuration!: number; // milliseconds

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
