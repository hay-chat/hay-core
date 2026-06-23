import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from "typeorm";
import { OrganizationScopedEntity } from "./base.entity";
import { Organization } from "./organization.entity";
import { ProductVariant } from "./product-variant.entity";
import { ProductStatus } from "./product.enums";
import type { ProductCategoryRef, ProductImage, ProductOptionDef } from "./product.enums";

export { ProductStatus, CORE_PRODUCT_SOURCES } from "./product.enums";
export type { ProductCategoryRef, ProductImage, ProductOptionDef } from "./product.enums";

@Entity("products")
@Index("idx_products_organization_id", ["organizationId"])
@Index("idx_products_handle", ["handle"])
@Index("idx_products_external_id", ["externalId"])
@Index("idx_products_price_min", ["priceMin"])
@Index("idx_products_available", ["available"])
@Index("idx_products_source_external_id", ["source", "externalId"], { unique: true })
export class Product extends OrganizationScopedEntity {
  @Column({ type: "text" })
  externalId!: string;

  // Free-form source identifier: the authenticated plugin id for plugin-ingested
  // products, or a core-owned value ("custom" / "manual"). Core never enumerates
  // plugin sources — see CORE_PRODUCT_SOURCES.
  @Column({ type: "text" })
  source!: string;

  @Column({ type: "text" })
  handle!: string;

  @Column({ type: "text" })
  title!: string;

  @Column({ type: "text", nullable: true })
  description?: string;

  @Column({ type: "text", nullable: true })
  descriptionShort?: string;

  @Column({ type: "text", nullable: true })
  vendor?: string;

  @Column({ type: "text", nullable: true })
  productType?: string;

  @Column({ type: "enum", enum: ProductStatus, default: ProductStatus.ACTIVE })
  status!: ProductStatus;

  @Column({ type: "text", array: true, default: () => "'{}'::text[]" })
  tags!: string[];

  @Column({ type: "jsonb", nullable: true })
  categories?: ProductCategoryRef[];

  @Column({ type: "jsonb", nullable: true })
  options?: ProductOptionDef[];

  @Column({ type: "jsonb", nullable: true })
  images?: ProductImage[];

  @Column({ type: "char", length: 3, nullable: true })
  currency?: string;

  @Column({ type: "numeric", precision: 12, scale: 2, nullable: true })
  priceMin?: string;

  @Column({ type: "numeric", precision: 12, scale: 2, nullable: true })
  priceMax?: string;

  @Column({ type: "boolean", default: false })
  available!: boolean;

  @Column({ type: "text", nullable: true })
  searchText?: string;

  @Column({ type: "jsonb", nullable: true })
  attributes?: Record<string, unknown>;

  @Column({ type: "text", nullable: true })
  sourceUrl?: string;

  // Relationships - organizationId inherited from OrganizationScopedEntity
  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn()
  organization!: Organization;

  @OneToMany(() => ProductVariant, (variant) => variant.product)
  variants?: ProductVariant[];
}
