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
import { Job } from "./job.entity";
import { Customer } from "../database/entities/customer.entity";
import { Organization } from "./organization.entity";

export type PrivacyRequestType = "export" | "deletion" | "rectification";

export type PrivacyRequestStatus =
  | "pending_verification"
  | "verified"
  | "processing"
  | "completed"
  | "failed"
  | "expired"
  | "cancelled";

export type PrivacyRequestSubjectType = "user" | "customer";

export type PrivacyRequestIdentifierType = "email" | "phone" | "externalId";

@Entity("privacy_requests")
@Index("idx_privacy_requests_email", ["email"])
@Index("idx_privacy_requests_status", ["status"])
@Index("idx_privacy_requests_type", ["type"])
@Index("idx_privacy_requests_created_at", ["createdAt"])
@Index("idx_privacy_requests_verification_expires", ["verificationExpiresAt"])
@Index("idx_privacy_requests_subject_type", ["subjectType"])
@Index("idx_privacy_requests_customer_id", ["customerId"])
@Index("idx_privacy_requests_organization_id", ["organizationId"])
export class PrivacyRequest extends TypeOrmBaseEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;

  @Column({ type: "varchar", length: 255 })
  email!: string;

  @Column({ type: "uuid", nullable: true })
  userId?: string;

  @Column({
    type: "enum",
    enum: ["export", "deletion", "rectification"],
  })
  type!: PrivacyRequestType;

  @Column({
    type: "enum",
    enum: ["user", "customer"],
    default: "user",
  })
  subjectType!: PrivacyRequestSubjectType;

  @Column({ type: "uuid", nullable: true })
  customerId?: string;

  @Column({ type: "uuid", nullable: true })
  organizationId?: string;

  @Column({
    type: "enum",
    enum: ["email", "phone", "externalId"],
    nullable: true,
  })
  identifierType?: PrivacyRequestIdentifierType;

  @Column({ type: "varchar", length: 255, nullable: true })
  identifierValue?: string;

  @Column({
    type: "enum",
    enum: [
      "pending_verification",
      "verified",
      "processing",
      "completed",
      "failed",
      "expired",
      "cancelled",
    ],
    default: "pending_verification",
  })
  status!: PrivacyRequestStatus;

  @Column({ type: "varchar", length: 255, nullable: true })
  verificationTokenHash?: string;

  @Column({ type: "timestamptz", nullable: true })
  verificationExpiresAt?: Date;

  @Column({ type: "timestamptz", nullable: true })
  verifiedAt?: Date;

  @Column({ type: "uuid", nullable: true })
  jobId?: string;

  @Column({ type: "varchar", length: 45, nullable: true })
  ipAddress?: string;

  @Column({ type: "varchar", length: 500, nullable: true })
  userAgent?: string;

  @Column({ type: "timestamptz", nullable: true })
  completedAt?: Date;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, unknown>;

  @Column({ type: "text", nullable: true })
  errorMessage?: string;

  @Column({ type: "varchar", length: 45, nullable: true })
  downloadIpAddress?: string;

  @Column({ type: "timestamptz", nullable: true })
  downloadedAt?: Date;

  @Column({ type: "int", default: 0 })
  downloadCount!: number;

  @Column({ type: "int", default: 1 })
  maxDownloads!: number;

  // Relationships
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn()
  user?: User;

  @ManyToOne(() => Job, { nullable: true })
  @JoinColumn()
  job?: Job;

  @ManyToOne(() => Customer, { nullable: true })
  @JoinColumn()
  customer?: Customer;

  @ManyToOne(() => Organization, { nullable: true, onDelete: "CASCADE" })
  @JoinColumn()
  organization?: Organization;

  // Helper methods
  isExpired(): boolean {
    if (!this.verificationExpiresAt) {
      return false;
    }
    return this.verificationExpiresAt < new Date();
  }

  canVerify(): boolean {
    return (
      this.status === "pending_verification" && !!this.verificationTokenHash && !this.isExpired()
    );
  }

  /** SHA-256 of the download token emailed to the requester (the token itself is never stored). */
  getDownloadTokenHash(): string | null {
    if (this.metadata && typeof this.metadata.downloadTokenHash === "string") {
      return this.metadata.downloadTokenHash;
    }
    return null;
  }

  /** Upload id of the export ZIP while it is still stored. */
  getExportUploadId(): string | null {
    if (this.metadata && typeof this.metadata.uploadId === "string") {
      return this.metadata.uploadId;
    }
    return null;
  }

  getExportExpiresAt(): Date | null {
    if (this.metadata && typeof this.metadata.exportExpiresAt === "string") {
      return new Date(this.metadata.exportExpiresAt);
    }
    return null;
  }

  setExportMetadata(uploadId: string, downloadTokenHash: string, expiresAt: Date): void {
    this.metadata = {
      ...this.metadata,
      uploadId,
      downloadTokenHash,
      exportExpiresAt: expiresAt.toISOString(),
    };
  }

  setError(errorMessage: string): void {
    this.errorMessage = errorMessage;
    this.status = "failed";
    this.completedAt = new Date();
  }

  markCompleted(): void {
    this.status = "completed";
    this.completedAt = new Date();
  }

  markProcessing(jobId: string): void {
    this.status = "processing";
    this.jobId = jobId;
  }

  markVerified(): void {
    this.status = "verified";
    this.verifiedAt = new Date();
  }

  // Polymorphic helper methods
  isUserRequest(): boolean {
    return this.subjectType === "user";
  }

  isCustomerRequest(): boolean {
    return this.subjectType === "customer";
  }

  getSubjectId(): string | undefined {
    return this.isUserRequest() ? this.userId : this.customerId;
  }

  getSubjectEmail(): string {
    return this.email;
  }
}
