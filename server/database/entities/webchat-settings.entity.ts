import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Organization } from "../../entities/organization.entity";

export enum WebchatPosition {
  LEFT = "left",
  RIGHT = "right",
}

export enum WebchatTheme {
  BLUE = "blue",
  GREEN = "green",
  PURPLE = "purple",
  BLACK = "black",
}

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
    type: "varchar",
    length: 200,
    name: "widget_subtitle",
    nullable: true,
  })
  widgetSubtitle!: string | null;

  @Column({
    type: "enum",
    enum: WebchatPosition,
    default: WebchatPosition.RIGHT,
  })
  position!: WebchatPosition;

  @Column({
    type: "enum",
    enum: WebchatTheme,
    default: WebchatTheme.BLUE,
  })
  theme!: WebchatTheme;

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

  // Security
  @Column({ type: "text", array: true, name: "allowed_domains", default: () => "ARRAY['*']" })
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

  // Advanced
  @Column({ type: "text", name: "custom_css", nullable: true })
  customCss!: string | null;

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
