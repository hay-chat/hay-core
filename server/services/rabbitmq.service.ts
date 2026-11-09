import amqplib, {
  type ChannelModel,
  type Channel,
  type ConfirmChannel,
  type ConsumeMessage,
} from "amqplib";
import { config } from "@server/config/env";
import { createLogger } from "@server/lib/logger";
import { metrics } from "@server/lib/metrics";
import { extractTraceContext, injectTraceHeaders, withSpan } from "@server/lib/tracing";
import { EventEmitter } from "events";

const logger = createLogger("rabbitmq");

const CHANNEL_REOPEN_DELAY_MS = 1000;

/**
 * RabbitMQ Service
 * Provides message queue functionality for reliable, event-driven message processing.
 * Handles connection management with reconnection/backoff, queue declaration,
 * publishing, and consuming.
 *
 * Publishing uses one confirm channel: publish() resolves true only once the
 * broker has taken responsibility for the message. Each consumer has its own
 * channel, so prefetch is per queue and a channel error on one queue leaves
 * publishing and the other consumers running.
 */
export class RabbitMQService extends EventEmitter {
  private connection: ChannelModel | null = null;
  private publishChannel: ConfirmChannel | null = null;
  private isInitialized = false;
  private reconnecting = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectDelay = 30000;
  private consumers = new Map<
    string,
    {
      handler: (msg: ConsumeMessage) => Promise<void>;
      options?: { prefetch?: number };
    }
  >();
  /** Declared queues with their arguments, re-asserted unchanged after a reconnect. */
  private declaredQueues = new Map<string, amqplib.Options.AssertQueue | undefined>();
  private consumerChannels = new Map<string, { channel: Channel; consumerTag: string }>();
  private attachingConsumers = new Set<string>();
  /** The channel each in-flight message came from: an ack must go back on that channel. */
  private messageChannels = new WeakMap<ConsumeMessage, Channel>();

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.debug("Already initialized");
      return;
    }

    logger.debug(
      { url: config.rabbitmq.url.replace(/\/\/.*@/, "//***@") },
      "Initializing RabbitMQ service",
    );

    // Set before connecting: a broker that is down at boot must keep being retried.
    this.isInitialized = true;

    try {
      await this.connect();
      logger.debug("RabbitMQ service fully initialized and ready");
    } catch (error) {
      logger.error({ err: error }, "Failed to initialize RabbitMQ, will keep retrying");
      this.scheduleReconnect();
      throw error;
    }
  }

  private async connect(): Promise<void> {
    const connection = await amqplib.connect(config.rabbitmq.url, {
      timeout: 10_000, // 10s TCP connection timeout
    });
    this.connection = connection;

    connection.on("error", (err: Error) => {
      logger.error({ err }, "RabbitMQ connection error");
    });

    connection.on("close", () => {
      logger.warn("RabbitMQ connection closed");
      this.publishChannel = null;
      this.connection = null;
      this.consumerChannels.clear();
      this.emit("disconnected");
      this.scheduleReconnect();
    });

    await this.openPublishChannel(connection);

    this.reconnectAttempts = 0;
    this.reconnecting = false;
    this.emit("connected");
    logger.debug("Connected to RabbitMQ");
  }

  private async openPublishChannel(connection: ChannelModel): Promise<void> {
    const channel = await connection.createConfirmChannel();

    channel.on("error", (err: Error) => {
      logger.error({ err }, "RabbitMQ publish channel error");
    });

    channel.on("close", () => {
      logger.debug("Publish channel closed");
      if (this.publishChannel === channel) this.publishChannel = null;
      this.afterChannelLoss(connection, () => this.openPublishChannel(connection));
    });

    this.publishChannel = channel;
  }

  /**
   * Reopen a channel that closed while its connection stayed up. When reopening
   * fails the connection is closed, which starts the normal reconnect path.
   */
  private afterChannelLoss(connection: ChannelModel, reopen: () => Promise<void>): void {
    const timer = setTimeout(() => {
      if (!this.isInitialized || this.connection !== connection) return;
      reopen().catch((err: unknown) => {
        logger.error({ err }, "Failed to reopen RabbitMQ channel");
        connection.close().catch(() => undefined);
      });
    }, CHANNEL_REOPEN_DELAY_MS);
    timer.unref();
  }

  private scheduleReconnect(): void {
    if (this.reconnecting || !this.isInitialized) return;
    this.reconnecting = true;

    // Reconnect forever with capped exponential backoff.
    const delay = Math.min(
      Math.pow(2, Math.min(this.reconnectAttempts, 15)) * 1000,
      this.maxReconnectDelay,
    );
    this.reconnectAttempts++;
    if (this.reconnectAttempts % 10 === 0) {
      logger.error({ attempt: this.reconnectAttempts }, "RabbitMQ still unreachable, retrying");
    }

    logger.debug(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(async () => {
      if (!this.isInitialized) {
        // Shut down while waiting.
        this.reconnecting = false;
        return;
      }
      try {
        await this.connect();
        // Re-declare queues and re-attach consumers
        await this.restoreState();
        logger.debug("Reconnected and restored state");
      } catch (error) {
        logger.error({ err: error }, "Reconnect failed");
        this.reconnecting = false;
        this.scheduleReconnect();
      }
    }, delay);
  }

  private async restoreState(): Promise<void> {
    for (const [queue, options] of [...this.declaredQueues]) {
      await this.assertQueue(queue, options);
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
    if (!this.publishChannel) {
      throw new Error("[RabbitMQ] Channel not available");
    }

    await this.publishChannel.assertQueue(queue, {
      durable: true,
      ...options,
    });

    this.declaredQueues.set(queue, options);
    logger.debug(`Queue declared: ${queue}`);
  }

  /**
   * Publish a persistent message to a queue. Resolves true once the broker has
   * confirmed it, false when it could not be handed over.
   */
  async publish<T extends { messageId?: string }>(queue: string, message: T): Promise<boolean> {
    const channel = this.publishChannel;
    if (!channel) {
      logger.warn({ queue }, "Channel not available, message not published");
      metrics.queuePublished.inc({ queue, outcome: "failed" });
      return false;
    }

    try {
      const content = Buffer.from(JSON.stringify(message));
      await withSpan(
        "queue publish",
        { "messaging.system": "rabbitmq", "messaging.destination": queue },
        () =>
          new Promise<void>((resolve, reject) => {
            channel.sendToQueue(
              queue,
              content,
              {
                persistent: true,
                contentType: "application/json",
                messageId: (message.messageId as string) || undefined,
                timestamp: Date.now(),
                headers: injectTraceHeaders(),
              },
              (err) => (err ? reject(err) : resolve()),
            );
          }),
      );

      logger.debug({ messageId: message.messageId }, `Published message to queue: ${queue}`);
      metrics.queuePublished.inc({ queue, outcome: "ok" });
      return true;
    } catch (error) {
      logger.error({ err: error, queue }, "Failed to publish to queue");
      metrics.queuePublished.inc({ queue, outcome: "failed" });
      return false;
    }
  }

  /**
   * Subscribe to a queue, on a channel of its own. Only one consumer per queue
   * is supported. The handler receives the raw ConsumeMessage and must ack/nack
   * via the service's ack()/nack() methods.
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
    const connection = this.connection;
    if (!connection) {
      logger.debug(`Cannot consume ${queue}: connection not available`);
      return;
    }
    if (this.consumerChannels.has(queue) || this.attachingConsumers.has(queue)) return;

    this.attachingConsumers.add(queue);
    try {
      const channel = await connection.createChannel();

      channel.on("error", (err: Error) => {
        logger.error({ err, queue }, "RabbitMQ consumer channel error");
      });

      channel.on("close", () => {
        logger.debug({ queue }, "Consumer channel closed");
        if (this.consumerChannels.get(queue)?.channel === channel) {
          this.consumerChannels.delete(queue);
        }
        this.afterChannelLoss(connection, async () => {
          const consumer = this.consumers.get(queue);
          if (consumer) await this.consumeInternal(queue, consumer.handler, consumer.options);
        });
      });

      if (options?.prefetch) {
        await channel.prefetch(options.prefetch);
      }

      const { consumerTag } = await channel.consume(queue, async (msg: ConsumeMessage | null) => {
        if (!msg) return;
        this.messageChannels.set(msg, channel);
        metrics.queueConsumed.inc({ queue });
        const publishedAt = msg.properties.timestamp;
        if (typeof publishedAt === "number") {
          const waitedMs = Date.now() - publishedAt;
          if (waitedMs >= 0) metrics.queueWaitSeconds.observe({ queue }, waitedMs / 1000);
        }

        try {
          await withSpan(
            "queue consume",
            {
              "messaging.system": "rabbitmq",
              "messaging.destination": queue,
              "messaging.operation": "process",
            },
            () => handler(msg),
            { parent: extractTraceContext(msg.properties.headers) },
          );
        } catch (error) {
          logger.error({ err: error, queue }, "Consumer handler error");
          // Nack without requeue on handler exceptions — let dead-letter handle it
          this.nack(msg, false);
        }
      });

      this.consumerChannels.set(queue, { channel, consumerTag });
      logger.debug({ consumerTag }, `Consuming from queue: ${queue}`);
    } finally {
      this.attachingConsumers.delete(queue);
    }
  }

  /**
   * Stop receiving new messages from a queue. Messages already being handled
   * can still be acked: the channel stays open until shutdown().
   */
  async stopConsuming(queue: string): Promise<void> {
    this.consumers.delete(queue);
    const attached = this.consumerChannels.get(queue);
    if (!attached) return;
    try {
      await attached.channel.cancel(attached.consumerTag);
    } catch {
      // Channel may already be closed
    }
  }

  /**
   * Acknowledge a message (successfully processed).
   */
  ack(msg: ConsumeMessage): void {
    this.settle(msg, (channel) => channel.ack(msg));
  }

  /**
   * Reject a message. If requeue is true, the message is re-queued;
   * otherwise it goes to the dead-letter exchange (if configured).
   */
  nack(msg: ConsumeMessage, requeue = false): void {
    metrics.queueNacked.inc({ queue: msg.fields.routingKey, requeue: String(requeue) });
    this.settle(msg, (channel) => channel.nack(msg, false, requeue));
  }

  private settle(msg: ConsumeMessage, apply: (channel: Channel) => void): void {
    const channel = this.messageChannels.get(msg);
    if (!channel) return;
    try {
      apply(channel);
    } catch (error) {
      // The channel closed first; the broker has already requeued the message.
      logger.debug({ err: error }, "Could not settle message on a closed channel");
    }
  }

  /**
   * Parse the JSON body of a consumed message.
   */
  parseMessage<T = Record<string, unknown>>(msg: ConsumeMessage): T {
    return JSON.parse(msg.content.toString()) as T;
  }

  /** Messages ready in a queue, or null when it cannot be read. */
  async queueDepth(queue: string): Promise<number | null> {
    if (!this.connection) return null;
    try {
      // A failed check closes the channel it ran on, so it gets its own.
      const channel = await this.connection.createChannel();
      channel.on("error", () => undefined);
      const { messageCount } = await channel.checkQueue(queue);
      await channel.close();
      return messageCount;
    } catch (error) {
      logger.debug({ err: error, queue }, "Could not read queue depth");
      return null;
    }
  }

  isConnected(): boolean {
    return this.isInitialized && this.connection !== null && this.publishChannel !== null;
  }

  async shutdown(): Promise<void> {
    logger.info("Shutting down RabbitMQ...");
    this.isInitialized = false;

    try {
      for (const [queue, { channel, consumerTag }] of this.consumerChannels.entries()) {
        try {
          await channel.cancel(consumerTag);
          await channel.close();
          logger.debug(`Cancelled consumer for queue: ${queue}`);
        } catch {
          // Channel may already be closed
        }
      }

      if (this.publishChannel) {
        await this.publishChannel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
    } catch (error) {
      logger.error({ err: error }, "Error during shutdown");
    }

    this.publishChannel = null;
    this.connection = null;
    this.consumers.clear();
    this.consumerChannels.clear();
    this.declaredQueues.clear();
    logger.info("RabbitMQ shutdown complete");
  }
}

// Export singleton instance
export const rabbitmqService = new RabbitMQService();
