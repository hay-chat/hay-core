import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  ManyToMany,
  JoinColumn,
  JoinTable
} from "typeorm";
import { Organization } from "../../entities/organization.entity";
import { Agent } from "./agent.entity";

export enum PlaybookStatus {
  DRAFT = "draft",
  ACTIVE = "active",
  ARCHIVED = "archived"
}

@Entity("playbooks")
export class Playbook {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ type: "text", nullable: true })
  instructions!: string | null;

  @Column({
    type: "enum",
    enum: PlaybookStatus,
    default: PlaybookStatus.DRAFT
  })
  status!: PlaybookStatus;

  @Column({ type: "uuid" })
  organization_id!: string;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "organization_id" })
  organization!: Organization;

  @ManyToMany(() => Agent)
  @JoinTable({
    name: "playbook_agents",
    joinColumn: {
      name: "playbook_id",
      referencedColumnName: "id"
    },
    inverseJoinColumn: {
      name: "agent_id",
      referencedColumnName: "id"
    }
  })
  agents!: Agent[];

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}