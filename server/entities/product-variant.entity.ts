import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { OrganizationScopedEntity } from "./base.entity";
import { Organization } from "./organization.entity";
import { Product, ProductSource } from "./product.entity";

export enum VariantAvailability {
  IN_STOCK = "in_stock",
  OUT_OF_STOCK = "out_of_stock",
  BACKORDER = "backorder",
}

export interface VariantSelectedOption {
  name: string;
  value: string;
}

@Entity("product_variants")
@Index("idx_product_variants_organization_id", ["organizationId"])
@Index("idx_product_variants_product_id", ["productId"])
@Index("idx_product_variants_sku", ["sku"])
@Index("idx_product_variants_price", ["price"])
@Index("idx_product_variants_availability", ["availability"])
@Index("idx_product_variants_source_external_id", ["source", "externalId"], { unique: true })
export class ProductVariant extends OrganizationScopedEntity {
  @Column({ type: "uuid" })
  productId!: string;

  @Column({ type: "text" })
  externalId!: string;

  // Stored here too (mirroring Product.source) so the idempotency key
  // (source, external_id) is self-contained on this row — no join needed
  // for upsert ON CONFLICT.
  @Column({ type: "enum", enum: ProductSource })
  source!: ProductSource;

  @Column({ type: "text", nullable: true })
  sku?: string;

  @Column({ type: "text", nullable: true })
  barcode?: string;

  @Column({ type: "text" })
  title!: string;

  @Column({ type: "jsonb", nullable: true })
  selectedOptions?: VariantSelectedOption[];

  @Column({ type: "integer", nullable: true })
  position?: number;

  @Column({ type: "numeric", precision: 12, scale: 2, nullable: true })
  price?: string;

  @Column({ type: "numeric", precision: 12, scale: 2, nullable: true })
  compareAtPrice?: string;

  @Column({ type: "char", length: 3, nullable: true })
  currency?: string;

  @Column({ type: "integer", nullable: true })
  inventoryQuantity?: number;

  @Column({ type: "boolean", default: false })
  inventoryTracked!: boolean;

  @Column({ type: "enum", enum: VariantAvailability, default: VariantAvailability.IN_STOCK })
  availability!: VariantAvailability;

  @Column({ type: "numeric", precision: 12, scale: 3, nullable: true })
  weightValue?: string;

  @Column({ type: "text", nullable: true })
  weightUnit?: string;

  @Column({ type: "text", nullable: true })
  imageSrc?: string;

  @Column({ type: "jsonb", nullable: true })
  attributes?: Record<string, unknown>;

  @ManyToOne(() => Product, (product) => product.variants, { onDelete: "CASCADE" })
  @JoinColumn()
  product!: Product;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn()
  organization!: Organization;
}
