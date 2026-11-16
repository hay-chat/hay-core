import { Column, Entity, Index, JoinColumn, ManyToOne, OneToOne } from "typeorm";
import { OrganizationScopedEntity } from "@server/entities/base.entity";
import { Organization } from "@server/entities/organization.entity";
import { Upload } from "@server/entities/upload.entity";

/** Font stacks the public site ships. System fonts only: visitors load nothing from third parties. */
export const HELP_CENTER_FONTS = ["sans", "serif", "rounded", "mono"] as const;
export type HelpCenterFont = (typeof HELP_CENTER_FONTS)[number];

/** Home page layout: a card per collection, or every article listed under its collection. */
export const HELP_CENTER_LAYOUTS = ["cards", "list"] as const;
export type HelpCenterLayout = (typeof HELP_CENTER_LAYOUTS)[number];

/** Follow the visitor's system setting, or always light, or always dark. */
export const HELP_CENTER_COLOR_SCHEMES = ["auto", "light", "dark"] as const;
export type HelpCenterColorScheme = (typeof HELP_CENTER_COLOR_SCHEMES)[number];

/**
 * The home page's hero band: the accent colour, a two-colour gradient, a light
 * wash of the accent, the uploaded image under a dark overlay, or none (the page background).
 */
export const HELP_CENTER_HERO_STYLES = ["solid", "gradient", "tint", "image", "plain"] as const;
export type HelpCenterHeroStyle = (typeof HELP_CENTER_HERO_STYLES)[number];

export const HELP_CENTER_HERO_ALIGNS = ["center", "left"] as const;
export type HelpCenterHeroAlign = (typeof HELP_CENTER_HERO_ALIGNS)[number];

export const HELP_CENTER_GRADIENT_DIRECTIONS = ["diagonal", "right", "down"] as const;
export type HelpCenterGradientDirection = (typeof HELP_CENTER_GRADIENT_DIRECTIONS)[number];

/** How much the dark overlay on a hero image dims it. */
export const HELP_CENTER_HERO_OVERLAYS = ["light", "medium", "strong"] as const;
export type HelpCenterHeroOverlay = (typeof HELP_CENTER_HERO_OVERLAYS)[number];

/** Corner style of cards, the search box and buttons. */
export const HELP_CENTER_CORNERS = ["sharp", "rounded", "pill"] as const;
export type HelpCenterCorners = (typeof HELP_CENTER_CORNERS)[number];

export interface HelpCenterTheme {
  /** `#rrggbb` */
  accentColor: string;
  font: HelpCenterFont;
  layout: HelpCenterLayout;
  colorScheme: HelpCenterColorScheme;
  corners: HelpCenterCorners;
  heroStyle: HelpCenterHeroStyle;
  heroAlign: HelpCenterHeroAlign;
  /** `#rrggbb`, used when heroStyle is "gradient". */
  heroGradientFrom: string;
  /** `#rrggbb`, used when heroStyle is "gradient". */
  heroGradientTo: string;
  heroGradientDirection: HelpCenterGradientDirection;
  /** Used when heroStyle is "image"; the image itself is `HelpCenter.heroImageUpload`. */
  heroOverlay: HelpCenterHeroOverlay;
  heroTitle: string | null;
  heroSubtitle: string | null;
  showPoweredBy: boolean;
}

/** Mirrored in dashboard/utils/help-center.ts, which needs it before a help center exists. */
export const DEFAULT_HELP_CENTER_THEME: HelpCenterTheme = {
  accentColor: "#2747d6",
  font: "sans",
  layout: "cards",
  colorScheme: "auto",
  corners: "rounded",
  heroStyle: "solid",
  heroAlign: "center",
  heroGradientFrom: "#2747d6",
  heroGradientTo: "#142a8c",
  heroGradientDirection: "diagonal",
  heroOverlay: "medium",
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

  /** The hero's background image (a public upload), shown when the theme's heroStyle is "image". */
  @OneToOne(() => Upload, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "hero_image_upload_id" })
  heroImageUpload?: Upload | null;

  @Column({ type: "uuid", nullable: true })
  heroImageUploadId!: string | null;

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
