import { Column, Entity, Index, ManyToOne, JoinColumn } from "typeorm";
import { OrganizationScopedEntity } from "./base.entity";
import { Organization } from "./organization.entity";
import { VectorTransformer } from "../database/pgvector-type";

export enum DocumentationType {
  ARTICLE = "article",
  GUIDE = "guide",
  FAQ = "faq",
  TUTORIAL = "tutorial",
  REFERENCE = "reference",
  POLICY = "policy",
}

export enum DocumentationStatus {
  DRAFT = "draft",
  PUBLISHED = "published",
  ARCHIVED = "archived",
  UNDER_REVIEW = "under_review",
}

export enum DocumentVisibility {
  PUBLIC = "public",
  PRIVATE = "private",
  INTERNAL = "internal",
}

@Entity("documents")
export class Document extends OrganizationScopedEntity {
  @Column({ type: "varchar", nullable: true })
  title!: string;

  @Column({ type: "varchar", nullable: true })
  description!: string;

  @Column({
    type: "enum",
    enum: DocumentationType,
    default: DocumentationType.ARTICLE,
  })
  type!: DocumentationType;

  @Column({
    type: "enum",
    enum: DocumentationStatus,
    default: DocumentationStatus.DRAFT,
  })
  status!: DocumentationStatus;

  @Column({
    type: "enum",
    enum: DocumentVisibility,
    default: DocumentVisibility.PRIVATE,
  })
  visibility!: DocumentVisibility;

  @Column({ type: "simple-array", nullable: true })
  tags?: string[];

  @Column({ type: "simple-array", nullable: true })
  categories?: string[];

  @Column({ type: "tsvector", nullable: true })
  @Index("idx_doc_search_vector", { synchronize: false })
  search_vector?: any;

  @Column({ type: "jsonb", nullable: true })
  attachments?: Array<{
    type: string;
    url: string;
    name: string;
    size?: number;
  }>;

  @Column({ type: "text", nullable: true })
  content?: string;

  // TypeORM doesn't natively support pgvector, so we use a workaround
  // The actual column type will be set to vector(1536) via migration
  @Column({
    type: 'text',
    nullable: true,
    transformer: VectorTransformer,
  })
  embedding?: number[] | null;

  @Column({ type: "jsonb", nullable: true })
  embeddingMetadata?: {
    model: string;
    contentLength: number;
    createdAt: Date;
    [key: string]: any;
  };

  // Relationships - organizationId is inherited from OrganizationScopedEntity
  @ManyToOne(() => Organization, (organization) => organization.documents)
  @JoinColumn({ name: "organizationId" })
  organization!: Organization;
}
