import { createLogger } from "@server/lib/logger";
import type { Conversation } from "@server/database/entities/conversation.entity";
import { MessageType, type Message } from "@server/database/entities/message.entity";
import { DeliveryState } from "@server/types/message-feedback.types";
import { messageDeliveryRepository } from "@server/repositories/message-delivery.repository";
import { rabbitmqService, type RabbitMQService } from "./rabbitmq.service";

const logger = createLogger("channel-delivery-queue");

export const CHANNEL_DELIVERY_QUEUES = {
  DELIVER: "channel.deliver",
  DEAD: "channel.deliver.dead",
} as const;

/** 3 retries with exponential backoff (5 s, 15 s, 45 s). Meta's pair limit is ~1 msg / 6 s. */
export const DEFAULT_RETRY_DELAYS_MS = [5_000, 15_000, 45_000];

/** Body of a message on the delivery queues; `messageId` is the delivery row id. */
export interface ChannelDeliveryQueueMessage {
  messageId: string;
}

const OUTBOUND_TYPES: string[] = [
  MessageType.BOT_AGENT,
  MessageType.HUMAN_AGENT,
  MessageType.PRODUCT_RECOMMENDATION,
];

/** One queue per delay: a TTL queue only expires its head, so delays cannot be mixed. */
function retryQueueName(delayMs: number): string {
  return `${CHANNEL_DELIVERY_QUEUES.DELIVER}.retry.${delayMs}`;
}

/**
 * Records outbound deliveries and publishes them. The row is written first, so
 * a delivery survives Redis or RabbitMQ being down: the sweep publishes
 * whatever the queue never received.
 */
export class ChannelDeliveryQueueService {
  constructor(
    private readonly rabbit: RabbitMQService = rabbitmqService,
    private readonly retryDelaysMs: number[] = DEFAULT_RETRY_DELAYS_MS,
  ) {}

  async declareQueues(): Promise<void> {
    await this.rabbit.assertQueue(CHANNEL_DELIVERY_QUEUES.DEAD);
    for (const delayMs of this.retryDelaysMs) {
      await this.rabbit.assertQueue(retryQueueName(delayMs), {
        deadLetterExchange: "",
        deadLetterRoutingKey: CHANNEL_DELIVERY_QUEUES.DELIVER,
        messageTtl: delayMs,
      });
    }
    await this.rabbit.assertQueue(CHANNEL_DELIVERY_QUEUES.DELIVER, {
      deadLetterExchange: "",
      deadLetterRoutingKey: CHANNEL_DELIVERY_QUEUES.DEAD,
    });
  }

  /**
   * Queue a released bot/agent message or product card. Web conversations are
   * served by the WebSocket; only a person's reply is queued there, for the
   * email to a shopper who has left. Messages that came from the channel
   * itself are never echoed back to it.
   */
  async enqueueMessage(
    conversation: Pick<Conversation, "id" | "organization_id" | "channel">,
    message: Pick<Message, "id" | "type" | "metadata" | "deliveryState">,
  ): Promise<void> {
    if (!OUTBOUND_TYPES.includes(message.type)) return;
    if ((message.metadata as Record<string, unknown> | null)?.externalOrigin === true) return;
    if (message.deliveryState !== DeliveryState.SENT) return;
    if (conversation.channel === "web" && message.type !== MessageType.HUMAN_AGENT) return;

    const created = await messageDeliveryRepository.insertMessage({
      messageId: message.id,
      organizationId: conversation.organization_id,
      conversationId: conversation.id,
    });
    if (created) await this.publish(message.id);
  }

  /** Queue the provider-side handoff for a conversation waiting on a person. */
  async enqueueEscalation(
    conversation: Pick<Conversation, "id" | "organization_id" | "channel">,
  ): Promise<void> {
    if (conversation.channel === "web") return;

    const id = await messageDeliveryRepository.insertEscalation({
      organizationId: conversation.organization_id,
      conversationId: conversation.id,
    });
    if (id) await this.publish(id);
  }

  async publish(id: string): Promise<boolean> {
    return this.send(CHANNEL_DELIVERY_QUEUES.DELIVER, id);
  }

  async publishRetry(id: string, delayMs: number): Promise<boolean> {
    return this.send(retryQueueName(delayMs), id);
  }

  private async send(queue: string, id: string): Promise<boolean> {
    if (!this.rabbit.isConnected()) {
      logger.debug({ id, queue }, "RabbitMQ unavailable, the sweep will publish this delivery");
      return false;
    }
    const message: ChannelDeliveryQueueMessage = { messageId: id };
    return this.rabbit.publish(queue, message);
  }
}

export const channelDeliveryQueueService = new ChannelDeliveryQueueService();
