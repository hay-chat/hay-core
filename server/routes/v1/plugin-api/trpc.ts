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
import { pluginWebhookRouteRepository } from "@server/repositories/plugin-webhook-route.repository";
import {
  MessageType,
  type MessageAttachment,
  type MessageProviderError,
  type MessageProviderStatus,
} from "@server/database/entities/message.entity";
import { mcpRegistryService } from "@server/services/mcp-registry.service";
import { redisService } from "@server/services/redis.service";
import { CONVERSATION_MEDIA_FOLDER, storageService } from "@server/services/storage.service";
import { transcriptionService } from "@server/services/transcription.service";
import { oauthService } from "@server/services/oauth.service";
import { randomUUID } from "crypto";
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
import { emailDomainService } from "@server/services/email-domains.service";
import { channelHealthService } from "@server/services/channel-health.service";
import type { Conversation } from "@server/database/entities/conversation.entity";

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
        // Optional provider-side conversation id (e.g. Chatwoot conversation id,
        // or an email thread's root Message-ID). Looked up first so threads the
        // provider already identified never merge into the customer's active
        // conversation; stored in conversation.metadata[channel].conversationId
        // so outbound delivery can reuse it without extra lookups.
        externalConversationId: z.string().max(998).optional(),
        // Optional Hay conversation id the plugin recovered from its own
        // outbound message (e.g. an email reply-to token). Wins over every
        // other lookup when it belongs to this org and channel.
        conversationId: z.string().uuid().optional(),
        // Optional title for a newly created conversation (e.g. email subject).
        title: z.string().max(255).optional(),
        // D13-2: when the channel stops accepting free-form replies, counted from
        // this inbound message (WhatsApp: its timestamp + 24 h). Only customer
        // messages open a window; the latest one wins.
        replyWindowExpiresAt: z.string().datetime({ offset: true }).optional(),
        // Park the conversation for a human instead of letting the AI answer
        // (e.g. a DMARC-failing email or a reply that shows a human already
        // answered outside Hay). The message is stored; the conversation goes
        // to pending-human so it shows under "Needs attention".
        holdForHuman: z.boolean().optional(),
        // Media already uploaded to Hay storage (see `media.upload`). Attachment-only
        // messages pass an empty `content`.
        attachments: z
          .array(
            z.object({
              id: z.string().optional(),
              name: z.string(),
              url: z.string().url(),
              type: z.string(),
              size: z.number().int().nonnegative(),
            }),
          )
          .max(10)
          .optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      requireCapability(ctx, "messages");

      const { from, content, channel, metadata, externalConversationId, title } = input;
      const attachments: MessageAttachment[] | undefined = input.attachments?.map((attachment) => ({
        ...attachment,
        id: attachment.id ?? randomUUID(),
      }));
      const senderType = input.senderType ?? "customer";
      const organizationId = ctx.pluginAuth.organizationId;

      try {
        // An echo of a message Hay.chat itself sent (the provider id was stored
        // at delivery) is not a human reply: never store it twice and never let
        // it take the conversation away from the AI (D13-8, D11-11).
        if (senderType === "human_agent" && typeof metadata?.mid === "string" && metadata.mid) {
          const ownSend = await messageRepository.findByProviderMessageIdAndOrganization(
            metadata.mid,
            organizationId,
          );
          if (ownSend) {
            return {
              messageId: null,
              conversationId: ownSend.conversation_id,
              processed: false,
              deduped: true,
            };
          }
        }

        // Find or create customer
        let customer = await customerRepository.findByExternalId(from, organizationId);

        if (!customer) {
          customer = await customerRepository.create({
            organization_id: organizationId,
            external_id: from,
            name: metadata?.profileName as string | undefined,
            // Only store a real phone number / email if the channel provides one.
            // `from` is a channel-scoped identity (e.g. "instagram:<psid>") and
            // belongs in external_id, never the phone or email field.
            phone: (metadata?.phone as string | undefined) ?? undefined,
            email: (metadata?.email as string | undefined) ?? undefined,
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
          if (!customer.phone && metadata?.phone) {
            updates.phone = metadata.phone as string;
          }
          if (!customer.email && metadata?.email) {
            updates.email = metadata.email as string;
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

        // Resolve the conversation: a Hay id the plugin recovered from its own
        // outbound message wins, then the provider-side thread id. Both must
        // belong to this customer — the Hay id travels in every outbound email
        // (Reply-To token), so a third party who was forwarded one must not be
        // able to inject into the shopper's thread. Plugins that pass neither
        // fall back to the customer's active conversation on this channel; a
        // plugin that does pass an external thread id and misses means a new
        // thread (one customer, many threads). A resolved thread found by id
        // or external id is reopened by addMessage below.
        let conversation: Conversation | null = null;
        if (input.conversationId) {
          const byId = await conversationRepository.findByIdAndOrganization(
            input.conversationId,
            organizationId,
          );
          conversation =
            byId && byId.channel === channel && byId.customer_id === customer.id && !byId.deleted_at
              ? byId
              : null;
        }
        if (!conversation && externalConversationId) {
          const byExternalId = await conversationRepository.findByExternalConversationId(
            channel,
            externalConversationId,
            organizationId,
          );
          conversation = byExternalId?.customer_id === customer.id ? byExternalId : null;
        }
        if (!conversation && !externalConversationId) {
          conversation = await conversationRepository.findActiveByCustomerAndChannel(
            customer.id,
            channel,
            organizationId,
          );
        }

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
            title: title ?? "",
            metadata: Object.keys(channelMetadata).length ? { [channel]: channelMetadata } : null,
          });
        } else if (externalConversationId) {
          // Conversation already exists — store the externalConversationId if
          // none is recorded yet. An existing value is the thread root and is
          // never replaced: a reply that only references our own message would
          // otherwise detach the thread from its first message. We intentionally
          // do not broadcast this metadata-only change because it's internal state.
          const existing = conversation.metadata ?? {};
          const existingChannel = (existing[channel] ?? {}) as Record<string, unknown>;
          if (existingChannel.conversationId === undefined) {
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

        // Inbound idempotency: providers may redeliver the same message (e.g.
        // Meta retries unacked webhooks). When a plugin passes a provider-side
        // message id in metadata.mid, claim it atomically with Redis SETNX. If
        // the key already exists this is a duplicate — short-circuit without
        // creating a second message. Channels that don't pass `mid` skip dedupe.
        const providerMessageId =
          typeof metadata?.mid === "string" && metadata.mid.length > 0 ? metadata.mid : undefined;

        if (providerMessageId) {
          const claimed = await claimProviderMessage(organizationId, channel, providerMessageId);
          if (!claimed) {
            logger.debug(
              { organizationId, channel, mid: providerMessageId },
              "Duplicate inbound message ignored (mid already seen)",
            );
            return {
              messageId: null,
              conversationId: conversation.id,
              processed: false,
              deduped: true,
            };
          }
        }

        if (input.replyWindowExpiresAt && senderType === "customer") {
          const expiresAt = new Date(input.replyWindowExpiresAt);
          const current = conversation.reply_window_expires_at;
          if (!current || new Date(current).getTime() < expiresAt.getTime()) {
            await conversationRepository.updateById(conversation.id, {
              reply_window_expires_at: expiresAt,
            });
            conversation.reply_window_expires_at = expiresAt;
          }
        }

        const message = await conversation.addMessage({
          content,
          type: messageType,
          metadata: enrichedMetadata,
          attachments,
          providerMessageId,
        });

        // When a human agent replies on the external system, flip Hay's
        // conversation to "human-took-over" so the orchestrator skips it.
        // Mirrors the dashboard takeover path.
        if (
          senderType === "human_agent" &&
          conversation.status !== "human-took-over" &&
          conversation.status !== "resolved" &&
          conversation.status !== "unresolved" &&
          conversation.status !== "closed"
        ) {
          await conversationRepository.update(conversation.id, organizationId, {
            status: "human-took-over",
            needs_processing: false,
          });
        } else if (
          input.holdForHuman &&
          senderType === "customer" &&
          conversation.status !== "human-took-over"
        ) {
          // addMessage just reopened the conversation and queued it for the
          // orchestrator; park it for a human instead.
          await conversationRepository.update(conversation.id, organizationId, {
            status: "pending-human",
            needs_processing: false,
          });
        }

        return {
          messageId: message.id as string | null,
          conversationId: conversation.id,
          processed: true,
          deduped: false,
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
   * Messages Capability - Provider delivery status for an outbound message.
   *
   * Channel plugins call this from their status webhooks (e.g. Meta WhatsApp
   * sent/delivered/read/failed). The message is matched by the provider's
   * message id stored at delivery time. Statuses are monotonic
   * (sent < delivered < read) and never downgraded; `failed` always applies.
   *
   * Not-found is a soft result, not an error: the provider's `sent` status can
   * race the /deliver response that stores the provider id.
   */
  "messages.updateStatus": pluginProcedure
    .input(
      z.object({
        providerMessageId: z.string().min(1),
        status: z.enum(["sent", "delivered", "read", "failed"]),
        error: z
          .object({
            code: z.union([z.string(), z.number()]).optional(),
            title: z.string().optional(),
            message: z.string().optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      requireCapability(ctx, "messages");

      const organizationId = ctx.pluginAuth.organizationId;
      const message = await messageRepository.findByProviderMessageIdAndOrganization(
        input.providerMessageId,
        organizationId,
      );

      if (!message) {
        return { updated: false, reason: "message_not_found" as const };
      }

      const current = message.providerStatus;
      const isFailure = input.status === "failed";
      if (
        !isFailure &&
        current !== null &&
        PROVIDER_STATUS_RANK[current] >= PROVIDER_STATUS_RANK[input.status]
      ) {
        return { updated: false, reason: "status_not_newer" as const };
      }

      const providerError: MessageProviderError | null = isFailure ? (input.error ?? {}) : null;

      await messageRepository.update(message.id, {
        providerStatus: input.status,
        providerError,
      });

      if (isFailure) {
        // Best effort: a health check problem never fails the status update.
        void (async () => {
          const conversation = await conversationRepository.findById(message.conversation_id);
          if (conversation) {
            await channelHealthService.recordDeliveryFailure(organizationId, conversation.channel);
          }
        })().catch((error: unknown) => {
          logger.warn({ err: error, messageId: message.id }, "Channel health check failed");
        });
      }

      // Status-only event: never `message_received`, which channel-delivery
      // would treat as a new outbound message and re-deliver.
      try {
        await redisService.publish("websocket:events", {
          type: "message_status_updated",
          organizationId,
          payload: {
            conversationId: message.conversation_id,
            messageId: message.id,
            providerStatus: input.status,
            providerError,
          },
        });
      } catch (error) {
        logger.warn({ err: error, messageId: message.id }, "Failed to publish status update");
      }

      return { updated: true as const };
    }),

  /**
   * Messages Capability - Upload media received from a channel.
   *
   * Plugins download provider media (e.g. Meta's short-lived media URLs) and
   * push the bytes here so the message's attachment points at Hay storage.
   * Returns the attachment shape expected by `messages.receive`.
   *
   * With `transcribe` on audio, also returns `transcript` (speech-to-text).
   * Transcription is best effort: absent when unavailable, never fails the upload.
   */
  "media.upload": pluginProcedure
    .input(
      z.object({
        data: z.string().min(1),
        mimeType: z.string().min(1),
        filename: z.string().min(1).max(255),
        transcribe: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      requireCapability(ctx, "messages");

      const buffer = decodeBase64(input.data);
      if (!buffer) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid base64 payload" });
      }

      const organizationId = ctx.pluginAuth.organizationId;
      let stored: Awaited<ReturnType<typeof storageService.upload>>;
      try {
        stored = await storageService.upload({
          buffer,
          originalName: input.filename,
          mimeType: input.mimeType,
          folder: CONVERSATION_MEDIA_FOLDER,
          organizationId,
        });
      } catch (error) {
        // Storage rejects disallowed or mislabelled content and oversized files
        // with plain errors — those are caller mistakes, not server faults.
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Upload failed",
        });
      }

      // Type and size of what was stored: the type comes from the file's content
      // and images are re-encoded, so both may differ from the plugin's input.
      const attachment = {
        id: stored.upload.id,
        name: input.filename,
        url: stored.url,
        type: stored.upload.mimeType,
        size: Number(stored.upload.size),
      };

      if (!input.transcribe || !attachment.type.startsWith("audio/")) {
        return attachment;
      }

      const transcript = await transcriptionService.transcribe({
        buffer,
        mimeType: attachment.type,
        filename: input.filename,
        organizationId,
      });
      return transcript ? { ...attachment, transcript } : attachment;
    }),

  /**
   * Messages Capability - Report that the provider revoked this plugin's credentials.
   *
   * Channel plugins call this when the provider signals the connection is gone
   * (e.g. app uninstalled, token invalidated). Core disconnects the instance
   * after responding, because the revoke stops the calling worker.
   */
  "connection.revoke": pluginProcedure
    .input(z.object({ reason: z.string().min(1).max(200) }))
    .mutation(({ input, ctx }) => {
      requireCapability(ctx, "messages");

      const { organizationId, pluginId } = ctx.pluginAuth;
      logger.warn(
        { organizationId, pluginId, reason: input.reason },
        "Plugin reported revoked connection",
      );
      scheduleConnectionRevoke(organizationId, pluginId);
      void channelHealthService
        .markFailing(organizationId, pluginId, "token_revoked", input.reason)
        .catch((error: unknown) => {
          logger.error({ err: error, organizationId, pluginId }, "Channel health update failed");
        });

      return { revoked: true as const };
    }),

  /**
   * Report the channel's own health (D13-11), e.g. the provider lowered the
   * account's quality rating. "failing" alerts the org's owners and admins
   * (throttled); "ok" clears a failure the plugin reported. Core-detected
   * failures (failed deliveries, revoked connection) are cleared by core.
   */
  "channel.reportHealth": pluginProcedure
    .input(
      z.object({
        status: z.enum(["ok", "failing"]),
        detail: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      requireCapability(ctx, "messages");
      const { organizationId, pluginId } = ctx.pluginAuth;
      if (input.status === "failing") {
        await channelHealthService.markFailing(
          organizationId,
          pluginId,
          "quality_drop",
          input.detail,
        );
      } else {
        await channelHealthService.markOk(organizationId, pluginId, ["quality_drop"]);
      }
      return { ok: true as const };
    }),

  /**
   * The organization's verified custom sending domain (D13-9), or null. Email
   * plugins send From the merchant's own address only when its domain matches;
   * the platform address stays the default.
   */
  "email.sendingDomain": pluginProcedure.query(async ({ ctx }) => {
    requireCapability(ctx, "email");
    return { domain: await emailDomainService.verifiedDomain(ctx.pluginAuth.organizationId) };
  }),

  /**
   * Replace the shared-webhook routing keys owned by the calling plugin instance.
   *
   * OAuth connections get their keys from `onConnected`. Connections configured
   * without OAuth (WhatsApp manual mode with a pasted token) register them here
   * once the plugin has confirmed its credentials can access those provider
   * accounts. An empty list removes the instance's keys. Last writer wins per
   * key, exactly like a reconnect.
   */
  "webhooks.setRoutingKeys": pluginProcedure
    .input(z.object({ routingKeys: z.array(z.string().min(1).max(256)).max(20) }))
    .mutation(async ({ input, ctx }) => {
      requireCapability(ctx, "messages");

      const { organizationId, pluginId } = ctx.pluginAuth;
      const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
      if (!instance) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Plugin instance not found" });
      }

      const routingKeys = [...new Set(input.routingKeys)];
      await pluginWebhookRouteRepository.clearForInstance(instance.id);
      await pluginWebhookRouteRepository.upsertRoutes(
        pluginId,
        organizationId,
        instance.id,
        routingKeys,
      );

      logger.info(
        { organizationId, pluginId, routingKeyCount: routingKeys.length },
        "Plugin replaced its webhook routing keys",
      );
      return { routingKeyCount: routingKeys.length };
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
        // Not "awaiting-approval": only the approval hold sets that.
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

/** Ordering for monotonic provider status updates. `failed` is handled separately. */
const PROVIDER_STATUS_RANK: Record<MessageProviderStatus, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Decode a base64 string strictly. `Buffer.from` silently drops invalid
 * characters, so validate the alphabet and round-trip length first.
 */
function decodeBase64(data: string): Buffer | null {
  const normalized = data.replace(/\s+/g, "");
  if (normalized.length === 0 || normalized.length % 4 !== 0) return null;
  if (!BASE64_PATTERN.test(normalized)) return null;
  const buffer = Buffer.from(normalized, "base64");
  return buffer.length > 0 ? buffer : null;
}

/** TTL for inbound message dedupe keys — long enough to cover provider retries. */
const INBOUND_DEDUPE_TTL_SECONDS = 24 * 60 * 60; // 24h

/**
 * Helper: Atomically claim a provider message id for dedupe.
 *
 * Generic across channels — the key is namespaced by org + channel + provider
 * message id so two channels (or two orgs) never collide. Uses Redis SETNX with
 * a short TTL: returns `true` when this call set the key (first time we've seen
 * the message), `false` when the key already existed (duplicate delivery).
 *
 * If Redis is unavailable we fail open (return `true`) so message processing is
 * never blocked by a cache outage — at-least-once is preferable to dropping.
 */
async function claimProviderMessage(
  organizationId: string,
  channel: string,
  mid: string,
): Promise<boolean> {
  const client = redisService.getClient();
  if (!client) {
    return true;
  }

  const key = `dedupe:msg:${organizationId}:${channel}:${mid}`;

  try {
    const result = await client.set(key, "1", "EX", INBOUND_DEDUPE_TTL_SECONDS, "NX");
    return result === "OK";
  } catch (error) {
    logger.error({ err: error, organizationId, channel, mid }, "Inbound dedupe check failed");
    return true;
  }
}

/**
 * Helper: Get agent for channel
 *
 * Determines which single agent should handle conversations for a given channel.
 * Agent<->channel is many-to-many (agent.channels), but each incoming message must
 * resolve to exactly one responder. Priority:
 * 1. Agents assigned to this channel. If more than one claims it, prefer the org
 *    default agent if it is among them, otherwise the earliest-created (deterministic).
 *    TODO: replace this tiebreaker once multi-agent-per-channel selection is defined.
 * 2. Organization default agent.
 * 3. First available agent.
 */
async function getAgentForChannel(organizationId: string, channel: string): Promise<string | null> {
  const [agents, org] = await Promise.all([
    agentRepository.findByOrganization(organizationId),
    organizationRepository.findById(organizationId),
  ]);

  // 1. Agents explicitly assigned to this channel.
  const assigned = agents.filter((a) => a.channels?.includes(channel));
  if (assigned.length > 0) {
    if (org?.defaultAgentId) {
      const preferred = assigned.find((a) => a.id === org.defaultAgentId);
      if (preferred) return preferred.id;
    }
    // findByOrganization orders by created_at DESC, so the last entry is earliest.
    return assigned[assigned.length - 1].id;
  }

  // 2. Organization default agent.
  if (org?.defaultAgentId) {
    return org.defaultAgentId;
  }

  // 3. First available agent.
  return agents[0]?.id || null;
}

/**
 * Run `oauthService.revokeOAuth` on the next tick, after the plugin's
 * `connection.revoke` call has been answered — the revoke stops that worker.
 */
export function scheduleConnectionRevoke(organizationId: string, pluginId: string): void {
  setImmediate(() => {
    oauthService.revokeOAuth(organizationId, pluginId).catch((error: unknown) => {
      logger.error({ err: error, organizationId, pluginId }, "Failed to revoke plugin connection");
    });
  });
}
