/**
 * Channel Delivery Service
 *
 * Subscribes to Redis "websocket:events" channel and delivers outbound
 * bot/agent messages to external channel plugins (WhatsApp, Chatwoot, etc.).
 *
 * Two responsibilities:
 *   1. message_received events → POST to plugin /deliver for outbound send
 *   2. conversation_status_changed → pending-human → POST to plugin /escalate
 *      for channel-side handoff (e.g. Chatwoot toggle_status + assign team)
 *
 * Web channel is skipped for both (dashboard handles it directly).
 * /escalate is best-effort — plugins that don't implement it return 404 which
 * is silently tolerated so channel plugins aren't forced to implement it.
 */

import { createLogger } from "@server/lib/logger";
import { pluginManagerService } from "./plugin-manager.service";
import { MessageRepository } from "@server/repositories/message.repository";
import { ConversationRepository } from "@server/repositories/conversation.repository";
import { DELIVERY_SIGNED_URL_TTL_SECONDS, signAttachmentUrls } from "./media-url.service";
import type {
  MessageAttachment,
  MessageProviderError,
} from "@server/database/entities/message.entity";

const logger = createLogger("channel-delivery");
const messageRepository = new MessageRepository();
const conversationRepository = new ConversationRepository();

/**
 * Payload carried by Redis "websocket:events" messages.
 * Untrusted, so every field is optional and narrowed before use.
 */
interface ChannelEventPayload {
  type?: string;
  id?: string;
  content?: string;
  status?: string;
  deliveryState?: string;
  metadata?: { externalOrigin?: boolean; [key: string]: unknown } | null;
  attachments?: MessageAttachment[] | null;
  [key: string]: unknown;
}

/**
 * Event broadcast over the Redis "websocket:events" channel that this
 * service consumes (message delivery + escalation).
 */
interface ChannelDeliveryEvent {
  type?: string;
  conversationId?: string;
  payload?: ChannelEventPayload;
}

/**
 * Response returned by a channel plugin's /deliver endpoint.
 */
interface PluginDeliverResponse {
  success?: boolean;
  providerMessageId?: string;
  error?: string;
}

class ChannelDeliveryService {
  private initialized = false;

  /**
   * Initialize by subscribing to the same Redis channel as the WebSocket service.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const { redisService } = await import("./redis.service");

      await redisService.subscribe("websocket:events", (event) => {
        this.handleRedisEvent(event).catch((error) => {
          logger.error({ err: error }, "Unhandled error in channel delivery handler");
        });
      });

      this.initialized = true;
      logger.info("Channel delivery service initialized");
    } catch (error) {
      logger.error({ err: error }, "Failed to initialize channel delivery service");
    }
  }

  /**
   * Dispatch Redis events to the right handler.
   */
  private async handleRedisEvent(event: unknown): Promise<void> {
    if (typeof event !== "object" || event === null) return;
    const { type, conversationId } = event as ChannelDeliveryEvent;
    if (!conversationId) return;

    if (type === "message_received") {
      await this.handleOutboundMessage(event);
      return;
    }

    if (type === "conversation_status_changed") {
      await this.handleStatusChange(event);
      return;
    }
  }

  /**
   * Outbound message path — only processes bot/agent messages on non-web channels.
   */
  private async handleOutboundMessage(event: ChannelDeliveryEvent): Promise<void> {
    const { conversationId, payload } = event;
    if (!conversationId || !payload) return;

    // Only deliver bot or human-agent messages (not customer messages, system, etc.)
    const outboundTypes = ["BotAgent", "HumanAgent"];
    if (!payload.type || !outboundTypes.includes(payload.type)) return;

    // Skip messages that originated from the external channel itself — these
    // arrive via the plugin webhook (e.g. a Chatwoot agent replies) and must
    // not be echoed back to the same channel, which would loop indefinitely.
    if (payload?.metadata?.externalOrigin === true) return;

    // Only deliver messages with "sent" delivery state (skip "queued" in test mode)
    if (payload?.deliveryState !== "sent") return;

    try {
      // Look up the conversation to check its channel
      const conversation = await conversationRepository.findById(conversationId);
      if (!conversation) {
        logger.warn({ conversationId }, "Conversation not found for channel delivery");
        return;
      }

      // Skip web channel — WebSocket service already handles it
      if (conversation.channel === "web") return;

      const channel = conversation.channel;
      const organizationId = conversation.organization_id;

      // Get the customer's external_id (phone number for WhatsApp, contact id for Chatwoot, etc.)
      const customer = conversation.customer;
      if (!customer?.external_id) {
        logger.warn({ conversationId, channel }, "No customer external_id for delivery");
        return;
      }

      // Attachment-only messages carry an empty string content and must still
      // be delivered — only a missing id/content aborts.
      const { id: messageId, content } = payload;
      if (!messageId || content === undefined) {
        logger.warn({ conversationId, channel }, "Message id or content missing for delivery");
        return;
      }

      logger.info(
        {
          conversationId,
          channel,
          messageId,
          to: customer.external_id,
        },
        "Delivering message via channel plugin",
      );

      await this.deliverViaPlugin({
        organizationId,
        channel,
        to: customer.external_id,
        content,
        messageId,
        conversationId,
        conversationMetadata: (conversation.metadata ?? null) as Record<string, unknown> | null,
        messageMetadata: (payload.metadata ?? null) as Record<string, unknown> | null,
        attachments: payload.attachments ?? [],
      });
    } catch (error) {
      logger.error({ err: error, conversationId }, "Channel delivery failed");
    }
  }

