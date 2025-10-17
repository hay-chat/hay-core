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
import { User } from "../../entities/user.entity";
import { Agent } from "./agent.entity";
import { Message } from "./message.entity";
import { Customer } from "./customer.entity";
import { MessageType } from "./message.entity";
import { analyzeInstructions } from "../../utils/instruction-formatter";
import { documentRepository } from "../../repositories/document.repository";
import { debugLog } from "@server/lib/debug-logger";

@Entity("conversations")
export class Conversation {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 255 })
  title!: string;

  @Column({
    type: "enum",
    enum: ["web", "whatsapp", "instagram", "telegram", "sms", "email"],
    default: "web",
  })
  channel!: "web" | "whatsapp" | "instagram" | "telegram" | "sms" | "email";

  @Column({ type: "jsonb", nullable: true })
  publicJwk!: Record<string, unknown> | null;

  @Column({
    type: "enum",
    enum: ["open", "processing", "pending-human", "human-took-over", "resolved", "closed"],
    default: "open",
  })
  status!: "open" | "processing" | "pending-human" | "human-took-over" | "resolved" | "closed";

  @Column({ type: "timestamptz", nullable: true })
  cooldown_until!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  ended_at!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  closed_at!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  lastMessageAt!: Date | null;

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

  @Column({ type: "uuid", nullable: true })
  assigned_user_id!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn()
  assignedUser!: User | null;

  @Column({ type: "timestamptz", nullable: true })
  assigned_at!: Date | null;

  @Column({ type: "varchar", length: 50, nullable: true })
  previous_status!: string | null;

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

  async lock(): Promise<boolean> {
    const { conversationRepository } = await import("../../repositories/conversation.repository");
    return await conversationRepository.acquireLock(this.id, this.organization_id);
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
    let referencedDocuments: string[] = [];

    if (playbook.instructions) {
      if (typeof playbook.instructions === "string") {
        instructionText = playbook.instructions;
      } else if (Array.isArray(playbook.instructions)) {
        const analysis = analyzeInstructions(playbook.instructions);
        instructionText = analysis.formattedText;
        referencedActions = analysis.actions;
        referencedDocuments = analysis.documents;
      }
    }

    // Log playbook addition with embedded references (only logs once per conversation per playbook)
    if (this.playbook_id !== playbookId) {
      debugLog("conversation", "Playbook added to conversation", {
        conversationId: this.id,
        playbookName: playbook.title,
        referencedActions: referencedActions,
        referencedDocuments: referencedDocuments,
      });
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
          // Add tool ID to enabled_tools list using the full namespaced name (pluginId:toolName)
          if (!enabledToolIds.includes(actionName)) {
            enabledToolIds.push(actionName);
          }

          // Get the actual input schema - check both 'input_schema' (plugin manifest format) and 'parameters' (alternative format)
          const inputSchema: any = toolSchema.input_schema || toolSchema.parameters || {};
          const requiredFields =
            inputSchema.required &&
            Array.isArray(inputSchema.required) &&
            inputSchema.required.length > 0
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

    // Attach documents referenced in the playbook
    if (referencedDocuments.length > 0) {
      debugLog(
        "conversation",
        `Playbook references ${referencedDocuments.length} documents, attempting to attach them`,
      );

      for (const documentId of referencedDocuments) {
        try {
          // Verify the document exists and belongs to this organization
          const document = await documentRepository.findById(documentId);

          if (document && document.organizationId === this.organization_id) {
            debugLog(
              "conversation",
              `Attaching document "${document.title}" (${documentId}) from playbook`,
            );

            // addDocument already handles deduplication
            await this.addDocument(documentId);
          } else if (document) {
            debugLog(
              "conversation",
              `Document ${documentId} belongs to different organization, skipping`,
              { level: "warn" },
            );
          } else {
            debugLog("conversation", `Document ${documentId} referenced in playbook not found`, {
              level: "warn",
            });
          }
        } catch (error) {
          console.error(`[Conversation] Error attaching document "${documentId}":`, error);
        }
      }
    }
  }

  async addHandoffInstructions(
    instructions: unknown[],
    handoffType: "available" | "unavailable",
  ): Promise<void> {
    const { conversationRepository } = await import("../../repositories/conversation.repository");

    // Initialize enabled tools array
    const enabledToolIds: string[] = [];

    // Analyze instructions to extract actions and documents
    let instructionText = "";
    let referencedActions: string[] = [];
    let referencedDocuments: string[] = [];

    if (Array.isArray(instructions) && instructions.length > 0) {
      const analysis = analyzeInstructions(instructions as any);
      instructionText = analysis.formattedText;
      referencedActions = analysis.actions;
      referencedDocuments = analysis.documents;
    }

    debugLog("conversation", "Adding handoff instructions", {
      conversationId: this.id,
      handoffType,
      referencedActions,
      referencedDocuments,
    });

    // Get tool schemas from plugin manager service
    const toolSchemas: Array<Record<string, unknown>> = [];
    try {
      const { pluginManagerService } = await import("../../services/plugin-manager.service");
      const allPlugins = pluginManagerService.getAllPlugins();

      for (const plugin of allPlugins) {
        const manifest = plugin.manifest as any;
        if (manifest?.capabilities?.mcp?.tools) {
          toolSchemas.push(...manifest.capabilities.mcp.tools);
        }
      }
    } catch (error) {
      console.warn("Could not fetch tool schemas:", error);
    }

    let content = `From this message forward you should follow these handoff instructions:

**Handoff Context:** ${handoffType === "available" ? "Human agents are available" : "No human agents available"}

**Instructions:**
${instructionText}`;

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
          // Add tool ID to enabled_tools list using the full namespaced name (pluginId:toolName)
          if (!enabledToolIds.includes(actionName)) {
            enabledToolIds.push(actionName);
          }

          const inputSchema: any = toolSchema.input_schema || toolSchema.parameters || {};
          const requiredFields =
            inputSchema.required &&
            Array.isArray(inputSchema.required) &&
            inputSchema.required.length > 0
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
      content += `\n\n**Referenced Actions:**\n`;
      content += referencedActions.map((action) => `- ${action}`).join("\n");
    }

    await this.addMessage({
      content,
      type: "System",
      metadata: {
        isHandoffInstructions: true,
        handoffType,
        referencedActions,
        referencedDocuments,
      },
    });

    // Update conversation with enabled tools
    if (enabledToolIds.length > 0) {
      await conversationRepository.update(this.id, this.organization_id, {
        enabled_tools: enabledToolIds,
      });
      this.enabled_tools = enabledToolIds;
    }

    // Attach documents referenced in the handoff instructions
    if (referencedDocuments.length > 0) {
      debugLog(
        "conversation",
        `Handoff references ${referencedDocuments.length} documents, attempting to attach them`,
      );

      for (const documentId of referencedDocuments) {
        try {
          const document = await documentRepository.findById(documentId);

          if (document && document.organizationId === this.organization_id) {
            debugLog(
              "conversation",
              `Attaching document "${document.title}" (${documentId}) from handoff instructions`,
            );
            await this.addDocument(documentId);
          } else if (document) {
            debugLog(
              "conversation",
              `Document ${documentId} belongs to different organization, skipping`,
              { level: "warn" },
            );
          } else {
            debugLog("conversation", `Document ${documentId} referenced in handoff not found`, {
              level: "warn",
            });
          }
        } catch (error) {
          console.error(`[Conversation] Error attaching document "${documentId}":`, error);
        }
      }
    }
  }

  async addDocument(documentId: string): Promise<void> {
    const { conversationRepository } = await import("../../repositories/conversation.repository");

    if (!this.document_ids?.includes(documentId)) {
      debugLog("conversation", "Adding document to conversation", { documentId });
      debugLog("conversation", "Current document ids", { documentIds: this.document_ids });
      const updatedDocIds = [...(this.document_ids || []), documentId];
      debugLog("conversation", "Updated document ids", { documentIds: updatedDocIds });
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
    sender?: string;
  }): Promise<Message> {
    const { messageRepository } = await import("../../repositories/message.repository");
    const { conversationRepository } = await import("../../repositories/conversation.repository");

    // Handle Customer message cooldown
    if (messageData.type === MessageType.CUSTOMER) {
      const { config } = await import("../../config/env");

      // Mark conversation as needing processing
      await this.setProcessed(false);

      // Set cooldown based on configuration
      const cooldownUntil = new Date();
      const cooldownSeconds = Math.floor(config.conversation.cooldownInterval / 1000);
      cooldownUntil.setSeconds(cooldownUntil.getSeconds() + cooldownSeconds);

      // Determine new status based on current state
      let newStatus: typeof this.status = "open";

      // If conversation is currently taken over by a human
      if (this.status === "human-took-over") {
        // Check if there are any human agent messages
        const messages = await this.getMessages();
        const hasHumanAgentMessages = messages.some((msg) => msg.type === MessageType.HUMAN_AGENT);

        // Only keep it as human-took-over if a human agent has actually responded
        newStatus = hasHumanAgentMessages ? "human-took-over" : "open";
      }

      // Update conversation with cooldown and processing status
      await conversationRepository.update(this.id, this.organization_id, {
        status: newStatus,
        needs_processing: newStatus === "open", // Only process if returning to open
        cooldown_until: cooldownUntil,
        lastMessageAt: new Date(),
      });

      // Update local instance
      this.cooldown_until = cooldownUntil;
      this.needs_processing = newStatus === "open";
      this.lastMessageAt = new Date();
      this.status = newStatus;
    }

    // Create the message
    const message = await messageRepository.create({
      conversation_id: this.id,
      content: messageData.content,
      type: messageData.type as MessageType,
      metadata: messageData.metadata,
      sender: messageData.sender,
    });

    // Publish event to Redis for cross-server WebSocket broadcasting
    try {
      const { redisService } = await import("../../services/redis.service");

      if (redisService.isConnected()) {
        await redisService.publish("websocket:events", {
          type: "message_received",
          organizationId: this.organization_id,
          payload: {
            conversationId: this.id,
            messageId: message.id,
            messageType: message.type,
          },
        });
        debugLog("redis", `Published message_received event to Redis for conversation ${this.id}`);
      } else {
        // Fallback to direct WebSocket if Redis not available
        const { websocketService } = await import("../../services/websocket.service");
        const sent = websocketService.sendToOrganization(this.organization_id, {
          type: "message_received",
          payload: {
            conversationId: this.id,
            messageId: message.id,
            messageType: message.type,
          },
        });
        debugLog(
          "conversation",
          `Sent message_received directly to ${sent} local clients (Redis not available)`,
        );
      }
    } catch (error) {
      console.error("[Conversation] Failed to publish message event:", error);
    }

    return message;
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
    const { PromptService } = await import("../../services/prompt.service");
    const promptService = PromptService.getInstance();

    const systemContent = await promptService.getPrompt(
      "conversation/system-instructions",
      {},
      { organizationId: this.organization_id },
    );

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

  /**
   * Assign conversation to a user (takeover)
   */
  async assignToUser(userId: string): Promise<void> {
    const { conversationRepository } = await import("../../repositories/conversation.repository");

    // Store previous status for restoration
    const previousStatus = this.status;

    await conversationRepository.update(this.id, this.organization_id, {
      assigned_user_id: userId,
      assigned_at: new Date(),
      previous_status: previousStatus,
      status: "human-took-over",
    });

    // Update local instance
    this.assigned_user_id = userId;
    this.assigned_at = new Date();
    this.previous_status = previousStatus;
    this.status = "human-took-over";
  }

  /**
   * Release conversation from user (return to AI or queue)
   */
  async releaseFromUser(returnToMode: "ai" | "queue"): Promise<void> {
    const { conversationRepository } = await import("../../repositories/conversation.repository");

    const newStatus =
      returnToMode === "ai"
        ? "open" // Always return to "open" when returning to AI
        : "pending-human";

    const updates: any = {
      assigned_user_id: null,
      assigned_at: null,
      status: newStatus,
    };

    // If returning to AI, mark as needing processing
    if (returnToMode === "ai") {
      updates.needs_processing = true;
      updates.previous_status = null;
    }

    await conversationRepository.update(this.id, this.organization_id, updates);

    // Update local instance
    this.assigned_user_id = null;
    this.assigned_at = null;
    this.status = newStatus;
    if (returnToMode === "ai") {
      this.needs_processing = true;
      this.previous_status = null;
    }
  }

  /**
   * Check if conversation is currently taken over by a user
   */
  isTakenOver(): boolean {
    return this.status === "human-took-over" && !!this.assigned_user_id;
  }

  /**
   * Check if conversation is taken over by a specific user
   */
  isTakenOverBy(userId: string): boolean {
    return this.isTakenOver() && this.assigned_user_id === userId;
  }

  /**
   * Close conversation (mark as resolved and closed)
   */
  async closeConversation(): Promise<void> {
    const { conversationRepository } = await import("../../repositories/conversation.repository");

    await conversationRepository.update(this.id, this.organization_id, {
      status: "closed",
      closed_at: new Date(),
      assigned_user_id: null,
      assigned_at: null,
      ended_at: new Date(),
      previous_status: null,
    });

    // Update local instance
    this.status = "closed";
    this.closed_at = new Date();
    this.ended_at = new Date();
    this.assigned_user_id = null;
    this.assigned_at = null;
    this.previous_status = null;
  }
}
