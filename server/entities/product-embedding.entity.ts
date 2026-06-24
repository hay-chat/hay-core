import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Organization } from "./organization.entity";
import { Product } from "./product.entity";

/**
 * Thin entity for product_embeddings — mirrors the Embedding entity pattern.
 *
 * The `embedding` column exists in the DB as vector(1536) but is intentionally
 * omitted here; all vector reads/writes go through raw SQL in
 * product-vector-store.service.ts (TypeORM has no native vector type).
 */
@Entity("product_embeddings")
@Index("product_embeddings_org_id_idx", ["organizationId"])
@Index("product_embeddings_product_id_idx", ["productId"])
export class ProductEmbedding {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  organizationId!: string;

  @Column({ type: "uuid" })
  productId!: string;

  @Column({ type: "text" })
  pageContent!: string;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn()
  organization!: Organization;

  @ManyToOne(() => Product, { onDelete: "CASCADE" })
  @JoinColumn()
  product!: Product;
}
