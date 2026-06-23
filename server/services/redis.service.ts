import Redis from "ioredis";
import { config } from "../config/env";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("redis");

/**
 * Redis Service
 * Provides pub/sub functionality for broadcasting events across multiple server instances
 */
export class RedisService {
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;
  private isInitialized = false;
  private eventHandlers = new Map<string, Set<(data: unknown) => void>>();

  /**
   * Initialize Redis connections
   * Creates separate connections for publishing and subscribing
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.debug("Already initialized");
      return;
    }

    logger.debug(
      { host: config.redis.host, port: config.redis.port, db: config.redis.db },
      "Initializing Redis service",
    );

    try {
      // Create publisher connection
      this.publisher = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        db: config.redis.db,
        tls: config.redis.tls,
        retryStrategy: (times) => {
          if (times > 10) {
            logger.error("Max retry attempts reached, stopping retries");
            return null; // Stop retrying
          }
          const delay = Math.min(times * 1000, 5000);
          logger.debug({ delay, attempt: times }, "Retrying connection");
          return delay;
        },
        maxRetriesPerRequest: null, // Allow indefinite retries per request
        enableReadyCheck: true,
        lazyConnect: false,
        keepAlive: 30000, // Keep connection alive
        connectTimeout: 10000, // 10 second connection timeout
      });

      // Create subscriber connection
      this.subscriber = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        db: config.redis.db,
        tls: config.redis.tls,
        retryStrategy: (times) => {
          if (times > 10) {
            logger.error("Max retry attempts reached, stopping retries");
            return null; // Stop retrying
          }
          const delay = Math.min(times * 1000, 5000);
          logger.debug({ delay, attempt: times }, "Retrying connection");
          return delay;
        },
        maxRetriesPerRequest: null, // Allow indefinite retries per request
        enableReadyCheck: true,
        lazyConnect: false,
        keepAlive: 30000, // Keep connection alive
        connectTimeout: 10000, // 10 second connection timeout
      });

      // Set up event handlers
      this.publisher.on("error", (err) => {
        logger.error({ err }, "Publisher error");
      });

      this.subscriber.on("error", (err) => {
        logger.error({ err }, "Subscriber error");
      });

      this.publisher.on("connect", () => {
        logger.debug("Publisher connected");
      });

      this.subscriber.on("connect", () => {
        logger.debug("Subscriber connected");
      });

      // Handle incoming messages
      this.subscriber.on("message", (channel, message) => {
        this.handleMessage(channel, message);
      });

      this.isInitialized = true;
      logger.debug("Redis service fully initialized and ready");
    } catch (error) {
      logger.error({ err: error }, "Failed to initialize");
      throw error;
    }
  }

  /**
   * Publish a message to a channel
   */
  async publish(channel: string, data: unknown): Promise<void> {
    if (!this.publisher) {
      logger.error("Publisher not initialized");
      return;
    }

    try {
      const message = JSON.stringify(data);
      const dataRecord =
        typeof data === "object" && data !== null ? (data as Record<string, unknown>) : undefined;
      logger.debug(
        {
          channel,
          dataType: dataRecord?.type,
          dataKeys: dataRecord ? Object.keys(dataRecord) : undefined,
        },
        "Publishing message to channel",
      );
      await this.publisher.publish(channel, message);
      logger.debug({ channel }, "Message published successfully");
    } catch (error) {
      logger.error({ err: error, channel }, "Failed to publish");
      throw error;
    }
  }

  /**
   * Subscribe to a channel
   */
  async subscribe(channel: string, handler: (data: unknown) => void): Promise<void> {
    if (!this.subscriber) {
      logger.error("Subscriber not initialized");
      return;
    }

    try {
      // Add handler to map
      if (!this.eventHandlers.has(channel)) {
        this.eventHandlers.set(channel, new Set());
        // Subscribe to channel if first handler
        logger.debug({ channel }, "Subscribing to new channel");
        await this.subscriber.subscribe(channel);
        logger.debug({ channel }, "Successfully subscribed to channel");
      } else {
        logger.debug({ channel }, "Adding handler to existing subscription");
      }

      this.eventHandlers.get(channel)!.add(handler);
      logger.debug(
        { channel, totalHandlers: this.eventHandlers.get(channel)!.size },
        "Handler added for channel",
      );
    } catch (error) {
      logger.error({ err: error, channel }, "Failed to subscribe");
      throw error;
    }
  }

  /**
   * Unsubscribe from a channel
   */
  async unsubscribe(channel: string, handler?: (data: unknown) => void): Promise<void> {
    if (!this.subscriber) {
      return;
    }

    try {
      const handlers = this.eventHandlers.get(channel);
      if (!handlers) {
        return;
      }

      if (handler) {
        // Remove specific handler
        handlers.delete(handler);

        // If no more handlers, unsubscribe from channel
        if (handlers.size === 0) {
          this.eventHandlers.delete(channel);
          await this.subscriber.unsubscribe(channel);
          logger.info({ channel }, "Unsubscribed from channel");
        }
      } else {
        // Remove all handlers for channel
        this.eventHandlers.delete(channel);
        await this.subscriber.unsubscribe(channel);
        logger.info({ channel }, "Unsubscribed from channel");
      }
    } catch (error) {
      logger.error({ err: error, channel }, "Failed to unsubscribe");
    }
  }

  /**
   * Handle incoming message from Redis
   */
  private handleMessage(channel: string, message: string): void {
    try {
      logger.debug({ channel, messageLength: message.length }, "Received message on channel");

      const data: unknown = JSON.parse(message);
      const dataType =
        typeof data === "object" && data !== null
          ? (data as Record<string, unknown>).type
          : undefined;
      const handlers = this.eventHandlers.get(channel);

      if (handlers) {
        logger.debug({ channel, handlerCount: handlers.size, dataType }, "Dispatching to handlers");

        handlers.forEach((handler) => {
          try {
            handler(data);
          } catch (error) {
            logger.error({ err: error, channel }, "Error in handler");
          }
        });

        logger.debug({ channel }, "Message handling complete");
      } else {
        logger.debug({ channel }, "No handlers found for channel");
      }
    } catch (error) {
      logger.error({ err: error, channel }, "Failed to parse message");
    }
  }

  /**
   * Get a Redis client for direct operations (caching, etc.)
   */
  getClient(): Redis | null {
    return this.publisher;
  }

  /**
   * Check if Redis is connected
   */
  isConnected(): boolean {
    return this.isInitialized && this.publisher?.status === "ready";
  }

  /**
   * Gracefully shutdown Redis connections
   */
  async shutdown(): Promise<void> {
    logger.info("Shutting down...");

    try {
      // Unsubscribe from all channels
      if (this.subscriber) {
        await this.subscriber.unsubscribe();
        await this.subscriber.quit();
      }

      if (this.publisher) {
        await this.publisher.quit();
      }

      this.eventHandlers.clear();
      this.isInitialized = false;
      logger.info("Shutdown complete");
    } catch (error) {
      logger.error({ err: error }, "Error during shutdown");
    }
  }
}

// Export singleton instance
export const redisService = new RedisService();
