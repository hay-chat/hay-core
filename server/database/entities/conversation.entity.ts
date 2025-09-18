import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from "typeorm";
import { Organization } from "../../entities/organization.entity";
import { Agent } from "./agent.entity";
import { Message } from "./message.entity";
import { Customer } from "./customer.entity";
import { MessageType } from "./message.entity";
import { analyzeInstructions } from "../../utils/instruction-formatter";
import { documentRepository } from "../../repositories/document.repository";

@Entity("conversations")
export class Conversation {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 255 })
  title!: string;

  @Column({
    type: "enum",
    enum: ["open", "processing", "pending-human", "resolved", "closed"],
    default: "open",
  })
  status!: "open" | "processing" | "pending-human" | "resolved" | "closed";

  @Column({ type: "timestamptz", nullable: true })
  cooldown_until!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  ended_at!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  closed_at!: Date | null;

  @Column({ type: "jsonb", nullable: true })
  context!: Record<string, unknown> | null;

  @Column({ type: "jsonb", nullable: true })
  resolution_metadata!: {
    resolved: boolean;
    confidence: number;
    reason: string;
  } | null;

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
  metadata!: Record<string, unknown> | null;

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

  @ManyToOne(() => Customer, (customer) => customer.conversations, {
    onDelete: "SET NULL",
    nullable: true,
  })
  @JoinColumn()
  customer!: Customer | null;

  @Column({ type: "jsonb", nullable: true })
  orchestration_status!: Record<string, unknown> | null;

  @Column({ type: "uuid", array: true, nullable: true })
  document_ids!: string[] | null;

  @Column({ type: "text", array: true, nullable: true })
  enabled_tools!: string[] | null;

  @OneToMany(() => Message, (message) => message.conversation)
  messages!: Message[];

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  async getLastCustomerMessage(): Promise<Message | null> {
    const { conversationRepository } = await import("../../repositories/conversation.repository");
    return conversationRepository.getLastHumanMessage(this.id);
  }

  async lock(): Promise<void> {
    const { conversationRepository } = await import("../../repositories/conversation.repository");
    const lockDuration = 5 * 60 * 1000; // 5 minutes in milliseconds
    const lockUntil = new Date(Date.now() + lockDuration);
    await conversationRepository.update(this.id, this.organization_id, {
      processing_locked_until: lockUntil,
      processing_locked_by: "orchestrator-v2",
    });
  }

  async unlock(): Promise<void> {
    const { conversationRepository } = await import("../../repositories/conversation.repository");
    await conversationRepository.update(this.id, this.organization_id, {
      processing_locked_until: null,
      processing_locked_by: null,
    });
  }

  async updateAgent(agentId: string): Promise<void> {
    const { agentRepository } = await import("../../repositories/agent.repository");

    const { conversationRepository } = await import("../../repositories/conversation.repository");

    const agent = await agentRepository.findById(agentId);
    this.agent_id = agentId;

    let content = "";

    content += `You are the agent: ${agent?.name}`;
    content += `\nYour tone should be: ${agent?.tone}`;
    content += `\nYou should avoid: ${agent?.avoid}`;
    content += `\nHere are some general instructions: ${agent?.instructions}`;

    await this.addMessage({
      content,
      type: "System",
    });

    await conversationRepository.update(this.id, this.organization_id, {
      agent_id: agentId,
    });
  }

  async updatePlaybook(playbookId: string): Promise<void> {
    const { conversationRepository } = await import("../../repositories/conversation.repository");
    // Initialize enabled tools array
    const enabledToolIds: string[] = [];
    const { playbookRepository } = await import("../../repositories/playbook.repository");
    const playbook = await playbookRepository.findById(playbookId);
    if (!playbook) {
      return;
    }

    // Handle different instruction formats
    let instructionText = "";
    let referencedActions: string[] = [];

    if (playbook.instructions) {
      if (typeof playbook.instructions === "string") {
        instructionText = playbook.instructions;
      } else if (Array.isArray(playbook.instructions)) {
        const analysis = analyzeInstructions(playbook.instructions);
        instructionText = analysis.formattedText;
        referencedActions = analysis.actions;
      }
    }

    // Get tool schemas from plugin manager service
    const toolSchemas: Array<Record<string, unknown>> = [];
    try {
      const { pluginManagerService } = await import("../../services/plugin-manager.service");
      const allPlugins = pluginManagerService.getAllPlugins();

      // Extract tool schemas from all plugins
      for (const plugin of allPlugins) {
        const manifest = plugin.manifest as any;
        if (manifest?.capabilities?.mcp?.tools) {
          toolSchemas.push(...manifest.capabilities.mcp.tools);
        }
      }
    } catch (error) {
      console.warn("Could not fetch tool schemas:", error);
    }

    let content = "";
    content += `From this message forward you should be following this playbook:

        **Playbook: ${playbook.title}**
        ${playbook.description ? `\nDescription: ${playbook.description}` : ""}

        **Instructions:**
        ${instructionText}

        **Required Fields:**
        ${playbook.required_fields?.length ? playbook.required_fields.join(", ") : "None"}

        **Trigger:** ${playbook.trigger}`;

    // Add referenced actions with tool schemas if available
    if (referencedActions.length > 0 && toolSchemas && toolSchemas.length > 0) {
      content += `\n\n**Referenced Actions:**
The following tools are available for you to use. You MUST return only valid JSON when calling tools, with no additional text:`;

      const actionDetails = referencedActions.map((actionName) => {
        let toolSchema = toolSchemas.find((schema) => schema.name === actionName);

        if (!toolSchema && actionName.includes(":")) {
          const parts = actionName.split(":");
          if (parts.length >= 2) {
            const toolName = parts[parts.length - 1];
            toolSchema = toolSchemas.find((schema) => schema.name === toolName);

            if (!toolSchema) {
              const toolNameSuffix = parts.slice(1).join(":");
              toolSchema = toolSchemas.find((schema) => schema.name === toolNameSuffix);
            }
          }
        }

        if (toolSchema) {
          // Add tool ID to enabled_tools list
          if (!enabledToolIds.includes(toolSchema.name as string)) {
            enabledToolIds.push(toolSchema.name as string);
          }

          // Get the actual input schema - check both 'input_schema' (plugin manifest format) and 'parameters' (alternative format)
          const inputSchema: any = toolSchema.input_schema || toolSchema.parameters || {};
          const requiredFields =
            inputSchema.required && Array.isArray(inputSchema.required) && inputSchema.required.length > 0
              ? ` (Required: ${(inputSchema.required as string[]).join(", ")})`
              : "";

          return `- **${actionName}**: ${
            toolSchema.description
          }${requiredFields}\n  Input Schema: ${JSON.stringify(inputSchema, null, 2)}`;
        } else {
          return `- **${actionName}**: Action not found in available tools`;
        }
      });

      content += `\n${actionDetails.join("\n\n")}`;
    } else if (referencedActions.length > 0) {
      // Fallback to simple list if no tool schemas provided
      content += `\n\n**Referenced Actions:**\n`;
      content += referencedActions.map((action) => `- ${action}`).join("\n");
    }

    await this.addMessage({
      content,
      type: "Playbook",
      metadata: {
        playbookId: playbookId,
        playbookTitle: playbook.title,
      },
    });

    // Update conversation with playbook_id and enabled_tools
    await conversationRepository.update(this.id, this.organization_id, {
      playbook_id: playbookId,
      enabled_tools: enabledToolIds.length > 0 ? enabledToolIds : null,
    });

    this.playbook_id = playbookId;
    this.enabled_tools = enabledToolIds.length > 0 ? enabledToolIds : null;
  }

  async addDocument(documentId: string): Promise<void> {
    const { conversationRepository } = await import("../../repositories/conversation.repository");

    if (!this.document_ids?.includes(documentId)) {
      console.log("Adding document to conversation", documentId);
      console.log("Current document ids", this.document_ids);
      const updatedDocIds = [...(this.document_ids || []), documentId];
      console.log("Updated document ids", updatedDocIds);
      await conversationRepository.update(this.id, this.organization_id, {
        document_ids: updatedDocIds,
      });
      this.document_ids = updatedDocIds;

      const document = await documentRepository.findById(documentId);

      await this.addMessage({
        content: `# ${document?.title} added to conversation \n ${document?.content}`,
        type: "Document",
        metadata: {
          documentId: document?.id,
          documentTitle: document?.title,
        },
      });
    }
  }

  async getPublicMessages(): Promise<Message[]> {
    const { conversationRepository } = await import("../../repositories/conversation.repository");
    return conversationRepository.getPublicMessages(this.id);
  }

  async getMessages(): Promise<Message[]> {
    const { conversationRepository } = await import("../../repositories/conversation.repository");
    return conversationRepository.getMessages(this.id);
  }

  async addMessage(messageData: {
    content: string;
    type: string;
    metadata?: Record<string, unknown>;
  }): Promise<Message> {
    const { messageRepository } = await import("../../repositories/message.repository");
    return messageRepository.create({
      conversation_id: this.id,
      content: messageData.content,
      type: messageData.type as MessageType,
      metadata: messageData.metadata,
    });
  }

  async getSystemMessages(): Promise<Message[]> {
    const { conversationRepository } = await import("../../repositories/conversation.repository");
    return conversationRepository.getSystemMessages(this.id);
  }

  async getBotMessages(): Promise<Message[]> {
    const { conversationRepository } = await import("../../repositories/conversation.repository");
    return conversationRepository.getBotMessages(this.id);
  }

  async addInitialSystemMessage(): Promise<Message> {
    const systemContent = `You are a helpful AI assistant. You should provide accurate, helpful responses based on available context and documentation. Always be professional and courteous.

    Key behaviors:
    - Use available documentation and context to provide accurate answers
    - If you don't know something, clearly state that
    - Follow any active playbook instructions when provided
    - Be concise but thorough in your responses
    - Maintain conversation context throughout the interaction
    - Use available tools to provide accurate answers
    - You can call tools iteratively if needed, you're going to get the response from the tool call in the next step and be asked to continue with the conversation or call another tool
    - You're not a human, the only way you can interact with any type of system is by calling tools, do not provide information about external actions to the user unless you have a tool call response`;

    return this.addMessage({
      content: systemContent,
      type: "System",
    });
  }

  async addInitialBotMessage(): Promise<Message> {
    return this.addMessage({
      content: "Hello! How can I help you today?",
      type: "BotAgent",
    });
  }

  async setProcessed(processed: boolean): Promise<void> {
    const { conversationRepository } = await import("../../repositories/conversation.repository");

    if (processed) {
      // When marking as processed, set both last_processed_at and needs_processing
      const { getUTCNow } = await import("../../utils/date.utils");
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
