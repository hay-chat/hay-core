import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Organization } from "./organization.entity";
import { User } from "./user.entity";

export type GitProvider = "github" | "gitlab" | "bitbucket";
export type GitConnectionStatus = "active" | "suspended" | "revoked";

@Entity("git_connections")
@Index(["organizationId", "provider", "installationId"], { unique: true })
@Index(["organizationId"])
@Index(["status"])
export class GitConnection {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  organizationId!: string;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "organization_id" })
  organization?: Organization;

  @Column({ type: "varchar", length: 50 })
  provider!: GitProvider;

  @Column({ type: "varchar", length: 255 })
  installationId!: string;

  @Column({ type: "varchar", length: 255 })
  accountLogin!: string;

  @Column({ type: "varchar", length: 50, nullable: true })
  accountType?: string;

  @Column({ type: "jsonb", nullable: true })
  permissions?: Record<string, string>;

  @Column({ type: "varchar", length: 50, nullable: true })
  repositorySelection?: string;

  @Column({ type: "uuid", nullable: true })
  installedById?: string;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "installed_by_id" })
  installedBy?: User;

  @Column({ type: "varchar", length: 50, default: "active" })
  status!: GitConnectionStatus;

  @Column({ type: "timestamptz", nullable: true })
  lastSyncAt?: Date;

  @Column({ type: "text", nullable: true })
  lastSyncError?: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
