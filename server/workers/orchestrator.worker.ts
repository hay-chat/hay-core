import { Orchestrator } from "../orchestrator";
import { AppDataSource } from "../database/data-source";
import { debugLog } from "@server/lib/debug-logger";
import { rabbitmqService } from "@server/services/rabbitmq.service";
import {
  orchestratorQueueService,
  ORCHESTRATOR_QUEUES,
  type OrchestratorMessage,
} from "@server/services/orchestrator-queue.service";

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
      console.warn("Database not initialized, skipping orchestrator initialization");
      return;
    }

    try {
      this.orchestrator = new Orchestrator();
      this.initialized = true;
      debugLog("worker", "Orchestrator worker initialized successfully");
    } catch (error) {
      console.error("Failed to initialize orchestrator worker:", error);
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
      console.warn("[Worker] Orchestrator not initialized, skipping RabbitMQ consumer setup");
      return;
    }

    if (rabbitmqService.isConnected()) {
      await this.startConsuming();
    }

    // Re-attach consumer on reconnect
    rabbitmqService.on("connected", async () => {
      debugLog("worker", "RabbitMQ reconnected, re-attaching consumer");
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

        debugLog("worker", `Processing conversation from queue`, {
          conversationId: data.conversationId,
          trigger: data.trigger,
          attempt: data.attempt,
        });

        try {
          await this.orchestrator!.processConversation(data.conversationId);
          rabbitmqService.ack(msg);
          debugLog("worker", `Successfully processed conversation ${data.conversationId}`);
        } catch (error) {
          console.error(`[Worker] Failed to process conversation ${data.conversationId}:`, error);
          // Nack without requeue — message goes to retry queue via dead-letter
          rabbitmqService.nack(msg, false);
        }
      },
      { prefetch: 2 },
    );

    console.log("[Worker] RabbitMQ consumer started for orchestrator.process");
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
      console.error("Orchestrator tick error:", error);
    }
  }

  /**
   * Stop the orchestrator worker.
   * Consumer cancellation is handled by rabbitmqService.shutdown().
   */
  stop(): void {
    this.consuming = false;
    debugLog("worker", "Orchestrator worker stopped");
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
      console.error("[Worker] Inactivity check error:", error);
    }
  }
}

// Export singleton instance
export const orchestratorWorker = new OrchestratorWorker();
