import { router } from "@server/trpc";
import { pluginProcedure, requireCapability } from "@server/trpc/middleware/plugin-auth";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { CustomerRepository } from "@server/repositories/customer.repository";
import { ConversationRepository } from "@server/repositories/conversation.repository";
import { MessageRepository } from "@server/repositories/message.repository";
import { AgentRepository } from "@server/repositories/agent.repository";
import { organizationRepository } from "@server/repositories/organization.repository";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { MessageType } from "@server/database/entities/message.entity";
import { mcpRegistryService } from "@server/services/mcp-registry.service";
import { productSyncService } from "@server/services/product-sync.service";
import { ProductStatus } from "@server/entities/product.entity";
import { VariantAvailability } from "@server/entities/product-variant.entity";
import type { CanonicalProduct } from "@server/types/canonical-product";
import type {
  PluginInstanceConfig,
  LocalMCPServerConfig,
  RemoteMCPServerConfig,
} from "@server/types/plugin.types";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("plugin-api-trpc");

/**
 * Auth configuration accepted for remote MCP servers.
 *
 * Mirrors the discriminated union validated by the `mcp.registerRemote` input
 * schema. The shared {@link RemoteMCPServerConfig} only models bearer/apiKey
 * auth, but this route also persists the OAuth2 variant, so the persisted
 * remote-server shape widens `auth` to the full schema-backed union.
 */
type RemoteMCPServerAuth =
  | { type: "bearer"; token: string }
  | { type: "apiKey"; apiKey: string }
  | {
      type: "oauth2";
      authorizationUrl: string;
      tokenUrl: string;
      scopes: string[];
      optionalScopes?: string[];
      pkce?: boolean;
      clientIdEnvVar: string;
      clientSecretEnvVar: string;
    };

/** Remote MCP server entry as persisted by `mcp.registerRemote`. */
type PersistedRemoteMCPServer = Omit<RemoteMCPServerConfig, "auth"> & {
  auth?: RemoteMCPServerAuth;
};

/** Plugin instance config with the persisted MCP server shapes used here. */
type MCPServersConfigState = {
  local?: LocalMCPServerConfig[];
  remote?: PersistedRemoteMCPServer[];
};

