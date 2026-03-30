import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  ManyToMany,
  OneToMany,
  JoinColumn,
  JoinTable,
} from "typeorm";
import { Organization } from "../../entities/organization.entity";
import { Agent } from "./agent.entity";
import { PlaybookVersion } from "./playbook-version.entity";

export enum PlaybookStatus {
  DRAFT = "draft",
  ACTIVE = "active",
  ARCHIVED = "archived",
}

export enum PlaybookKind {
  WELCOME = "welcome",
  ENDER = "ender",
  CUSTOM = "custom",
}

export interface InstructionItem {
  id: string;
  level: number;
  instructions: string;
}

@Entity("playbooks")
export class Playbook {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 255 })
  title!: string;

  @Column({ type: "varchar", length: 255 })
  trigger!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ type: "jsonb", nullable: true })
  instructions!: InstructionItem[] | string | null;

  @Column({
    type: "enum",
    enum: PlaybookKind,
    default: PlaybookKind.CUSTOM,
  })
  kind!: PlaybookKind;

  @Column({ type: "jsonb", nullable: true })
  required_fields!: string[] | null;

  @Column({ type: "text", nullable: true })
  prompt_template!: string | null;

  @Column({ type: "boolean", default: false })
  is_system!: boolean;

  @Column({
    type: "enum",
    enum: PlaybookStatus,
    default: PlaybookStatus.DRAFT,
  })
  status!: PlaybookStatus;

  @Column({ type: "uuid", nullable: true })
  organization_id!: string | null;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn()
  organization!: Organization;

  @Column({ type: "uuid", nullable: true })
  active_version_id!: string | null;

  @Column({ type: "uuid", nullable: true })
  draft_version_id!: string | null;

  @ManyToMany(() => Agent, (agent) => agent.playbooks)
  @JoinTable({
    name: "playbook_agents",
    joinColumn: {
      name: "playbook_id",
      referencedColumnName: "id",
    },
    inverseJoinColumn: {
      name: "agent_id",
      referencedColumnName: "id",
    },
  })
  agents!: Agent[];

  @OneToMany(() => PlaybookVersion, (version) => version.playbook)
  versions!: PlaybookVersion[];

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
