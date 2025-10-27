import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";

@Entity("scheduled_job_history")
@Index(["jobName", "startedAt"])
export class ScheduledJobHistory {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 255 })
  @Index()
  jobName!: string;

  @Column({ type: "timestamptz" })
  startedAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  completedAt?: Date;

  @Column({ type: "varchar", length: 50 })
  status!: "success" | "failed" | "timeout";

  @Column({ type: "int" })
  duration!: number; // milliseconds

  @Column({ type: "text", nullable: true })
  error?: string;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
