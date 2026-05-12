import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from "typeorm";
import { Document } from "./document.entity";
import { Organization } from "./organization.entity";

@Entity("embeddings")
@Index("embeddings_org_id_idx", ["organizationId"])
export class Embedding {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  organizationId!: string;

  @Column({ type: "uuid", nullable: true })
  documentId?: string;

  @Column({ type: "text" })
  pageContent!: string;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, unknown>;

  // The `embedding` column exists in the DB as vector(1536) but is intentionally
  // omitted from this entity — all reads/writes go through raw SQL in
  // vector-store.service.ts, and TypeORM has no native vector column type.

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  // Relationships
  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn()
  organization!: Organization;

  @ManyToOne(() => Document, { onDelete: "CASCADE", nullable: true })
  @JoinColumn()
  document?: Document;
}
