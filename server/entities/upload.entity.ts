import { Entity, Column, ManyToOne, JoinColumn, Index } from "typeorm";
import { BaseEntity } from "./base.entity";
import { Organization } from "./organization.entity";
import { User } from "./user.entity";

@Entity("uploads")
@Index("idx_uploads_organization_id", ["organizationId"])
@Index("idx_uploads_folder", ["folder"])
@Index("idx_uploads_created_at", ["createdAt"])
@Index("idx_uploads_conversation_id", ["conversationId"])
@Index("idx_uploads_customer_id", ["customerId"])
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

  // Conversation media only (D8-3): what the file belongs to, so retention and
  // erasure can delete it and the orphan sweep can find files no message uses.
  // Set when a message carrying the upload is stored (conversation-media.service).
  @Column({ type: "uuid", nullable: true })
  conversationId?: string | null;

  @Column({ type: "uuid", nullable: true })
  messageId?: string | null;

  @Column({ type: "uuid", nullable: true })
  customerId?: string | null;

  // D8-4: virus scan (services/media-scan.service). NULL/"skipped"/"clean" are
  // served; "pending", "infected" and "error" are held.
  @Column({ type: "varchar", length: 20, nullable: true })
  scanStatus?: ScanStatus | null;
}

export type ScanStatus = "skipped" | "pending" | "clean" | "infected" | "error";
