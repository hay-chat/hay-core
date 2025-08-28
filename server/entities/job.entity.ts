import { Column, Entity, ManyToOne, JoinColumn } from "typeorm";
import { OrganizationScopedEntity } from "./base.entity";
import { Organization } from "./organization.entity";

export enum JobStatus {
  PENDING = "pending",
  QUEUED = "queued",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
  RETRYING = "retrying",
}

export enum JobPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3,
}

@Entity("jobs")
export class Job extends OrganizationScopedEntity {
  @Column({ type: "varchar", nullable: true })
  title!: string;

  @Column({ type: "varchar", nullable: true })
  description!: string;

  @Column({ type: "enum", enum: JobStatus, default: JobStatus.PENDING })
  status!: JobStatus;

  @Column({ type: "enum", enum: JobPriority, default: JobPriority.NORMAL })
  priority!: JobPriority;

  @Column({ type: "jsonb", nullable: true })
  data?: Record<string, any>;

  @Column({ type: "jsonb", nullable: true })
  result?: Record<string, any>;

  // Relationships - organizationId is inherited from OrganizationScopedEntity
  @ManyToOne(() => Organization, (organization) => organization.jobs)
  @JoinColumn({ name: "organizationId" })
  organization!: Organization;
}