  /**
   * Escalation path — when the orchestrator flips a conversation to pending-human
   * on a non-web channel, notify the owning plugin so it can perform provider-side
   * handoff (Chatwoot: toggle_status=open + optional assign + private note).
   */
  private async handleStatusChange(event: ChannelDeliveryEvent): Promise<void> {
    const { conversationId, payload } = event;
    if (!conversationId) return;
    if (payload?.status !== "pending-human") return;

    try {
      const conversation = await conversationRepository.findById(conversationId);
      if (!conversation) return;
      if (conversation.channel === "web") return;

      const pluginId = await pluginManagerService.findPluginIdByChannel(
        conversation.organization_id,
        conversation.channel,
      );
      if (!pluginId) return;

      logger.info(
        { conversationId, channel: conversation.channel, pluginId },
        "Dispatching /escalate to channel plugin",
      );

      let worker;
      try {
        worker = await pluginManagerService.getOrStartWorker(
          conversation.organization_id,
          pluginId,
        );
      } catch (error) {
        logger.error(
          { err: error, pluginId, organizationId: conversation.organization_id },
          "Failed to get/start channel plugin worker for escalation",
        );
        return;
      }

      const escalateUrl = `http://localhost:${worker.port}/escalate`;

      try {
        const response = await fetch(escalateUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            conversationMetadata: conversation.metadata ?? null,
            reason: "orchestrator_handoff",
          }),
        });

        // 404 = plugin doesn't implement /escalate — that's fine.
        if (response.status === 404) {
          logger.debug(
            { pluginId, channel: conversation.channel },
            "Channel plugin does not implement /escalate — skipping",
          );
          return;
        }

        if (!response.ok) {
          const text = await response.text();
          logger.warn(
            { pluginId, status: response.status, body: text },
            "Plugin /escalate returned non-OK",
          );
        }
      } catch (error) {
        logger.error(
          { err: error, escalateUrl, conversationId },
          "Failed to call plugin /escalate",
        );
      }
    } catch (error) {
      logger.error({ err: error, conversationId }, "handleStatusChange failed");
    }
  }

  /**
   * Find the appropriate plugin worker for this channel and POST to its /deliver endpoint.
   *
   * Resolves the org's enabled plugin instance whose manifest `channel` field
   * (package.json `hay-plugin.channel`) matches the conversation channel.
   */
  private async deliverViaPlugin(args: {
    organizationId: string;
    channel: string;
    to: string;
    content: string;
    messageId: string;
    conversationId: string;
    conversationMetadata: Record<string, unknown> | null;
    messageMetadata: Record<string, unknown> | null;
    attachments: MessageAttachment[];
  }): Promise<void> {
    const {
      organizationId,
      channel,
      to,
      content,
      messageId,
      conversationId,
      conversationMetadata,
      messageMetadata,
      attachments,
    } = args;

    const pluginId = await pluginManagerService.findPluginIdByChannel(organizationId, channel);

    if (!pluginId) {
      logger.warn({ channel, organizationId }, "No enabled plugin for channel in organization");
      return;
    }

    let worker;
    try {
      worker = await pluginManagerService.getOrStartWorker(organizationId, pluginId);
    } catch (error) {
      logger.error(
        { err: error, pluginId, organizationId },
        "Failed to get/start channel plugin worker",
      );
      return;
    }

    const deliverUrl = `http://localhost:${worker.port}/deliver`;

    try {
      // Private uploads need a signature: the worker fetches each file with a plain GET.
      const deliverableAttachments = await signAttachmentUrls(
        attachments,
        organizationId,
        DELIVERY_SIGNED_URL_TTL_SECONDS,
      );
      const response = await fetch(deliverUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          content,
          messageId,
          conversationId,
          conversationMetadata,
          messageMetadata,
          attachments: deliverableAttachments,
        }),
      });

      const result = (await response.json()) as PluginDeliverResponse;

      if (result.success && result.providerMessageId) {
        // Store the provider's message id (e.g. Meta wamid, Chatwoot message id)
        // so later status webhooks can be matched back to this message.
        await messageRepository.updateProviderMessageId(messageId, result.providerMessageId);
        logger.info(
          {
            messageId,
            providerMessageId: result.providerMessageId,
            channel,
          },
          "Channel delivery successful",
        );
      } else if (!result.success) {
        if (result.error === "24h_window_expired") {
          logger.warn({ messageId, channel, conversationId }, "24h session window expired");
        } else {
          logger.error(
            { messageId, channel, error: result.error },
            "Channel delivery returned failure",
          );
        }
        await this.markDeliveryFailed({
          messageId,
          conversationId,
          organizationId,
          error: { code: result.error ?? "delivery_failed" },
        });
      }
    } catch (error) {
      logger.error(
        { err: error, deliverUrl, messageId },
        "Failed to deliver message to plugin worker",
      );
    }
  }

  /**
   * Persist a provider-side failure on the message and tell dashboard clients.
   * Publishes `message_status_updated` — never `message_received`, which would
   * re-trigger delivery.
   */
  private async markDeliveryFailed(args: {
    messageId: string;
    conversationId: string;
    organizationId: string;
    error: MessageProviderError;
  }): Promise<void> {
    const { messageId, conversationId, organizationId, error } = args;
    try {
      await messageRepository.update(messageId, {
        providerStatus: "failed",
        providerError: error,
      });

      const { redisService } = await import("./redis.service");
      await redisService.publish("websocket:events", {
        type: "message_status_updated",
        organizationId,
        payload: {
          conversationId,
          messageId,
          providerStatus: "failed",
          providerError: error,
        },
      });
    } catch (err) {
      logger.error({ err, messageId }, "Failed to persist delivery failure");
    }
  }
}

export const channelDeliveryService = new ChannelDeliveryService();
