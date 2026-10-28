import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { Conversation } from "./conversation.entity";
import { Source } from "./source.entity";
import { User } from "../../entities/user.entity";
import { DeliveryState } from "../../types/message-feedback.types";

export enum MessageType {
  CUSTOMER = "Customer",
  SYSTEM = "System",
  HUMAN_AGENT = "HumanAgent",
  BOT_AGENT = "BotAgent",
  TOOL = "Tool",
  DOCUMENT = "Document",
  PLAYBOOK = "Playbook",
  PRODUCT_RECOMMENDATION = "ProductRecommendation",
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

export type MessageProviderStatus = "sent" | "delivered" | "read" | "failed";

export interface MessageProviderError {
  code?: string | number;
  title?: string;
  message?: string;
}

export interface MessageAttachment {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
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

  @Index("idx_messages_provider_message_id")
  @Column({ type: "varchar", length: 255, nullable: true })
  providerMessageId!: string | null;

  /**
   * Delivery status reported by the channel provider (e.g. Meta WhatsApp
   * status webhooks). Independent from `deliveryState`, which is the
   * test-mode approval gate and must never carry provider statuses.
   */
  @Column({ type: "varchar", length: 20, nullable: true })
  providerStatus!: MessageProviderStatus | null;

  @Column({ type: "jsonb", nullable: true })
  providerError!: MessageProviderError | null;

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
    /** AI processing region in effect when a BotAgent reply was saved (D14-5). */
    aiRegion?: "default" | "eu";
    confidence?: number;
    confidenceBreakdown?: {
      grounding: number;
      retrieval: number;
      certainty: number;
    };
    confidenceTier?: "high" | "medium" | "low";
    confidenceDetails?: string;
    documentsUsed?: Array<{ id: string; title: string; similarity: number }>;
    recheckAttempted?: boolean;
    recheckCount?: number;
    // Tool execution metadata
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolOutput?: unknown;
    toolLatencyMs?: number;
    /** Tool error code from @hay/plugin-sdk/tool-errors when toolStatus is ERROR. */
    toolErrorCode?: string;
    toolStatus?: string;
    toolExecutedAt?: string;
    /** The pending action this call opened or answered from (D4-4). */
    pendingActionId?: string;
    /** System note telling the AI how a team member decided that action. */
    isApprovalDecision?: boolean;
    // Playbook & Document metadata
    isPlaybook?: boolean;
    playbookId?: string;
    playbookTitle?: string;
    documentId?: string;
    documentTitle?: string;
    // Conversation management metadata
    isInactivityWarning?: boolean;
    warningTimestamp?: string;
    reason?: string;
    inactivity_duration_ms?: number;
    isClosureMessage?: boolean;
    closureReason?: string;
    blockReason?: string;
    // Handoff metadata
    isHandoffMessage?: boolean;
    handoffType?: string;
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

  @Column({ type: "varchar", length: 10, nullable: true })
  detectedLanguage!: string | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @Column({ type: "jsonb", nullable: true })
  attachments!: MessageAttachment[];

  @Column({
    type: "enum",
    enum: MessageStatus,
    default: MessageStatus.APPROVED,
  })
  status!: MessageStatus;

  @Column({ type: "varchar", length: 50, default: "webchat" })
  sourceId!: string;

  @ManyToOne(() => Source, (source) => source.messages, {
    onDelete: "RESTRICT",
  })
  @JoinColumn()
  source!: Source;

  @Column({ type: "boolean", default: false })
  reviewRequired!: boolean;

  @Column({
    type: "enum",
    enum: DeliveryState,
    default: DeliveryState.SENT,
  })
  deliveryState!: DeliveryState;

  @Column({ type: "uuid", nullable: true })
  approvedBy!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "approved_by" })
  approver!: User | null;

  @Column({ type: "timestamptz", nullable: true })
  approvedAt!: Date | null;

  @Column({ type: "text", nullable: true })
  originalContent!: string | null;

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
    language?: string;
  }): Promise<Message | null> {
    const { MessageRepository } = await import("../../repositories/message.repository");
    const messageRepository = new MessageRepository();
    return messageRepository.update(this.id, {
      intent: perception.intent,
      sentiment: perception.sentiment,
      ...(perception.language && { detectedLanguage: perception.language }),
    });
  }
}
