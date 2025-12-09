import { router } from "@server/trpc";
import { pluginProcedure, requireCapability, type PluginAuthContext } from "@server/trpc/middleware/plugin-auth";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { CustomerRepository } from "@server/repositories/customer.repository";
import { ConversationRepository } from "@server/repositories/conversation.repository";
import { MessageRepository } from "@server/repositories/message.repository";
import { AgentRepository } from "@server/repositories/agent.repository";
import { OrganizationRepository, organizationRepository } from "@server/repositories/organization.repository";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { MessageType } from "@server/database/entities/message.entity";
import { mcpRegistryService } from "@server/services/mcp-registry.service";

// Initialize repositories
const customerRepository = new CustomerRepository();
const conversationRepository = new ConversationRepository();
const messageRepository = new MessageRepository();
const agentRepository = new AgentRepository();

/**
 * Plugin API Router (tRPC)
 *
 * This router provides endpoints for plugins to interact with the Hay platform.
 * All endpoints require JWT authentication with plugin-api scope.
 * Access is controlled by capabilities declared in the plugin's JWT token.
 *
 * NOTE: This is a simplified initial implementation. Full message/conversation
 * management will be implemented in later phases.
 */
export const pluginApiTrpcRouter = router({
  /**
   * Messages Capability - Receive message from customer
   *
   * Creates/updates customer, finds/creates conversation, and adds customer message.
   * This is called by channel plugins when they receive an incoming message.
   *
   * NOTE: Simplified implementation - full conversation management coming in Phase 4
   */
  "messages.receive": pluginProcedure
    .input(
      z.object({
        from: z.string().min(1, "from is required"),
        content: z.string(),
        channel: z.enum(["web", "whatsapp", "instagram", "telegram", "sms", "email"]),
        metadata: z.record(z.any()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireCapability(ctx, "messages");

      const { from, content, channel, metadata } = input;
      const organizationId = ctx.pluginAuth.organizationId;

      try {
        // Find or create customer
        let customer = await customerRepository.findByExternalId(from, organizationId);

        if (!customer) {
          customer = await customerRepository.create({
            organization_id: organizationId,
            external_id: from,
            external_metadata: {
              [channel]: {
                id: from,
                firstSeenAt: new Date(),
              },
            },
          });
        }

        // Get agent for this channel
        const agentId = await getAgentForChannel(organizationId, channel);

        if (!agentId) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No agent configured for this channel",
          });
        }

        // TODO: Find or create conversation by customer and channel
        // For now, create a new conversation
        const conversation = await conversationRepository.create({
          organization_id: organizationId,
          customer_id: customer.id,
          agent_id: agentId,
          channel,
          status: "open",
        });

        // Add customer message
        const message = await messageRepository.create({
          conversation_id: conversation.id,
          content,
          type: MessageType.CUSTOMER,
          metadata,
        });

        return {
          messageId: message.id,
          conversationId: conversation.id,
          processed: true,
        };
      } catch (error) {
        console.error("[PluginAPI] messages.receive error:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to process message",
        });
      }
    }),

  /**
   * Messages Capability - Send message to customer
   *
   * Adds message to conversation and triggers delivery.
   * The actual sending is delegated back to the plugin's sendMessage method.
   *
   * NOTE: Simplified implementation - full conversation management coming in Phase 4
   */
  "messages.send": pluginProcedure
    .input(
      z.object({
        to: z.string().min(1, "to is required"),
        content: z.string().min(1, "content is required"),
        channel: z.enum(["web", "whatsapp", "instagram", "telegram", "sms", "email"]),
        conversationId: z.string().uuid().optional(),
        metadata: z.record(z.any()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireCapability(ctx, "messages");

      const { to, content, channel, conversationId, metadata } = input;
      const organizationId = ctx.pluginAuth.organizationId;

      try {
        let conversation;

        if (conversationId) {
          // Use existing conversation
          conversation = await conversationRepository.findByIdAndOrganization(conversationId, organizationId);

          if (!conversation) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Conversation not found",
            });
          }
        } else {
          // Find or create customer and conversation
          let customer = await customerRepository.findByExternalId(to, organizationId);

          if (!customer) {
            customer = await customerRepository.create({
              organization_id: organizationId,
              external_id: to,
              external_metadata: {
                [channel]: {
                  id: to,
                  firstSeenAt: new Date(),
                },
              },
            });
          }

          // Get agent for this channel
          const agentId = await getAgentForChannel(organizationId, channel);

          if (!agentId) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "No agent configured for this channel",
            });
          }

          // TODO: Find existing conversation by customer and channel
          // For now, create a new conversation
          conversation = await conversationRepository.create({
            organization_id: organizationId,
            customer_id: customer.id,
            agent_id: agentId,
            channel,
            status: "open",
          });
        }

        // Add agent message
        const message = await messageRepository.create({
          conversation_id: conversation.id,
          content,
          type: MessageType.BOT_AGENT,
          metadata,
        });

        return {
          messageId: message.id,
          conversationId: conversation.id,
          timestamp: message.created_at,
        };
      } catch (error) {
        console.error("[PluginAPI] messages.send error:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to send message",
        });
      }
    }),

  /**
   * Messages Capability - Get messages by conversation
   */
  "messages.getByConversation": pluginProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCapability(ctx, "messages");

      const organizationId = ctx.pluginAuth.organizationId;

      const conversation = await conversationRepository.findByIdAndOrganization(input.conversationId, organizationId);

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      return conversation.messages || [];
    }),

  /**
   * Customers Capability - Get customer by ID
   */
  "customers.get": pluginProcedure
    .input(z.object({ customerId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCapability(ctx, "customers");

      const organizationId = ctx.pluginAuth.organizationId;

      const customer = await customerRepository.findByIdAndOrganization(input.customerId, organizationId);

      return customer || null;
    }),

  /**
   * Customers Capability - Find customer by external ID
   */
  "customers.findByExternalId": pluginProcedure
    .input(
      z.object({
        externalId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireCapability(ctx, "customers");

      const organizationId = ctx.pluginAuth.organizationId;

      const customer = await customerRepository.findByExternalId(
        input.externalId,
        organizationId
      );

      return customer || null;
    }),

  /**
   * Customers Capability - Create or update customer
   */
  "customers.upsert": pluginProcedure
    .input(
      z.object({
        externalId: z.string(),
        channel: z.string(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        name: z.string().optional(),
        metadata: z.record(z.any()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireCapability(ctx, "customers");

      const { externalId, channel, email, phone, name, metadata } = input;
      const organizationId = ctx.pluginAuth.organizationId;

      // Find existing customer
      const existing = await customerRepository.findByExternalId(externalId, organizationId);

      if (existing) {
        // Update existing customer
        const updated = await customerRepository.update(existing.id, organizationId, {
          email: email || existing.email,
          phone: phone || existing.phone,
          name: name || existing.name,
          external_metadata: {
            ...existing.external_metadata,
            [channel]: {
              id: externalId,
              ...metadata,
            },
          },
        });

        return updated;
      }

      // Create new customer
      return await customerRepository.create({
        organization_id: organizationId,
        external_id: externalId,
        email,
        phone,
        name,
        external_metadata: {
          [channel]: {
            id: externalId,
            ...metadata,
          },
        },
      });
    }),

  /**
   * Sources Capability - Register plugin as message source
   *
   * This registers the plugin as an available source for receiving messages.
   * Used by channel plugins like WhatsApp, Slack, etc.
   *
   * TODO: Implement actual source registration in database
   */
  "sources.register": pluginProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string(),
        category: z.enum(["messaging", "social", "email", "helpdesk"]),
        icon: z.string().optional(),
        metadata: z.record(z.any()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireCapability(ctx, "sources");

      const pluginId = ctx.pluginAuth.pluginId;

      console.log(
        `[PluginAPI] Registering source ${input.id} for plugin ${pluginId}:`,
        input
      );

      // TODO: Implement actual source registration
      // This might involve:
      // 1. Creating/updating a Source entity in the database
      // 2. Associating the source with the plugin
      // 3. Making the source available in the dashboard

      return { success: true };
    }),

  /**
   * MCP Capability - Register local MCP server
   *
   * Registers an MCP server that runs locally with the plugin worker.
   */
  "mcp.registerLocal": pluginProcedure
    .input(
      z.object({
        serverId: z.string().optional(), // Auto-generate if not provided
        serverPath: z.string(),
        startCommand: z.string(),
        installCommand: z.string().optional(),
        buildCommand: z.string().optional(),
        tools: z.array(
          z.object({
            name: z.string(),
            description: z.string(),
            input_schema: z.record(z.any()),
          })
        ),
        env: z.record(z.string()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireCapability(ctx, "mcp");

      const { organizationId, pluginId } = ctx.pluginAuth;
      const serverId = input.serverId || `mcp-${Date.now()}`;

      console.log(`[PluginAPI] Registering local MCP for ${organizationId}:${pluginId}:${serverId}`, {
        serverPath: input.serverPath,
        toolCount: input.tools.length,
      });

      // 1. Get plugin instance
      const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
      if (!instance) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Plugin instance not found for ${organizationId}:${pluginId}`,
        });
      }

      // 2. Update config with MCP server definition
      const config = instance.config || {};
      if (!config.mcpServers) {
        config.mcpServers = { local: [], remote: [] };
      }

      const mcpServers = config.mcpServers as any;
      mcpServers.local = mcpServers.local || [];

      // Check for duplicate serverId
      if (mcpServers.local.some((s: any) => s.serverId === serverId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `MCP server with ID ${serverId} already exists`,
        });
      }

      mcpServers.local.push({
        serverId,
        serverPath: input.serverPath,
        startCommand: input.startCommand,
        installCommand: input.installCommand,
        buildCommand: input.buildCommand,
        tools: input.tools,
        env: input.env,
      });

      // 3. Save to database
      await pluginInstanceRepository.updateConfig(instance.id, config);

      // 4. Register tools in registry
      await mcpRegistryService.registerTools(organizationId, pluginId, serverId, input.tools);

      console.log(`[PluginAPI] Registered local MCP: ${organizationId}:${pluginId}:${serverId}`);

      return {
        success: true,
        serverId,
        toolsRegistered: input.tools.length,
      };
    }),

  /**
   * MCP Capability - Register remote MCP server
   *
   * Registers an MCP server that runs remotely and is accessed via HTTP/SSE/WebSocket.
   */
  "mcp.registerRemote": pluginProcedure
    .input(
      z.object({
        serverId: z.string().optional(), // Auto-generate if not provided
        url: z.string().url(),
        transport: z.enum(["http", "sse", "websocket"]),
        auth: z
          .discriminatedUnion("type", [
            // Bearer token auth
            z.object({
              type: z.literal("bearer"),
              token: z.string(),
            }),
            // API key auth
            z.object({
              type: z.literal("apiKey"),
              apiKey: z.string(),
            }),
            // OAuth2 auth
            z.object({
              type: z.literal("oauth2"),
              authorizationUrl: z.string().url(),
              tokenUrl: z.string().url(),
              scopes: z.array(z.string()),
              optionalScopes: z.array(z.string()).optional(),
              pkce: z.boolean().optional(),
              clientIdEnvVar: z.string(),
              clientSecretEnvVar: z.string(),
            }),
          ])
          .optional(),
        tools: z.array(
          z.object({
            name: z.string(),
            description: z.string(),
            input_schema: z.record(z.any()),
          })
        ),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireCapability(ctx, "mcp");

      const { organizationId, pluginId } = ctx.pluginAuth;
      const serverId = input.serverId || `mcp-remote-${Date.now()}`;

      console.log(`[PluginAPI] Registering remote MCP for ${organizationId}:${pluginId}:${serverId}`, {
        url: input.url,
        transport: input.transport,
        toolCount: input.tools.length,
      });

      // 1. Get plugin instance
      const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
      if (!instance) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Plugin instance not found for ${organizationId}:${pluginId}`,
        });
      }

      // 2. Update config with MCP server definition
      const config = instance.config || {};
      if (!config.mcpServers) {
        config.mcpServers = { local: [], remote: [] };
      }

      const mcpServers = config.mcpServers as any;
      mcpServers.remote = mcpServers.remote || [];

      // Check for duplicate serverId
      if (mcpServers.remote.some((s: any) => s.serverId === serverId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `MCP server with ID ${serverId} already exists`,
        });
      }

      mcpServers.remote.push({
        serverId,
        url: input.url,
        transport: input.transport,
        auth: input.auth,
        tools: input.tools,
      });

      // 3. Save to database (auth credentials will be encrypted by repository)
      await pluginInstanceRepository.updateConfig(instance.id, config);

      // 4. Register tools in registry
      await mcpRegistryService.registerTools(organizationId, pluginId, serverId, input.tools);

      console.log(`[PluginAPI] Registered remote MCP: ${organizationId}:${pluginId}:${serverId}`);

      return {
        success: true,
        serverId,
        toolsRegistered: input.tools.length,
      };
    }),
});

/**
 * Helper: Get agent for channel
 *
 * Determines which agent should handle conversations for a given channel.
 * Priority:
 * 1. Channel-specific agent (organization.settings.channelAgents[channel])
 * 2. Default agent (organization.defaultAgentId)
 * 3. First available agent
 */
async function getAgentForChannel(organizationId: string, channel: string): Promise<string | null> {
  const org = await organizationRepository.findById(organizationId);

  // 1. Channel-specific agent (using the new channelAgents field)
  if (org?.settings?.channelAgents?.[channel]) {
    return org.settings.channelAgents[channel];
  }

  // 2. Default agent
  if (org?.defaultAgentId) {
    return org.defaultAgentId;
  }

  // 3. First available agent
  const agents = await agentRepository.findByOrganization(organizationId);
  return agents[0]?.id || null;
}
