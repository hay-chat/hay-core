import { Entity, Column, ManyToOne, JoinColumn, Index, PrimaryGeneratedColumn } from "typeorm";
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

  @Column({ type: "text", name: "pageContent" })
  pageContent!: string;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, any>;

  @Column("simple-array", {
    transformer: {
      to: (value: number[] | null): string | null => {
        if (!value || !Array.isArray(value)) return null;
        return `[${value.join(',')}]`;
      },
      from: (value: string | null): number[] | null => {
        if (!value) return null;
        if (Array.isArray(value)) return value;
        
        const cleaned = value.replace(/[\[\]]/g, '');
        if (!cleaned) return null;
        
        return cleaned.split(',').map(v => parseFloat(v.trim()));
      }
    }
  })
  embedding!: number[];

  // Relationships
  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "organizationId" })
  organization!: Organization;

  @ManyToOne(() => Document, { onDelete: "CASCADE", nullable: true })
  @JoinColumn({ name: "documentId" })
  document?: Document;
}