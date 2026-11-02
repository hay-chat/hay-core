import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from "typeorm";

/**
 * One page of the organization's website, read from its sitemap. The AI looks
 * pages up with the find_page_url tool, and the link check treats these URLs
 * as real. Replaced as a whole on every sync.
 */
@Entity("site_pages")
@Index("uq_site_pages_org_url", ["organizationId", "url"], { unique: true })
export class SitePage {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  organizationId!: string;

  @Column({ type: "varchar", length: 2048 })
  url!: string;

  /** Words from the URL path ("/products/blue-shirt" → "products blue shirt"). */
  @Column({ type: "varchar", length: 500 })
  title!: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
