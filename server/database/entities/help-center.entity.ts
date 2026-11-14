import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { OrganizationScopedEntity } from "@server/entities/base.entity";
import { Organization } from "@server/entities/organization.entity";

/** Font stacks the public site ships. System fonts only: visitors load nothing from third parties. */
export const HELP_CENTER_FONTS = ["sans", "serif", "rounded", "mono"] as const;
export type HelpCenterFont = (typeof HELP_CENTER_FONTS)[number];

/** Home page layout: a card per collection, or every article listed under its collection. */
export const HELP_CENTER_LAYOUTS = ["cards", "list"] as const;
export type HelpCenterLayout = (typeof HELP_CENTER_LAYOUTS)[number];

export interface HelpCenterTheme {
  /** `#rrggbb` */
  accentColor: string;
  font: HelpCenterFont;
  layout: HelpCenterLayout;
  heroTitle: string | null;
  heroSubtitle: string | null;
  showPoweredBy: boolean;
}

export const DEFAULT_HELP_CENTER_THEME: HelpCenterTheme = {
  accentColor: "#2747d6",
  font: "sans",
  layout: "cards",
  heroTitle: null,
  heroSubtitle: null,
  showPoweredBy: true,
};

/**
 * An organization's public knowledge base site. Served on
 * `<subdomain>.<HELP_CENTER_DOMAIN>` and, once verified, on a custom domain.
 */
@Entity("help_centers")
@Index("uq_help_centers_organization", ["organizationId"], { unique: true })
@Index("uq_help_centers_subdomain", ["subdomain"], { unique: true })
@Index("uq_help_centers_custom_domain_target", ["customDomainTarget"], { unique: true })
@Index("uq_help_centers_verified_custom_domain", ["customDomain"], {
  unique: true,
  where: '"custom_domain_verified_at" IS NOT NULL',
})
export class HelpCenter extends OrganizationScopedEntity {
  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn()
  organization?: Organization;

  @Column({ type: "varchar", length: 120 })
  name!: string;

  /** One lowercase DNS label. */
  @Column({ type: "varchar", length: 63 })
  subdomain!: string;

  /** A `LanguageCode`: the page language and the language of the site's own labels. */
  @Column({ type: "varchar", length: 10, default: "en" })
  defaultLanguage!: string;

  /** Offline until someone goes live; an offline site answers 404. */
  @Column({ type: "boolean", default: false })
  isPublished!: boolean;

  /** When false the site asks search engines not to index it. */
  @Column({ type: "boolean", default: true })
  searchIndexing!: boolean;

  @Column({ type: "jsonb", default: () => "'{}'" })
  theme!: Partial<HelpCenterTheme>;

  /** Lowercase hostname the customer wants to use. Routes only once verified. */
  @Column({ type: "varchar", length: 253, nullable: true })
  customDomain?: string | null;

  /**
   * Random label under the help center domain that the custom domain's CNAME
   * must point at. Never reused, so a record left behind by a deleted help
   * center cannot be claimed by another organization.
   */
  @Column({ type: "varchar", length: 63 })
  customDomainTarget!: string;

  @Column({ type: "timestamptz", nullable: true })
  customDomainVerifiedAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  customDomainCheckedAt?: Date | null;

  /** Consecutive failed re-checks of a verified domain. */
  @Column({ type: "int", default: 0 })
  customDomainFailures!: number;
}
