/**
 * Channel Delivery Service
 *
 * Subscribes to Redis "websocket:events" channel and delivers outbound
 * bot/agent messages to external channel plugins (WhatsApp, etc.).
 *
 * This is the bridge between the orchestrator generating a response and
 * that response being sent to the customer via Twilio/etc. Web channel
 * is skipped (already handled by WebSocket service).
 */

import { createLogger } from "@server/lib/logger";
import { pluginManagerService } from "./plugin-manager.service";
import { MessageRepository } from "@server/repositories/message.repository";
import { ConversationRepository } from "@server/repositories/conversation.repository";
import { CustomerRepository } from "@server/repositories/customer.repository";

const logger = createLogger("channel-delivery");
const messageRepository = new MessageRepository();
const conversationRepository = new ConversationRepository();
const customerRepository = new CustomerRepository();

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
   * Handle an event from the websocket:events Redis channel.
   * Only processes outbound bot/agent messages on non-web channels.
   */
  private async handleRedisEvent(event: any): Promise<void> {
    const { type, conversationId, payload } = event;

    // Only handle message_received events
    if (type !== "message_received" || !conversationId) return;

    // Only deliver bot or human-agent messages (not customer messages, system, etc.)
    const outboundTypes = ["BotAgent", "HumanAgent"];
    if (!outboundTypes.includes(payload?.type)) return;

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

      // Get the customer's external_id (phone number for WhatsApp)
      const customer = conversation.customer;
      if (!customer?.external_id) {
        logger.warn({ conversationId, channel }, "No customer external_id for delivery");
        return;
      }

      logger.info(
        {
          conversationId,
          channel,
          messageId: payload.id,
          to: customer.external_id,
        },
        "Delivering message via channel plugin",
      );

      await this.deliverViaPlugin(
        organizationId,
        channel,
        customer.external_id,
        payload.content,
        payload.id,
        conversationId,
      );
    } catch (error) {
      logger.error({ err: error, conversationId }, "Channel delivery failed");
    }
  }

  /**
   * Find the appropriate plugin worker for this channel and POST to its /deliver endpoint.
   *
   * Looks up which plugin handles the given channel via the plugin registry's
   * manifest `channel` field (set in the plugin's package.json `hay-plugin.channel`).
   */
  private async deliverViaPlugin(
    organizationId: string,
    channel: string,
    to: string,
    content: string,
    messageId: string,
    conversationId: string,
  ): Promise<void> {
    const pluginId = pluginManagerService.findPluginIdByChannel(channel);

    if (!pluginId) {
      logger.warn({ channel, organizationId }, "No plugin registered for channel");
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
      const response = await fetch(deliverUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, content, messageId, conversationId }),
      });

      const result: any = await response.json();

      if (result.success && result.providerMessageId) {
        // Store the provider's message ID (e.g., Twilio SID)
        await messageRepository.updateProviderMessageId(messageId, result.providerMessageId);
        logger.info(
          {
            messageId,
            providerMessageId: result.providerMessageId,
            channel,
          },
          "Channel delivery successful",
        );
      } else if (result.error === "24h_window_expired") {
        logger.warn({ messageId, channel, conversationId }, "24h session window expired");
      } else {
        logger.error(
          { messageId, channel, error: result.error },
          "Channel delivery returned failure",
        );
      }
    } catch (error) {
      logger.error(
        { err: error, deliverUrl, messageId },
        "Failed to deliver message to plugin worker",
      );
    }
  }
}

export const channelDeliveryService = new ChannelDeliveryService();
