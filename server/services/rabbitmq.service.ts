import amqplib, { type ChannelModel, type Channel, type ConsumeMessage } from "amqplib";
import { config } from "@server/config/env";
import { debugLog } from "@server/lib/debug-logger";
import { createLogger } from "@server/lib/logger";
import { EventEmitter } from "events";

const logger = createLogger("rabbitmq");

/**
 * RabbitMQ Service
 * Provides message queue functionality for reliable, event-driven message processing.
 * Handles connection management with reconnection/backoff, channel creation,
 * queue/exchange declaration, publishing, and consuming.
 */
export class RabbitMQService extends EventEmitter {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private isInitialized = false;
  private reconnecting = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private readonly maxReconnectDelay = 30000;
  private consumers = new Map<
    string,
    {
      handler: (msg: ConsumeMessage) => Promise<void>;
      options?: { prefetch?: number };
    }
  >();
  private declaredQueues = new Set<string>();
  private consumerTags = new Map<string, string>();

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      debugLog("rabbitmq", "Already initialized");
      return;
    }

    debugLog("rabbitmq", "Initializing RabbitMQ service", {
      url: config.rabbitmq.url.replace(/\/\/.*@/, "//***@"),
    });

    try {
      await this.connect();
      this.isInitialized = true;
      debugLog("rabbitmq", "RabbitMQ service fully initialized and ready");
    } catch (error) {
      logger.error({ err: error }, "Failed to initialize RabbitMQ");
      throw error;
    }
  }

  private async connect(): Promise<void> {
    this.connection = await amqplib.connect(config.rabbitmq.url, {
      timeout: 10_000, // 10s TCP connection timeout
    });

    this.connection.on("error", (err: Error) => {
      logger.error({ err }, "RabbitMQ connection error");
    });

    this.connection.on("close", () => {
      logger.warn("RabbitMQ connection closed");
      this.channel = null;
      this.connection = null;
      this.declaredQueues.clear();
      this.consumerTags.clear();
      this.emit("disconnected");
      this.scheduleReconnect();
    });

    this.channel = await this.connection.createChannel();

    this.channel.on("error", (err: Error) => {
      logger.error({ err }, "RabbitMQ channel error");
    });

    this.channel.on("close", () => {
      debugLog("rabbitmq", "Channel closed");
      this.channel = null;
    });

    this.reconnectAttempts = 0;
    this.reconnecting = false;
    this.emit("connected");
    debugLog("rabbitmq", "Connected to RabbitMQ");
  }

  private scheduleReconnect(): void {
    if (this.reconnecting || !this.isInitialized) return;
    this.reconnecting = true;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error("Max reconnect attempts reached, giving up");
      return;
    }

    const delay = Math.min(Math.pow(2, this.reconnectAttempts) * 1000, this.maxReconnectDelay);
    this.reconnectAttempts++;

    debugLog("rabbitmq", `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(async () => {
      try {
        await this.connect();
        // Re-declare queues and re-attach consumers
        await this.restoreState();
        debugLog("rabbitmq", "Reconnected and restored state");
      } catch (error) {
        logger.error({ err: error }, "Reconnect failed");
        this.reconnecting = false;
        this.scheduleReconnect();
      }
    }, delay);
  }

  private async restoreState(): Promise<void> {
    // Re-declare all previously declared queues
    const queuesToRedeclare = [...this.declaredQueues];
    this.declaredQueues.clear();

    for (const queue of queuesToRedeclare) {
      await this.assertQueue(queue, { durable: true });
    }

    // Re-attach consumers
    for (const [queue, { handler, options }] of this.consumers.entries()) {
      await this.consumeInternal(queue, handler, options);
    }
  }

  /**
   * Declare a durable queue. Idempotent — safe to call multiple times.
   */
  async assertQueue(queue: string, options?: amqplib.Options.AssertQueue): Promise<void> {
    if (!this.channel) {
      throw new Error("[RabbitMQ] Channel not available");
    }

    await this.channel.assertQueue(queue, {
      durable: true,
      ...options,
    });

    this.declaredQueues.add(queue);
    debugLog("rabbitmq", `Queue declared: ${queue}`);
  }

  /**
   * Publish a message to a queue. Message is persisted (deliveryMode: 2).
   */
  async publish<T extends { messageId?: string }>(queue: string, message: T): Promise<boolean> {
    if (!this.channel) {
      logger.warn({ queue }, "Channel not available, message not published");
      return false;
    }

    try {
      const content = Buffer.from(JSON.stringify(message));
      const sent = this.channel.sendToQueue(queue, content, {
        persistent: true,
        contentType: "application/json",
        messageId: (message.messageId as string) || undefined,
        timestamp: Date.now(),
      });

      debugLog("rabbitmq", `Published message to queue: ${queue}`, {
        messageId: message.messageId,
        sent,
      });

      return sent;
    } catch (error) {
      logger.error({ err: error, queue }, "Failed to publish to queue");
      return false;
    }
  }

  /**
   * Subscribe to a queue. Only one consumer per queue is supported.
   * The handler receives the raw ConsumeMessage and must ack/nack via
   * the service's ack()/nack() methods.
   */
  async consume(
    queue: string,
    handler: (msg: ConsumeMessage) => Promise<void>,
    options?: { prefetch?: number },
  ): Promise<void> {
    this.consumers.set(queue, { handler, options });
    await this.consumeInternal(queue, handler, options);
  }

  private async consumeInternal(
    queue: string,
    handler: (msg: ConsumeMessage) => Promise<void>,
    options?: { prefetch?: number },
  ): Promise<void> {
    if (!this.channel) {
      debugLog("rabbitmq", `Cannot consume ${queue}: channel not available`);
      return;
    }

    if (options?.prefetch) {
      await this.channel.prefetch(options.prefetch);
    }

    const { consumerTag } = await this.channel.consume(
      queue,
      async (msg: ConsumeMessage | null) => {
        if (!msg) return;

        try {
          await handler(msg);
        } catch (error) {
          logger.error({ err: error, queue }, "Consumer handler error");
          // Nack without requeue on handler exceptions — let dead-letter handle it
          this.nack(msg, false);
        }
      },
    );

    this.consumerTags.set(queue, consumerTag);
    debugLog("rabbitmq", `Consuming from queue: ${queue}`, { consumerTag });
  }

  /**
   * Acknowledge a message (successfully processed).
   */
  ack(msg: ConsumeMessage): void {
    this.channel?.ack(msg);
  }

  /**
   * Reject a message. If requeue is true, the message is re-queued;
   * otherwise it goes to the dead-letter exchange (if configured).
   */
  nack(msg: ConsumeMessage, requeue = false): void {
    this.channel?.nack(msg, false, requeue);
  }

  /**
   * Parse the JSON body of a consumed message.
   */
  parseMessage<T = Record<string, unknown>>(msg: ConsumeMessage): T {
    return JSON.parse(msg.content.toString()) as T;
  }

  isConnected(): boolean {
    return this.isInitialized && this.connection !== null && this.channel !== null;
  }

  async shutdown(): Promise<void> {
    logger.info("Shutting down RabbitMQ...");
    this.isInitialized = false;

    try {
      // Cancel all consumers
      if (this.channel) {
        for (const [queue, tag] of this.consumerTags.entries()) {
          try {
            await this.channel.cancel(tag);
            debugLog("rabbitmq", `Cancelled consumer for queue: ${queue}`);
          } catch {
            // Channel may already be closed
          }
        }
      }

      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
    } catch (error) {
      logger.error({ err: error }, "Error during shutdown");
    }

    this.channel = null;
    this.connection = null;
    this.consumers.clear();
    this.consumerTags.clear();
    this.declaredQueues.clear();
    logger.info("RabbitMQ shutdown complete");
  }
}

// Export singleton instance
export const rabbitmqService = new RabbitMQService();
