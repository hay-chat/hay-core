import { Entity, Column, ManyToOne, JoinColumn, Index } from "typeorm";
import { BaseEntity } from "./base.entity";
import { Organization } from "./organization.entity";
import { User } from "./user.entity";

@Entity("uploads")
@Index("idx_uploads_organization_id", ["organizationId"])
@Index("idx_uploads_folder", ["folder"])
@Index("idx_uploads_created_at", ["createdAt"])
export class Upload extends BaseEntity {
  @Column({ type: "varchar", length: 500 })
  filename!: string;

  @Column({ type: "varchar", length: 500 })
  originalName!: string;

  @Column({ type: "varchar", length: 1000 })
  path!: string;

  @Column({ type: "varchar", length: 100 })
  mimeType!: string;

  @Column({ type: "bigint" })
  size!: number;

  @Column({ type: "varchar", length: 50 })
  storageType!: string;

  @Column({ type: "varchar", length: 100 })
  folder!: string;

  // Association with organization
  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "organization_id" })
  organization!: Organization;

  @Column({ type: "uuid" })
  organizationId!: string;

  // Optional: track who uploaded
  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "uploaded_by_id" })
  uploadedBy?: User;

  @Column({ type: "uuid", nullable: true })
  uploadedById?: string;
}
