import { Column, Entity, Index, ManyToOne, JoinColumn } from "typeorm";
import { TenantScopedEntity } from "./base.entity";
import { Organization } from "./tenant.entity";

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
export class Document extends TenantScopedEntity {
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

  // Relationships - tenantId is inherited from TenantScopedEntity
  @ManyToOne(() => Organization, (organization) => organization.documents)
  @JoinColumn({ name: 'tenantId' })
  organization!: Organization;
}
