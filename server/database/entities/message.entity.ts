import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn
} from "typeorm";
import { Conversation } from "./conversation.entity";

export enum MessageType {
  CUSTOMER = "Customer",
  SYSTEM = "System", 
  HUMAN_AGENT = "HumanAgent",
  BOT_AGENT = "BotAgent",
  TOOL_CALL = "ToolCall",
  TOOL_RESPONSE = "ToolResponse"
}

@Entity("messages")
export class Message {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  conversation_id!: string;

  @ManyToOne(() => Conversation, conversation => conversation.messages, { onDelete: "CASCADE" })
  @JoinColumn()
  conversation!: Conversation;

  @Column({ type: "text" })
  content!: string;

  @Column({
    type: "enum",
    enum: MessageType
  })
  type!: MessageType;

  @Column({ type: "jsonb", nullable: true })
  usage_metadata!: Record<string, any> | null;

  @Column({ type: "varchar", length: 100, nullable: true })
  sender!: string | null;

  @Column({ type: "jsonb", nullable: true })
  metadata!: {
    model?: string;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    latency_ms?: number;
    plan?: string;
    path?: "docqa" | "playbook";
    tools?: string[];
    playbook_id?: string;
    confidence?: number;
    referenced_actions?: string[];
    referenced_documents?: string[];
  } | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}