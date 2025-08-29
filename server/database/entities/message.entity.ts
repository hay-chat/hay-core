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
  AI_MESSAGE = "AIMessage",
  CHAT_MESSAGE = "ChatMessage",
  FUNCTION_MESSAGE = "FunctionMessage",
  HUMAN_MESSAGE = "HumanMessage",
  TOOL_MESSAGE = "ToolMessage",
  SYSTEM_MESSAGE = "SystemMessage"
}

@Entity("messages")
export class Message {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  conversation_id!: string;

  @ManyToOne(() => Conversation, conversation => conversation.messages, { onDelete: "CASCADE" })
  @JoinColumn({ name: "conversation_id" })
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

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}