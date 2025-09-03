import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn
} from "typeorm";
import { Organization } from "../../entities/organization.entity";
import { Agent } from "./agent.entity";
import { Message } from "./message.entity";
import { Customer } from "./customer.entity";

@Entity("conversations")
export class Conversation {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 255 })
  title!: string;

  @Column({ 
    type: "enum",
    enum: ["open", "processing", "pending-human", "resolved", "closed"],
    default: "open"
  })
  status!: "open" | "processing" | "pending-human" | "resolved" | "closed";

  @Column({ type: "timestamptz", nullable: true })
  cooldown_until!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  last_user_message_at!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  ended_at!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  closed_at!: Date | null;

  @Column({ type: "jsonb", nullable: true })
  context!: Record<string, any> | null;

  @Column({ type: "jsonb", nullable: true })
  resolution_metadata!: { resolved: boolean; confidence: number; reason: string } | null;

  @Column({ type: "uuid", nullable: true })
  agent_id!: string | null;

  @ManyToOne(() => Agent, { onDelete: "SET NULL", nullable: true })
  @JoinColumn()
  agent!: Agent | null;

  @Column({ type: "uuid" })
  organization_id!: string;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn()
  organization!: Organization;

  @Column({ type: "uuid", nullable: true })
  playbook_id!: string | null;

  @Column({ type: "jsonb", nullable: true })
  metadata!: Record<string, any> | null;

  @Column({ type: "boolean", default: false })
  needs_processing!: boolean;

  @Column({ type: "timestamptz", nullable: true })
  last_processed_at!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  processing_locked_until!: Date | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  processing_locked_by!: string | null;

  @Column({ type: "uuid", nullable: true })
  customer_id!: string | null;

  @ManyToOne(() => Customer, customer => customer.conversations, { onDelete: "SET NULL", nullable: true })
  @JoinColumn()
  customer!: Customer | null;

  @Column({ type: "jsonb", nullable: true })
  orchestration_status!: Record<string, any> | null;

  @OneToMany(() => Message, message => message.conversation)
  messages!: Message[];

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}