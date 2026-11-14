import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { OrganizationScopedEntity } from "@server/entities/base.entity";
import { Document } from "@server/entities/document.entity";
import { HelpCenterCollection } from "./help-center-collection.entity";

/**
 * Places a document in a help center collection. A document is in at most one
 * collection, and it is only shown on the site while it is also published and
 * public (see services/help-center/public-content.ts).
 */
@Entity("help_center_articles")
@Index("uq_help_center_articles_document", ["documentId"], { unique: true })
@Index("idx_help_center_articles_collection_position", ["collectionId", "position"])
export class HelpCenterArticle extends OrganizationScopedEntity {
  @Column({ type: "uuid" })
  collectionId!: string;

  @ManyToOne(() => HelpCenterCollection, { onDelete: "CASCADE" })
  @JoinColumn()
  collection?: HelpCenterCollection;

  @Column({ type: "uuid" })
  documentId!: string;

  @ManyToOne(() => Document, { onDelete: "CASCADE" })
  @JoinColumn()
  document?: Document;

  @Column({ type: "int", default: 0 })
  position!: number;

  /** "Was this helpful?" answers. Counts only: nothing about the visitor is stored. */
  @Column({ type: "int", default: 0 })
  helpfulCount!: number;

  @Column({ type: "int", default: 0 })
  unhelpfulCount!: number;
}
