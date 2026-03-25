import { Orchestrator } from "../orchestrator";
import { AppDataSource } from "../database/data-source";
import { createLogger } from "@server/lib/logger";
import { rabbitmqService } from "@server/services/rabbitmq.service";
import {
  orchestratorQueueService,
  ORCHESTRATOR_QUEUES,
  MAX_RETRY_ATTEMPTS,
  type OrchestratorMessage,
} from "@server/services/orchestrator-queue.service";

const logger = createLogger("orchestrator-worker");

function isNonRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  return (
    error.message.includes("Conversation does not need processing") ||
    error.message.includes("Last customer message not found")
  );
}

export class OrchestratorWorker {
  private orchestrator?: Orchestrator;
  private initialized = false;
  private consuming = false;

  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Only initialize if database is connected
    if (!AppDataSource.isInitialized) {
      logger.warn("Database not initialized, skipping orchestrator initialization");
      return;
    }

    try {
      this.orchestrator = new Orchestrator();
      this.initialized = true;
      logger.info("Orchestrator worker initialized successfully");
    } catch (error) {
      logger.error({ err: error }, "Failed to initialize orchestrator worker");
      this.initialized = false;
    }
  }

  /**
   * Start the orchestrator worker.
   * Subscribes to the RabbitMQ queue for event-driven processing.
   * Falls back to the sweep job if RabbitMQ is unavailable.
   */
  async start(): Promise<void> {
    await this.initialize();

    if (!this.initialized || !this.orchestrator) {
      logger.warn("Orchestrator not initialized, skipping RabbitMQ consumer setup");
      return;
    }

    if (rabbitmqService.isConnected()) {
      await this.startConsuming();
    }

    // Re-attach consumer on reconnect
    rabbitmqService.on("connected", async () => {
      logger.info("RabbitMQ reconnected, re-attaching consumer");
      await orchestratorQueueService.declareQueues();
      await this.startConsuming();
    });

    // Run inactivity check once at startup
    this.checkInactivity();
  }

  private async startConsuming(): Promise<void> {
    if (this.consuming) return;
    this.consuming = true;

    await rabbitmqService.consume(
      ORCHESTRATOR_QUEUES.PROCESS,
      async (msg) => {
        const data = rabbitmqService.parseMessage<OrchestratorMessage>(msg);

        logger.debug(
          {
            conversationId: data.conversationId,
            trigger: data.trigger,
            attempt: data.attempt,
          },
          "Processing conversation from queue",
        );

        try {
          await this.orchestrator!.processConversation(data.conversationId);
          rabbitmqService.ack(msg);
          logger.debug(
            { conversationId: data.conversationId },
            "Successfully processed conversation",
          );
        } catch (error) {
          const currentAttempt = data.attempt || 1;
          const errorMessage =
            error instanceof Error ? error.message : "Unknown orchestrator error";

          if (isNonRetryableError(error)) {
            logger.debug(
              {
                conversationId: data.conversationId,
                trigger: data.trigger,
                attempt: currentAttempt,
                error: errorMessage,
              },
              "Skipping retry for non-retryable orchestrator error",
            );
            rabbitmqService.ack(msg);
            return;
          }

          try {
            if (currentAttempt >= MAX_RETRY_ATTEMPTS) {
              await orchestratorQueueService.enqueueDead(data, errorMessage);
              rabbitmqService.ack(msg);
              logger.error(
                {
                  conversationId: data.conversationId,
                  trigger: data.trigger,
                  attempt: currentAttempt,
                  maxAttempts: MAX_RETRY_ATTEMPTS,
                  error: errorMessage,
                },
                "Max retry attempts reached, moved to dead queue",
              );
              return;
            }

            await orchestratorQueueService.enqueueRetry(data);
            rabbitmqService.ack(msg);
            logger.warn(
              {
                conversationId: data.conversationId,
                trigger: data.trigger,
                currentAttempt,
                nextAttempt: currentAttempt + 1,
                maxAttempts: MAX_RETRY_ATTEMPTS,
                error: errorMessage,
              },
              "Conversation processing failed, scheduled retry",
            );
          } catch (retryError) {
            logger.error(
              {
                err: retryError,
                conversationId: data.conversationId,
                trigger: data.trigger,
                attempt: currentAttempt,
              },
              "Failed to schedule retry/dead-letter, nacking message",
            );
            // Fallback: route via queue dead-letter configuration.
            rabbitmqService.nack(msg, false);
          }
        }
      },
      { prefetch: 2 },
    );

    logger.info("RabbitMQ consumer started for orchestrator.process");
  }

  /**
   * Legacy polling tick — kept as documented fallback.
   * Re-enable the 'orchestrator-worker-tick' scheduled job to use this.
   */
  async tick(): Promise<void> {
    try {
      await this.initialize();
      if (!this.initialized || !this.orchestrator) return;
      await this.orchestrator.loop();
    } catch (error) {
      logger.error({ err: error }, "Orchestrator tick error");
    }
  }

  /**
   * Stop the orchestrator worker.
   * Consumer cancellation is handled by rabbitmqService.shutdown().
   */
  stop(): void {
    this.consuming = false;
    logger.info("Orchestrator worker stopped");
  }

  /**
   * Check for inactive conversations.
   * Called by scheduled job: 'orchestrator-inactivity-check'
   */
  async checkInactivity(): Promise<void> {
    try {
      await this.initialize();

      if (!this.initialized || !this.orchestrator) {
        return;
      }

      await this.orchestrator.checkInactivity();
    } catch (error) {
      logger.error({ err: error }, "Inactivity check error");
    }
  }
}

// Export singleton instance
export const orchestratorWorker = new OrchestratorWorker();
