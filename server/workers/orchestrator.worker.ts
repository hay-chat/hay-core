import { Orchestrator } from "../orchestrator";
import { AppDataSource } from "../database/data-source";
import { createLogger, withLogContext } from "@server/lib/logger";
import { metrics } from "@server/lib/metrics";
import { rabbitmqService } from "@server/services/rabbitmq.service";
import { ConversationRepository } from "@server/repositories/conversation.repository";
import { simulationHarnessService } from "@server/services/simulation/simulation-harness.service";
import {
  orchestratorQueueService,
  ORCHESTRATOR_QUEUES,
  MAX_RETRY_ATTEMPTS,
  type OrchestratorDeadLetterMessage,
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
      // A broker that came up after boot has not had its queues declared yet.
      await orchestratorQueueService.declareQueues();
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

        // Info level on purpose: queue wait is part of the customer's wait.
        logger.info(
          {
            conversationId: data.conversationId,
            trigger: data.trigger,
            attempt: data.attempt,
            queueWaitMs: Date.now() - Date.parse(data.timestamp),
          },
          "Processing conversation from queue",
        );

        try {
          // Every log line of this run carries the conversation id.
          await withLogContext({ conversationId: data.conversationId }, async () => {
            if (data.trigger === "approval_decided") {
              await this.orchestrator!.processApprovalDecision(data.conversationId);
            } else if (data.trigger === "simulation") {
              // Never throws: a failed simulation fails its item, without retries.
              await simulationHarnessService.runItem(data.conversationId, (id) =>
                this.orchestrator!.processConversation(id),
              );
            } else {
              await this.orchestrator!.processConversation(data.conversationId);
            }
          });
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

    await rabbitmqService.consume(
      ORCHESTRATOR_QUEUES.DEAD,
      async (msg) => {
        await this.handleDeadLetter(
          rabbitmqService.parseMessage<OrchestratorDeadLetterMessage>(msg),
        );
        rabbitmqService.ack(msg);
      },
      { prefetch: 1 },
    );

    logger.info("RabbitMQ consumers started for orchestrator.process");
  }

  /**
   * A conversation that used up its queue retries is flagged as stuck, so the
   * stale-message check recovers it or hands it to a person.
   */
  private async handleDeadLetter(data: OrchestratorDeadLetterMessage): Promise<void> {
    metrics.deadLetters.inc({ queue: ORCHESTRATOR_QUEUES.DEAD });
    logger.error(
      { conversationId: data.conversationId, trigger: data.trigger, error: data.error },
      "Conversation dead-lettered",
    );
    await new ConversationRepository().updateById(data.conversationId, {
      is_stuck: true,
      stuck_detected_at: new Date(),
      stuck_reason: "orchestrator_dead_letter",
    });
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
   * Process conversations in this process, for the sweep to use while RabbitMQ
   * is unavailable. One at a time, so a backlog cannot overload the server.
   */
  async processDirectly(conversationIds: string[]): Promise<void> {
    await this.initialize();
    if (!this.initialized || !this.orchestrator) return;

    for (const conversationId of conversationIds) {
      try {
        await withLogContext({ conversationId }, () =>
          this.orchestrator!.processConversation(conversationId),
        );
      } catch (error) {
        logger.error({ err: error, conversationId }, "Direct conversation processing failed");
      }
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
