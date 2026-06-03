import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Playbook } from "./playbook.entity";
import type { PlaybookInstructions } from "./playbook.entity";
import { User } from "../../entities/user.entity";

export enum PlaybookVersionStatus {
  DRAFT = "draft",
  ACTIVE = "active",
  ARCHIVED = "archived",
}

@Entity("playbook_versions")
export class PlaybookVersion {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  playbook_id!: string;

  @ManyToOne(() => Playbook, (playbook) => playbook.versions, { onDelete: "CASCADE" })
  @JoinColumn({ name: "playbook_id" })
  playbook!: Playbook;

  @Column({ type: "int" })
  version_number!: number;

  @Column({ type: "varchar", length: 20, default: PlaybookVersionStatus.DRAFT })
  status!: PlaybookVersionStatus;

  @Column({ type: "jsonb", nullable: true })
  instructions!: PlaybookInstructions;

  @Column({ type: "text", nullable: true })
  prompt_template!: string | null;

  @Column({ type: "jsonb", nullable: true })
  required_fields!: string[] | null;

  @Column({ type: "text", nullable: true })
  publish_note!: string | null;

  @Column({ type: "uuid", nullable: true })
  created_by_id!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "created_by_id" })
  created_by!: User | null;

  @Column({ type: "uuid", nullable: true })
  published_by_id!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "published_by_id" })
  published_by!: User | null;

  @Column({ type: "timestamptz", nullable: true })
  published_at!: Date | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
