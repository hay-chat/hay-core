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

  @Column({ type: "uuid", array: true, nullable: true })
  document_ids!: string[] | null;

  @OneToMany(() => Message, message => message.conversation)
  messages!: Message[];

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  async getLastCustomerMessage(): Promise<Message | null> {
    const { conversationRepository } = await import('../../repositories/conversation.repository');
    return conversationRepository.getLastHumanMessage(this.id);
  }

  async lock(): Promise<void> {
    const { conversationRepository } = await import('../../repositories/conversation.repository');
    const lockDuration = 5 * 60 * 1000; // 5 minutes in milliseconds
    const lockUntil = new Date(Date.now() + lockDuration);
    await conversationRepository.update(this.id, this.organization_id, {
      processing_locked_until: lockUntil,
      processing_locked_by: 'orchestrator-v2',
    });
  }

  async unlock(): Promise<void> {
    const { conversationRepository } = await import('../../repositories/conversation.repository');
    await conversationRepository.update(this.id, this.organization_id, {
      processing_locked_until: null,
      processing_locked_by: null,
    });
  }

  updateAgent(agentId: string): void {
    this.agent_id = agentId;
  }

  async updatePlaybook(playbookId: string): Promise<void> {
    const { conversationRepository } = await import('../../repositories/conversation.repository');
    await conversationRepository.update(this.id, this.organization_id, {
      playbook_id: playbookId,
    });
    this.playbook_id = playbookId;
  }

  async addDocument(documentId: string): Promise<void> {
    const { conversationRepository } = await import('../../repositories/conversation.repository');
    const currentDocIds = this.document_ids || [];
    if (!currentDocIds.includes(documentId)) {
      const updatedDocIds = [...currentDocIds, documentId];
      await conversationRepository.update(this.id, this.organization_id, {
        document_ids: updatedDocIds,
      });
      this.document_ids = updatedDocIds;
    }
  }

  async getPublicMessages(): Promise<Message[]> {
    const { conversationRepository } = await import('../../repositories/conversation.repository');
    return conversationRepository.getPublicMessages(this.id);
  }

  async getMessages(): Promise<Message[]> {
    const { conversationRepository } = await import('../../repositories/conversation.repository');
    return conversationRepository.getMessages(this.id);
  }

  async addMessage(messageData: {
    content: string;
    type: string;
    metadata?: Record<string, any>;
  }): Promise<Message> {
    const { messageRepository } = await import('../../repositories/message.repository');
    return messageRepository.create({
      conversation_id: this.id,
      content: messageData.content,
      type: messageData.type as any,
      metadata: messageData.metadata,
    });
  }

  async getSystemMessages(): Promise<Message[]> {
    const { conversationRepository } = await import('../../repositories/conversation.repository');
    return conversationRepository.getSystemMessages(this.id);
  }

  async getBotMessages(): Promise<Message[]> {
    const { conversationRepository } = await import('../../repositories/conversation.repository');
    return conversationRepository.getBotMessages(this.id);
  }

  async addInitialSystemMessage(): Promise<Message> {
    const systemContent = `You are a helpful AI assistant. You should provide accurate, helpful responses based on available context and documentation. Always be professional and courteous.

Key behaviors:
- Use available documentation and context to provide accurate answers
- If you don't know something, clearly state that
- Follow any active playbook instructions when provided
- Be concise but thorough in your responses
- Maintain conversation context throughout the interaction`;

    return this.addMessage({
      content: systemContent,
      type: 'System'
    });
  }

  async addInitialBotMessage(): Promise<Message> {
    return this.addMessage({
      content: 'Hello! How can I help you today?',
      type: 'BotAgent'
    });
  }

  async setProcessed(processed: boolean): Promise<void> {
    const { conversationRepository } = await import('../../repositories/conversation.repository');
    
    if (processed) {
      // When marking as processed, set both last_processed_at and needs_processing
      const { getUTCNow } = await import('../../utils/date.utils');
      const now = getUTCNow();
      
      await conversationRepository.updateById(this.id, {
        last_processed_at: now,
        needs_processing: false,
      });
      
      // Update local instance
      this.last_processed_at = now;
      this.needs_processing = false;
    } else {
      // When marking as not processed, only update needs_processing
      await conversationRepository.updateById(this.id, {
        needs_processing: true,
      });
      
      // Update local instance
      this.needs_processing = true;
    }
  }
}