type PluginInstanceConfigState = Omit<PluginInstanceConfig, "mcpServers"> & {
  mcpServers?: MCPServersConfigState;
};

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
        channel: z.string().min(1).max(64),
        metadata: z.record(z.any()).optional(),
        // Optional sender type — defaults to customer. "human_agent" is used when
        // an external system (e.g. Chatwoot) forwards a message written by a
        // human agent so Hay flips the conversation to human-took-over and the
        // orchestrator stops running.
        senderType: z.enum(["customer", "human_agent"]).optional(),
        // Optional provider-side conversation id (e.g. Chatwoot conversation id).
        // Stored in conversation.metadata[channel].conversationId so outbound
        // delivery can reuse it without extra lookups.
        externalConversationId: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      requireCapability(ctx, "messages");

      const { from, content, channel, metadata, externalConversationId } = input;
      const senderType = input.senderType ?? "customer";
      const organizationId = ctx.pluginAuth.organizationId;

      try {
        // Find or create customer
        let customer = await customerRepository.findByExternalId(from, organizationId);

        if (!customer) {
          customer = await customerRepository.create({
            organization_id: organizationId,
            external_id: from,
            name: metadata?.profileName as string | undefined,
            phone: from,
            external_metadata: {
              [channel]: {
                id: from,
                firstSeenAt: new Date(),
                ...metadata,
              },
            },
          });
        } else {
          // Update customer metadata with latest info from the channel
          // Also backfill name/phone if they weren't set before
          const updates: Record<string, unknown> = {};

          if (!customer.name && metadata?.profileName) {
            updates.name = metadata.profileName;
          }
          if (!customer.phone) {
            updates.phone = from;
          }
          if (metadata) {
            updates.external_metadata = {
              ...customer.external_metadata,
              [channel]: {
                ...((customer.external_metadata?.[channel] as Record<string, unknown>) ?? {}),
                id: from,
                ...metadata,
              },
            };
          }

          if (Object.keys(updates).length > 0) {
            await customerRepository.update(customer.id, organizationId, updates);
          }
        }

        // Get agent for this channel
        const agentId = await getAgentForChannel(organizationId, channel);

        if (!agentId) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No agent configured for this channel",
          });
        }

        // Find active conversation or create a new one
        let conversation = await conversationRepository.findActiveByCustomerAndChannel(
          customer.id,
          channel,
          organizationId,
        );

        // Seed channel-specific metadata on brand-new conversations so outbound
        // delivery can look up provider-side IDs (e.g. Chatwoot conversation id)
        // without a second round-trip.
        const channelMetadata: Record<string, unknown> = {
          ...(externalConversationId ? { conversationId: externalConversationId } : {}),
        };

        if (!conversation) {
          conversation = await conversationRepository.create({
            organization_id: organizationId,
            customer_id: customer.id,
            agent_id: agentId,
            channel,
            status: "open",
            title: "",
            metadata: Object.keys(channelMetadata).length ? { [channel]: channelMetadata } : null,
          });
        } else if (externalConversationId) {
          // Conversation already exists — merge the externalConversationId into
          // its metadata if it's not already stored there. We intentionally do
          // not broadcast this metadata-only change because it's internal state.
          const existing = conversation.metadata ?? {};
          const existingChannel = (existing[channel] ?? {}) as Record<string, unknown>;
          if (existingChannel.conversationId !== externalConversationId) {
            const merged = {
              ...existing,
              [channel]: { ...existingChannel, ...channelMetadata },
            };
            await conversationRepository.updateById(conversation.id, { metadata: merged });
            conversation.metadata = merged;
          }
        }

        // Determine Hay MessageType based on whether the forwarded message came
        // from the customer or from a human agent on the external system.
        const messageType =
          senderType === "human_agent" ? MessageType.HUMAN_AGENT : MessageType.CUSTOMER;

        // Tag human-agent messages that originated from the external channel
        // so the ChannelDeliveryService does not echo them back to the same
        // channel (which would produce a feedback loop — the agent's own reply
        // getting re-sent to themselves).
        const enrichedMetadata =
          senderType === "human_agent" ? { ...(metadata ?? {}), externalOrigin: true } : metadata;

        const message = await conversation.addMessage({
          content,
          type: messageType,
          metadata: enrichedMetadata,
        });

        // When a human agent replies on the external system, flip Hay's
        // conversation to "human-took-over" so the orchestrator skips it.
        // Mirrors the dashboard takeover path.
        if (
          senderType === "human_agent" &&
          conversation.status !== "human-took-over" &&
          conversation.status !== "resolved" &&
          conversation.status !== "closed"
        ) {
          await conversationRepository.update(conversation.id, organizationId, {
            status: "human-took-over",
            needs_processing: false,
          });
        }

        return {
          messageId: message.id,
          conversationId: conversation.id,
          processed: true,
        };
      } catch (error) {
        logger.error({ err: error }, "messages.receive error");
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
        channel: z.string().min(1).max(64),
        conversationId: z.string().uuid().optional(),
        metadata: z.record(z.any()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      requireCapability(ctx, "messages");

      const { to, content, channel, conversationId, metadata } = input;
      const organizationId = ctx.pluginAuth.organizationId;

      try {
        let conversation;

        if (conversationId) {
          // Use existing conversation
          conversation = await conversationRepository.findByIdAndOrganization(
            conversationId,
            organizationId,
          );

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

          // Find active conversation or create a new one
          conversation = await conversationRepository.findActiveByCustomerAndChannel(
            customer.id,
            channel,
            organizationId,
          );

          if (!conversation) {
            conversation = await conversationRepository.create({
              organization_id: organizationId,
              customer_id: customer.id,
              agent_id: agentId,
              channel,
              status: "open",
              title: "",
            });
          }
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
        logger.error({ err: error }, "messages.send error");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to send message",
        });
      }
    }),

  /**
   * Conversations Capability - Update status by external conversation id.
   *
   * Used by channel plugins to reflect lifecycle changes that happen on the
   * external system (e.g. a Chatwoot agent resolves / reopens a ticket) back
   * into Hay. Looks up the Hay conversation via metadata[channel].conversationId.
   */
  "conversations.updateStatusByExternalId": pluginProcedure
    .input(
      z.object({
        channel: z.string().min(1).max(64),
        externalConversationId: z.string().min(1),
        status: z.enum(["open", "pending-human", "human-took-over", "resolved", "closed"]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      requireCapability(ctx, "messages");

      const organizationId = ctx.pluginAuth.organizationId;
      const conversation = await conversationRepository.findByExternalConversationId(
        input.channel,
        input.externalConversationId,
        organizationId,
      );

      if (!conversation) {
        return { updated: false, reason: "conversation_not_found" as const };
      }

      if (conversation.status === input.status) {
        return { updated: false, reason: "already_in_status" as const };
      }

      await conversationRepository.update(conversation.id, organizationId, {
        status: input.status,
        needs_processing: input.status === "open" ? conversation.needs_processing : false,
      });

      return { updated: true, conversationId: conversation.id };
    }),

  /**
   * Messages Capability - Get messages by conversation
   */
  "messages.getByConversation": pluginProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCapability(ctx, "messages");

      const organizationId = ctx.pluginAuth.organizationId;

      const conversation = await conversationRepository.findByIdAndOrganization(
        input.conversationId,
        organizationId,
      );

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

      const customer = await customerRepository.findByIdAndOrganization(
        input.customerId,
        organizationId,
      );

      return customer || null;
    }),

  /**
   * Customers Capability - Find customer by external ID
   */
  "customers.findByExternalId": pluginProcedure
    .input(
      z.object({
        externalId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      requireCapability(ctx, "customers");

      const organizationId = ctx.pluginAuth.organizationId;

      const customer = await customerRepository.findByExternalId(input.externalId, organizationId);

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
      }),
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
      }),
    )
    .mutation(async ({ input, ctx }) => {
      requireCapability(ctx, "sources");

      const pluginId = ctx.pluginAuth.pluginId;

      logger.debug({ sourceId: input.id, pluginId, input }, "Registering source for plugin");

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
          }),
        ),
        env: z.record(z.string()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      requireCapability(ctx, "mcp");

      const { organizationId, pluginId } = ctx.pluginAuth;
      const serverId = input.serverId || `mcp-${Date.now()}`;

      logger.debug(
        {
          organizationId,
          pluginId,
          serverId,
          serverPath: input.serverPath,
          toolCount: input.tools.length,
        },
        "Registering local MCP server",
      );

      // 1. Get plugin instance
      const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
      if (!instance) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Plugin instance not found for ${organizationId}:${pluginId}`,
        });
      }

      // 2. Update config with MCP server definition
      const config: PluginInstanceConfigState = instance.config || {};
      if (!config.mcpServers) {
        config.mcpServers = { local: [], remote: [] };
      }

      const mcpServers = config.mcpServers;
      mcpServers.local = mcpServers.local || [];

      // Check for duplicate serverId
      if (mcpServers.local.some((s: LocalMCPServerConfig) => s.serverId === serverId)) {
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

      logger.info({ organizationId, pluginId, serverId }, "Registered local MCP server");

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
          }),
        ),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      requireCapability(ctx, "mcp");

      const { organizationId, pluginId } = ctx.pluginAuth;
      const serverId = input.serverId || `mcp-remote-${Date.now()}`;

      logger.debug(
        {
          organizationId,
          pluginId,
          serverId,
          url: input.url,
          transport: input.transport,
          toolCount: input.tools.length,
        },
        "Registering remote MCP server",
      );

      // 1. Get plugin instance
      const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
      if (!instance) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Plugin instance not found for ${organizationId}:${pluginId}`,
        });
      }

      // 2. Update config with MCP server definition
      const config: PluginInstanceConfigState = instance.config || {};
      if (!config.mcpServers) {
        config.mcpServers = { local: [], remote: [] };
      }

      const mcpServers = config.mcpServers;
      mcpServers.remote = mcpServers.remote || [];

      // Check for duplicate serverId
      if (mcpServers.remote.some((s: PersistedRemoteMCPServer) => s.serverId === serverId)) {
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

      logger.info({ organizationId, pluginId, serverId }, "Registered remote MCP server");

      return {
        success: true,
        serverId,
        toolsRegistered: input.tools.length,
      };
    }),

  /**
   * Products Capability - Bulk upsert canonical products from a plugin adapter
   *
   * Called by product-source plugins (e.g. Shopify) from their `onStart` /
   * webhook handlers via `ctx.productSource.upsert(...)`. Idempotent on
   * (source, externalId). Returns counts so the worker can log progress.
   */
  "products.upsertMany": pluginProcedure
    .input(
      z.object({
        products: z
          .array(
            z.object({
              externalId: z.string().min(1),
              handle: z.string().min(1),
              title: z.string().min(1),
              descriptionHtml: z.string().optional(),
              descriptionShortHtml: z.string().optional(),
              vendor: z.string().optional(),
              productType: z.string().optional(),
              status: z.nativeEnum(ProductStatus).optional(),
              tags: z.array(z.string()).optional(),
              categories: z.array(z.record(z.any())).optional(),
              options: z.array(z.record(z.any())).optional(),
              images: z.array(z.record(z.any())).optional(),
              currency: z.string().optional(),
              sourceUrl: z.string().optional(),
              attributes: z.record(z.any()).optional(),
              variants: z
                .array(
                  z.object({
                    externalId: z.string().min(1),
                    sku: z.string().optional(),
                    barcode: z.string().optional(),
                    title: z.string(),
                    selectedOptions: z.array(z.record(z.any())).optional(),
                    position: z.number().int().optional(),
                    price: z.number().nonnegative().optional(),
                    compareAtPrice: z.number().nonnegative().optional(),
                    currency: z.string().optional(),
                    inventoryQuantity: z.number().int().optional(),
                    inventoryTracked: z.boolean().optional(),
                    availability: z.nativeEnum(VariantAvailability).optional(),
                    weightValue: z.number().optional(),
                    weightUnit: z.string().optional(),
                    imageSrc: z.string().optional(),
                    attributes: z.record(z.any()).optional(),
                  }),
                )
                .min(1),
            }),
          )
          .min(1)
          .max(500),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      requireCapability(ctx, "products");
      const { organizationId, pluginId } = ctx.pluginAuth;
      // Core stamps the source from the authenticated plugin identity — the
      // adapter never names itself, so it can't impersonate another source.
      const result = await productSyncService.upsertProducts(
        organizationId,
        input.products as unknown as CanonicalProduct[],
        pluginId,
      );
      return result;
    }),

  /**
   * Products Capability - Delete a product by (source, externalId)
   *
   * Called from a plugin webhook handler when the upstream platform reports
   * a deletion. Cascades to variants and product_embeddings via FK.
   */
  "products.delete": pluginProcedure
    .input(
      z.object({
        externalId: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      requireCapability(ctx, "products");
      const { organizationId, pluginId } = ctx.pluginAuth;
      // Source is the authenticated plugin id — a plugin can only delete its own
      // products.
      const removed = await productSyncService.deleteProductByExternalId(
        organizationId,
        pluginId,
        input.externalId,
      );
      return { removed };
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
