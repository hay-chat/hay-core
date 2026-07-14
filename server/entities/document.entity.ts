import { Column, Entity, Index, ManyToOne, JoinColumn } from "typeorm";
import { OrganizationScopedEntity } from "./base.entity";
import { Organization } from "./organization.entity";

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
  PROCESSING = "processing",
  ERROR = "error",
}

export enum DocumentVisibility {
  PUBLIC = "public",
  PRIVATE = "private",
  INTERNAL = "internal",
}

export enum ImportMethod {
  UPLOAD = "upload",
  WEB = "web",
  PLUGIN = "plugin",
  EDITOR = "editor",
}

@Entity("documents")
@Index(["documentSourceId", "externalId"], { unique: true })
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

  @Column({ type: "jsonb", nullable: true })
  attachments?: Array<{
    type: string;
    url: string;
    name: string;
    size?: number;
  }>;

  @Column({ type: "text", nullable: true })
  content?: string;

  @Column({ type: "jsonb", nullable: true })
  contentJson?: Record<string, unknown>;

  @Column({ type: "jsonb", nullable: true })
  embeddingMetadata?: {
    model: string;
    contentLength: number;
    createdAt: Date;
    [key: string]: unknown;
  };

  @Column({ type: "jsonb", nullable: true })
  processingMetadata?: {
    retryCount?: number;
    lastError?: string;
    lastAttemptAt?: Date;
    jobId?: string;
    processingStage?: "scraping" | "html_to_markdown" | "embedding";
    [key: string]: unknown;
  };

  @Column({
    type: "enum",
    enum: ImportMethod,
    default: ImportMethod.UPLOAD,
  })
  importMethod!: ImportMethod;

  @Column({ type: "varchar", nullable: true })
  sourceUrl?: string;

  @Column({ type: "timestamptz", nullable: true })
  lastCrawledAt?: Date;

  @Index()
  @Column({ type: "uuid", nullable: true })
  documentSourceId?: string;

  @Index()
  @Column({ type: "varchar", length: 255, nullable: true })
  externalId?: string;

  @Column({ type: "timestamptz", nullable: true })
  externalUpdatedAt?: Date;

  @Column({ type: "text", nullable: true })
  externalUrl?: string;

  // Sticky user override — set when user archives a synced doc; sync engine skips re-upserting it.
  @Column({ type: "boolean", default: false })
  excludedFromSync!: boolean;

  // Relationships - organizationId is inherited from OrganizationScopedEntity
  @ManyToOne(() => Organization, (organization) => organization.documents, {
    onDelete: "CASCADE",
  })
  @JoinColumn()
  organization!: Organization;
}
