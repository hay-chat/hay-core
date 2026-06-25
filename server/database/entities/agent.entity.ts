import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  ManyToMany,
  OneToOne,
  JoinColumn,
} from "typeorm";
import { Organization } from "../../entities/organization.entity";
import { Upload } from "../../entities/upload.entity";
import { Playbook } from "./playbook.entity";

@Entity("agents")
export class Agent {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @Column({ type: "jsonb", nullable: true })
  instructions!: unknown[] | null;

  @Column({ type: "text", nullable: true })
  tone!: string | null;

  @Column({ type: "text", nullable: true })
  avoid!: string | null;

  @Column({ type: "text", nullable: true })
  trigger!: string | null;

  @Column({ type: "text", nullable: true })
  initialGreeting!: string | null;

  @Column({ type: "jsonb", nullable: true })
  human_handoff_available_instructions!: unknown[] | null;

  @Column({ type: "jsonb", nullable: true })
  human_handoff_unavailable_instructions!: unknown[] | null;

  @Column({ type: "uuid" })
  organization_id!: string;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn()
  organization!: Organization;

  @ManyToMany(() => Playbook, (playbook) => playbook.agents)
  playbooks!: Playbook[];

  // Avatar upload relationship
  @OneToOne(() => Upload, { nullable: true, eager: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "avatar_upload_id" })
  avatarUpload?: Upload;

  @Column({ type: "uuid", nullable: true })
  avatarUploadId?: string | null;

  /**
   * Public URL for {@link avatarUpload}, derived on read (not a column).
   * Populated by the conversation service so the dashboard can render the
   * agent's avatar without knowing storage internals.
   */
  avatarUrl?: string | null;

  @Column({ type: "boolean", nullable: true })
  testMode!: boolean | null;

  @Column({ type: "varchar", length: 10, nullable: true })
  language!: string | null;

  /**
   * Channels this agent is assigned to (many-to-many: a channel id can appear on
   * multiple agents, an agent can hold multiple channels). Channel ids are the
   * canonical plugin `manifest.channel` strings (e.g. "instagram") plus the
   * built-in "web". An incoming message still resolves to a single responder per
   * channel — see getAgentForChannel in plugin-api/trpc.ts.
   */
  @Column({ type: "text", array: true, default: () => "'{}'" })
  channels!: string[];

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
