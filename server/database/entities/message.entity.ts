import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Conversation } from "./conversation.entity";

export enum MessageType {
  CUSTOMER = "Customer",
  SYSTEM = "System",
  HUMAN_AGENT = "HumanAgent",
  BOT_AGENT = "BotAgent",
  TOOL_CALL = "ToolCall",
  TOOL_RESPONSE = "ToolResponse",
  DOCUMENT = "Document",
  PLAYBOOK = "Playbook",
}

export enum MessageDirection {
  IN = "in",
  OUT = "out",
}

export enum MessageSentiment {
  POSITIVE = "positive",
  NEUTRAL = "neutral",
  NEGATIVE = "negative",
}

export enum MessageIntent {
  GREET = "greet",
  QUESTION = "question",
  REQUEST = "request",
  HANDOFF = "handoff",
  CLOSE_SATISFIED = "close_satisfied",
  CLOSE_UNSATISFIED = "close_unsatisfied",
  OTHER = "other",
  UNKNOWN = "unknown",
}

export enum MessageStatus {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
  EDITED = "edited",
}

@Entity("messages")
export class Message {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  conversation_id!: string;

  @ManyToOne(() => Conversation, (conversation) => conversation.messages, {
    onDelete: "CASCADE",
  })
  @JoinColumn()
  conversation!: Conversation;

  @Column({ type: "text" })
  content!: string;

  @Column({
    type: "enum",
    enum: MessageType,
  })
  type!: MessageType;

  @Column({
    type: "enum",
    enum: MessageDirection,
    default: MessageDirection.IN,
  })
  direction!: MessageDirection;

  @Column({ type: "varchar", length: 255, nullable: true })
  providerMessageId!: string | null;

  @Column({ type: "jsonb", nullable: true })
  usage_metadata!: Record<string, unknown> | null;

  @Column({ type: "varchar", length: 100, nullable: true })
  sender!: string | null;

  @Column({ type: "jsonb", nullable: true })
  metadata!: {
    model?: string;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    latency_ms?: number;
    confidence?: number;
    toolStatus?: string;
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    toolResult?: Record<string, unknown>;
    tool_call?: {
      tool_name: string;
      arguments: Record<string, unknown>;
    };
    isPlaybook?: boolean;
    playbookId?: string;
    playbookTitle?: string;
    documentId?: string;
    documentTitle?: string;
    isInactivityWarning?: boolean;
    warningTimestamp?: string;
    reason?: string;
    inactivity_duration_ms?: number;
    isClosureMessage?: boolean;
    closureReason?: string;
  } | null;

  @Column({
    type: "enum",
    enum: MessageSentiment,
    nullable: true,
  })
  sentiment!: MessageSentiment | null;

  @Column({
    type: "enum",
    enum: MessageIntent,
    nullable: true,
  })
  intent!: MessageIntent | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @Column({ type: "jsonb", nullable: true })
  attachments!: Array<{
    id: string;
    name: string;
    url: string;
    type: string;
    size: number;
  }>;

  @Column({
    type: "enum",
    enum: MessageStatus,
    default: MessageStatus.APPROVED,
  })
  status!: MessageStatus;

  async saveIntent(intent: MessageIntent): Promise<Message | null> {
    const { MessageRepository } = await import("../../repositories/message.repository");
    const messageRepository = new MessageRepository();
    return messageRepository.update(this.id, { intent });
  }

  async saveSentiment(sentiment: MessageSentiment): Promise<Message | null> {
    const { MessageRepository } = await import("../../repositories/message.repository");
    const messageRepository = new MessageRepository();
    return messageRepository.update(this.id, { sentiment });
  }

  async savePerception(perception: {
    intent: MessageIntent;
    sentiment: MessageSentiment;
  }): Promise<Message | null> {
    const { MessageRepository } = await import("../../repositories/message.repository");
    const messageRepository = new MessageRepository();
    return messageRepository.update(this.id, {
      intent: perception.intent,
      sentiment: perception.sentiment,
    });
  }
}
