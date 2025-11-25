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
import { MessageType, MessageStatus } from "./message.entity";
import { DeliveryState } from "../../types/message-feedback.types";
import { analyzeTiptapInstructions } from "../../utils/tiptap-formatter";
import { documentRepository } from "../../repositories/document.repository";
import { debugLog } from "@server/lib/debug-logger";
import { SupportedLanguage } from "../../types/language.types";

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

  @Column({ type: "varchar", length: 10, nullable: true })
  language!: SupportedLanguage | null;

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

    // Analyze Editor.js instructions
    let instructionText = "";
    let referencedActions: string[] = [];
    let referencedDocuments: string[] = [];

    if (playbook.instructions) {
      const analysis = analyzeTiptapInstructions(playbook.instructions as any);
      instructionText = analysis.formattedText;
      referencedActions = analysis.actions;
      referencedDocuments = analysis.documents;
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

    // Analyze Editor.js instructions to extract actions and documents
    let instructionText = "";
    let referencedActions: string[] = [];
    let referencedDocuments: string[] = [];

    if (instructions) {
      const analysis = analyzeTiptapInstructions(instructions as any);
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

    // Check if the last message has the same content to prevent duplicates
    const messages = await this.getMessages();
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.content === messageData.content && lastMessage.type === messageData.type) {
        debugLog("conversation", "Duplicate message detected, skipping", {
          conversationId: this.id,
          content: messageData.content.substring(0, 100),
          type: messageData.type,
        });
        return lastMessage;
      }
    }

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

    // Check if test mode is enabled for bot messages
    let messageStatus = MessageStatus.APPROVED;
    let reviewRequired = false;
    let deliveryState = DeliveryState.SENT;

    if (messageData.type === MessageType.BOT_AGENT) {
      // Get agent and organization to check test mode
      const { agentRepository } = await import("../../repositories/agent.repository");
      const { organizationRepository } = await import("../../repositories/organization.repository");

      const agent = this.agent_id ? await agentRepository.findById(this.agent_id) : null;
      const organization = await organizationRepository.findById(this.organization_id);

      // Check if this is an initial greeting (no customer messages yet)
      const messages = await this.getMessages();
      const hasCustomerMessages = messages.some((msg) => msg.type === MessageType.CUSTOMER);

      // Determine if test mode is enabled
      let testModeEnabled = false;
      if (agent && agent.testMode !== null && agent.testMode !== undefined) {
        // Agent has explicit test mode setting
        testModeEnabled = agent.testMode;
      } else if (organization && organization.settings?.testModeDefault) {
        // Fall back to organization default
        testModeEnabled = organization.settings.testModeDefault;
      }

      // Only apply test mode if this is a response to a customer (not the initial greeting)
      if (testModeEnabled && hasCustomerMessages) {
        messageStatus = MessageStatus.PENDING;
        reviewRequired = true;
        deliveryState = DeliveryState.QUEUED;
      }
    }

    // CRITICAL: Save the message to database FIRST before broadcasting
    // This ensures the message is committed to the database before any WebSocket clients
    // receive the broadcast and potentially try to query for it
    const message = await messageRepository.create({
      conversation_id: this.id,
      content: messageData.content,
      type: messageData.type as MessageType,
      metadata: messageData.metadata,
      sender: messageData.sender,
      status: messageStatus,
      reviewRequired,
      deliveryState,
    });

    // IMPORTANT: Message is now saved to database and committed
    // Now it's safe to broadcast to WebSocket clients
    debugLog("conversation", `Message ${message.id} saved to database, preparing to broadcast`);

    // Broadcast messages via WebSocket:
    // - Dashboard (organization clients): receives ALL message types
    // - Webchat (conversation clients): receives only public-facing messages (Customer, BotAgent, HumanAgent)
    // - SENT messages: broadcast to both dashboard and webchat
    // - QUEUED messages: broadcast to dashboard only (for review)

    // All message types should be broadcast to dashboard for full visibility
    const shouldBroadcast = true;

    // Broadcast after successful database save
    if (shouldBroadcast) {
      try {
        const { redisService } = await import("../../services/redis.service");

        if (redisService.isConnected()) {
          const eventPayload = {
            type: "message_received",
            organizationId: this.organization_id,
            conversationId: this.id,
            payload: {
              id: message.id,
              content: message.content,
              type: message.type,
              sender: message.sender,
              timestamp: message.created_at,
              metadata: message.metadata,
              status: message.status,
              deliveryState: message.deliveryState,
            },
          };

          // Publish to Redis for distribution across all server instances
          await redisService.publish("websocket:events", eventPayload);

          debugLog("conversation", `Message ${message.id} published to Redis for broadcast`);
        } else {
          // Fallback to direct WebSocket if Redis not available
          const { websocketService } = await import("../../services/websocket.service");

          const messagePayload = {
            type: "message",
            data: {
              id: message.id,
              content: message.content,
              type: message.type,
              sender: message.sender,
              timestamp: message.created_at,
              metadata: message.metadata,
            },
          };

          // Send full message data to all clients in this conversation
          const sent = websocketService.sendToConversation(this.id, messagePayload);

          debugLog(
            "conversation",
            `Sent message to ${sent} clients in conversation ${this.id} (Redis not available, after DB commit)`,
          );
        }
      } catch (error) {
        // IMPORTANT: If broadcasting fails, the message is still saved in the database

        debugLog(
          "conversation",
          `Message ${message.id} saved but broadcast failed - clients will see it on refresh`,
        );
      }
    } else {
      debugLog("conversation", `Message NOT broadcast (not a public message)`);
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

  /**
   * Generate a localized greeting message using LLM translation if needed
   */
  private async generateLocalizedGreeting(
    greeting: string,
    targetLanguage: SupportedLanguage,
  ): Promise<string> {
    const { LLMService } = await import("../../services/core/llm.service");
    const llmService = new LLMService();

    const translationPrompt = `Translate the following greeting message to ${targetLanguage}.
Keep the tone natural and appropriate for a customer service context.
Only return the translated text, nothing else.

Original message: "${greeting}"

Translated message:`;

    try {
      const translated = await llmService.invoke({
        prompt: translationPrompt,
      });
      return translated.trim();
    } catch (error) {
      console.error("Error translating greeting:", error);
      // Fallback to original greeting if translation fails
      return greeting;
    }
  }

  async addInitialBotMessage(): Promise<Message> {
    // Fetch the agent to get custom greeting
    const { agentRepository } = await import("../../repositories/agent.repository");
    const { PromptService } = await import("../../services/prompt.service");
    const promptService = PromptService.getInstance();

    let greetingText = "Hello! How can I help you today?";

    if (this.agent_id) {
      const agent = await agentRepository.findById(this.agent_id);
      if (agent?.initialGreeting) {
        greetingText = agent.initialGreeting;
      }
    }

    // Determine the target language for this conversation
    const targetLanguage = await promptService["determineLanguage"]({
      conversationId: this.id,
      organizationId: this.organization_id,
    });

    // Translate greeting if needed (assuming greeting is in English by default)
    const DEFAULT_LANGUAGE = "en";
    if (targetLanguage !== DEFAULT_LANGUAGE) {
      greetingText = await this.generateLocalizedGreeting(greetingText, targetLanguage);
    }

    return this.addMessage({
      content: greetingText,
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
