import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  BaseEntity as TypeOrmBaseEntity,
} from "typeorm";
import { User } from "./user.entity";
import { Organization } from "./organization.entity";

export type AuditAction =
  | "profile.update"
  | "email.change"
  | "password.change"
  | "password.reset.request"
  | "password.reset"
  | "user.login"
  | "user.logout"
  | "user.register"
  | "apikey.create"
  | "apikey.revoke"
  | "security.setting.change"
  | "privacy.export.request"
  | "privacy.export.confirm"
  | "privacy.export.download"
  | "privacy.deletion.request"
  | "privacy.deletion.confirm"
  | "privacy.deletion.complete"
  | "privacy.rectification.request"
  | "organization.create"
  | "organization.switch"
  | "organization.invitation.send"
  | "organization.invitation.accept"
  | "organization.invitation.decline"
  | "organization.invitation.cancel"
  | "organization.invitation.resend"
  | "organization.member.role_change"
  | "organization.member.remove"
  | "agent.create"
  | "agent.update"
  | "agent.delete"
  | "playbook.create"
  | "playbook.update"
  | "playbook.delete"
  | "playbook.publish"
  | "document.create"
  | "document.update"
  | "document.delete"
  | "permission.denied";

@Entity("audit_logs")
@Index("idx_audit_logs_user", ["userId"])
@Index("idx_audit_logs_organization", ["organizationId"])
@Index("idx_audit_logs_action", ["action"])
@Index("idx_audit_logs_created_at", ["createdAt"])
export class AuditLog extends TypeOrmBaseEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;

  @Column({ type: "uuid", nullable: true })
  userId?: string;

  @Column({ type: "uuid", nullable: true })
  organizationId?: string;

  @Column({ type: "varchar", length: 100 })
  action!: AuditAction;

  @Column({ type: "varchar", length: 100, nullable: true })
  resource?: string;

  @Column({ type: "jsonb", nullable: true })
  changes?: Record<string, any>;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, any>;

  @Column({ type: "varchar", length: 45, nullable: true })
  ipAddress?: string;

  @Column({ type: "varchar", length: 500, nullable: true })
  userAgent?: string;

  @Column({ type: "varchar", length: 100, nullable: true })
  status?: "success" | "failure" | "warning";

  @Column({ type: "text", nullable: true })
  errorMessage?: string;

  // Relationships
  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn()
  user?: User;

  @ManyToOne(() => Organization, { nullable: true, onDelete: "CASCADE" })
  @JoinColumn()
  organization?: Organization;

  // Helper method to create log entry
  static createLog(data: {
    userId: string;
    organizationId?: string;
    action: AuditAction;
    resource?: string;
    changes?: Record<string, any>;
    metadata?: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
    status?: "success" | "failure" | "warning";
    errorMessage?: string;
  }): AuditLog {
    const log = new AuditLog();
    Object.assign(log, data);
    return log;
  }
}
