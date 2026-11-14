import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToOne,
  JoinColumn,
} from "typeorm";
import { Organization } from "../../entities/organization.entity";
import { Upload } from "../../entities/upload.entity";
import type { FormSchema } from "@hay/form-schema";

export interface WebchatPageToolsSettings {
  enabled: boolean;
  allowedOrigins?: string[];
}

export enum WebchatPosition {
  LEFT = "left",
  RIGHT = "right",
}

export const WEBCHAT_THEME_MODES = ["light", "dark", "system"] as const;
export type WebchatThemeMode = (typeof WEBCHAT_THEME_MODES)[number];

/** Where the widget's logo or brand colour came from: the merchant's website or the merchant. */
export type WebchatBrandingSource = "website" | "custom";

export const DEFAULT_WEBCHAT_BRAND_COLOR = "#001df5";

/** The chat button's icon: a preset, or the merchant's upload ("custom"). */
export const WEBCHAT_LAUNCHER_ICONS = ["chat", "sparkle", "robot", "custom"] as const;
export type WebchatLauncherIcon = (typeof WEBCHAT_LAUNCHER_ICONS)[number];
/** Whether a preset icon is drawn solid or as an outline (the button itself is always filled). */
export const WEBCHAT_LAUNCHER_ICON_STYLES = ["filled", "outline"] as const;
export type WebchatLauncherIconStyle = (typeof WEBCHAT_LAUNCHER_ICON_STYLES)[number];

@Entity("webchat_settings")
export class WebchatSettings {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid", name: "organization_id" })
  organizationId!: string;

  // Appearance
  @Column({ type: "varchar", length: 100, name: "widget_title", default: "Chat with us" })
  widgetTitle!: string;

  @Column({
    type: "enum",
    enum: WebchatPosition,
    default: WebchatPosition.RIGHT,
  })
  position!: WebchatPosition;

  @Column({ type: "varchar", length: 10, default: "light" })
  themeMode!: WebchatThemeMode;

  // Brand colour (hex "#rrggbb"). Imported from the website icon unless the
  // merchant picked one (brandColorSource "custom"); a null source means the
  // default colour, nothing imported or chosen yet.
  @Column({ type: "varchar", length: 7, default: DEFAULT_WEBCHAT_BRAND_COLOR })
  brandColor!: string;

  @Column({ type: "varchar", length: 10, nullable: true })
  brandColorSource!: WebchatBrandingSource | null;

  // Up to 3 hex colours extracted from the website icon, most prominent first.
  @Column({ type: "text", array: true, default: () => "'{}'" })
  brandPalette!: string[];

  // Widget logo: imported from the website icon or uploaded by the merchant.
  // No logo falls back to the organization logo.
  @OneToOne(() => Upload, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "logo_upload_id" })
  logoUpload?: Upload | null;

  @Column({ type: "uuid", nullable: true })
  logoUploadId!: string | null;

  @Column({ type: "varchar", length: 10, nullable: true })
  logoSource!: WebchatBrandingSource | null;

  // The chat button's icon. The default (an outlined chat bubble) is the
  // button as it was before this was a setting. "custom" shows
  // launcherIconUpload, an SVG the merchant uploaded, rendered to a PNG.
  @Column({ type: "varchar", length: 10, default: "chat" })
  launcherIcon!: WebchatLauncherIcon;

  @Column({ type: "varchar", length: 10, default: "outline" })
  launcherIconStyle!: WebchatLauncherIconStyle;

  @OneToOne(() => Upload, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "launcher_icon_upload_id" })
  launcherIconUpload?: Upload | null;

  @Column({ type: "uuid", nullable: true })
  launcherIconUploadId!: string | null;

  // When the website branding was last imported (or attempted). The lazy
  // import on a settings read only runs while this is null.
  @Column({ type: "timestamptz", nullable: true })
  brandingImportedAt!: Date | null;

  // Home view heading (null = the widget's localized default).
  @Column({ type: "varchar", length: 120, nullable: true })
  homeHeading!: string | null;

  // Behavior
  @Column({ type: "boolean", name: "show_greeting", default: true })
  showGreeting!: boolean;

  @Column({
    type: "text",
    name: "greeting_message",
    nullable: true,
    default: "Hello! How can we help you today?",
  })
  greetingMessage!: string | null;

  // Shown next to the chat button before the visitor opens the chat (null = none)
  @Column({ type: "varchar", length: 200, name: "teaser_message", nullable: true })
  teaserMessage!: string | null;

  // CSAT (customer satisfaction rating shown when a conversation ends)
  @Column({ type: "boolean", name: "csat_enabled", default: true })
  csatEnabled!: boolean;

  // Null = the widget's localized default question.
  @Column({ type: "text", name: "csat_question", nullable: true })
  csatQuestion!: string | null;

  // Security
  // Empty = only the organization's own website (see isDomainAllowed).
  @Column({ type: "text", array: true, name: "allowed_domains", default: () => "'{}'" })
  allowedDomains!: string[];

  @Column({ type: "boolean", name: "is_enabled", default: true })
  isEnabled!: boolean;

  // Spam (D9-6 / D9-7)
  @Column({ type: "boolean", name: "spam_classifier_enabled", default: false })
  spamClassifierEnabled!: boolean;

  @Column({ type: "text", name: "spam_guidance", nullable: true })
  spamGuidance!: string | null;

  // Under-attack mode (D9-10): everyone is challenged until this time.
  @Column({ type: "timestamptz", name: "under_attack_until", nullable: true })
  underAttackUntil!: Date | null;

  @Column({ type: "varchar", length: 20, name: "under_attack_source", nullable: true })
  underAttackSource!: "owner" | "auto" | null;

  // Customer identity (D1): HMAC key for signing `customerExternalId`, encrypted
  // with encryptValue. Never loaded by default; read through
  // webchat-identity.service only, and shown to org admins only.
  @Column({ type: "text", name: "identity_secret", nullable: true, select: false })
  identitySecret!: string | null;

  // Advanced
  @Column({ type: "text", name: "custom_css", nullable: true })
  customCss!: string | null;

  // Pre-chat form the widget asks before the first message (null = none)
  @Column({ type: "jsonb", name: "pre_chat_form", nullable: true })
  preChatForm!: FormSchema | null;

  // Page tools (WebMCP): off until the organization turns them on. With no
  // allowedOrigins, the allowed domains apply (except `*`).
  @Column({ type: "jsonb", default: () => `'{"enabled":false}'` })
  pageTools!: WebchatPageToolsSettings;

  // Install detection: the last page origin that loaded the widget, and when.
  @Column({ type: "timestamptz", nullable: true })
  lastSeenAt!: Date | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  lastSeenOrigin!: string | null;

  // Timestamps
  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;

  // Relationships
  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "organization_id" })
  organization!: Organization;
}
