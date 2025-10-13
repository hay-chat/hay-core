import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  ManyToMany,
  JoinColumn,
} from "typeorm";
import { Organization } from "../../entities/organization.entity";
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

  @Column({ type: "text", nullable: true })
  instructions!: string | null;

  @Column({ type: "text", nullable: true })
  tone!: string | null;

  @Column({ type: "text", nullable: true })
  avoid!: string | null;

  @Column({ type: "text", nullable: true })
  trigger!: string | null;

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

  @Column({ type: "boolean", nullable: true })
  testMode!: boolean | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
