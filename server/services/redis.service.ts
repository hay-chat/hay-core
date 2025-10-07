import Redis from "ioredis";
import { config } from "../config/env";

/**
 * Redis Service
 * Provides pub/sub functionality for broadcasting events across multiple server instances
 */
export class RedisService {
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;
  private isInitialized = false;
  private eventHandlers = new Map<string, Set<(data: any) => void>>();

  /**
   * Initialize Redis connections
   * Creates separate connections for publishing and subscribing
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log("[Redis] Already initialized");
      return;
    }

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
            console.error("[Redis] Max retry attempts reached, stopping retries");
            return null; // Stop retrying
          }
          const delay = Math.min(times * 1000, 5000);
          console.log(`[Redis] Retrying connection in ${delay}ms (attempt ${times})`);
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
            console.error("[Redis] Max retry attempts reached, stopping retries");
            return null; // Stop retrying
          }
          const delay = Math.min(times * 1000, 5000);
          console.log(`[Redis] Retrying connection in ${delay}ms (attempt ${times})`);
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
        console.error("[Redis Publisher] Error:", err);
      });

      this.subscriber.on("error", (err) => {
        console.error("[Redis Subscriber] Error:", err);
      });

      this.publisher.on("connect", () => {
        console.log("[Redis Publisher] Connected");
      });

      this.subscriber.on("connect", () => {
        console.log("[Redis Subscriber] Connected");
      });

      // Handle incoming messages
      this.subscriber.on("message", (channel, message) => {
        this.handleMessage(channel, message);
      });

      this.isInitialized = true;
      console.log("🔴 Redis service initialized");
    } catch (error) {
      console.error("[Redis] Failed to initialize:", error);
      throw error;
    }
  }

  /**
   * Publish a message to a channel
   */
  async publish(channel: string, data: any): Promise<void> {
    if (!this.publisher) {
      console.error("[Redis] Publisher not initialized");
      return;
    }

    try {
      const message = JSON.stringify(data);
      await this.publisher.publish(channel, message);
    } catch (error) {
      console.error(`[Redis] Failed to publish to ${channel}:`, error);
      throw error;
    }
  }

  /**
   * Subscribe to a channel
   */
  async subscribe(channel: string, handler: (data: any) => void): Promise<void> {
    if (!this.subscriber) {
      console.error("[Redis] Subscriber not initialized");
      return;
    }

    try {
      // Add handler to map
      if (!this.eventHandlers.has(channel)) {
        this.eventHandlers.set(channel, new Set());
        // Subscribe to channel if first handler
        await this.subscriber.subscribe(channel);
        console.log(`[Redis] Subscribed to channel: ${channel}`);
      }

      this.eventHandlers.get(channel)!.add(handler);
    } catch (error) {
      console.error(`[Redis] Failed to subscribe to ${channel}:`, error);
      throw error;
    }
  }

  /**
   * Unsubscribe from a channel
   */
  async unsubscribe(channel: string, handler?: (data: any) => void): Promise<void> {
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
          console.log(`[Redis] Unsubscribed from channel: ${channel}`);
        }
      } else {
        // Remove all handlers for channel
        this.eventHandlers.delete(channel);
        await this.subscriber.unsubscribe(channel);
        console.log(`[Redis] Unsubscribed from channel: ${channel}`);
      }
    } catch (error) {
      console.error(`[Redis] Failed to unsubscribe from ${channel}:`, error);
    }
  }

  /**
   * Handle incoming message from Redis
   */
  private handleMessage(channel: string, message: string): void {
    try {
      const data = JSON.parse(message);
      const handlers = this.eventHandlers.get(channel);

      if (handlers) {
        handlers.forEach((handler) => {
          try {
            handler(data);
          } catch (error) {
            console.error(`[Redis] Error in handler for ${channel}:`, error);
          }
        });
      }
    } catch (error) {
      console.error(`[Redis] Failed to parse message from ${channel}:`, error);
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
    console.log("[Redis] Shutting down...");

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
      console.log("[Redis] Shutdown complete");
    } catch (error) {
      console.error("[Redis] Error during shutdown:", error);
    }
  }
}

// Export singleton instance
export const redisService = new RedisService();
