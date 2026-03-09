import { v4 as uuidv4 } from "uuid";
import { rabbitmqService } from "./rabbitmq.service";
import { debugLog } from "@server/lib/debug-logger";

/**
 * Queue names for orchestrator processing
 */
export const ORCHESTRATOR_QUEUES = {
  PROCESS: "orchestrator.process",
  RETRY: "orchestrator.process.retry",
  DEAD: "orchestrator.process.dead",
} as const;

export type OrchestratorTrigger =
  | "customer_message"
  | "ai_return"
  | "recovery"
  | "inactivity"
  | "creation"
  | "sweep";

export interface OrchestratorMessage {
  messageId: string;
  conversationId: string;
  organizationId: string;
  trigger: OrchestratorTrigger;
  timestamp: string;
  attempt: number;
}

/**
 * Orchestrator Queue Service
 * Thin wrapper for orchestrator queue operations.
 * Single place to change queue logic without touching entities or routes.
 */
class OrchestratorQueueService {
  /**
   * Declare all orchestrator queues. Called once at startup.
   */
  async declareQueues(): Promise<void> {
    if (!rabbitmqService.isConnected()) {
      debugLog("orchestrator-queue", "RabbitMQ not connected, skipping queue declaration");
      return;
    }

    // Dead-letter queue (no further routing)
    await rabbitmqService.assertQueue(ORCHESTRATOR_QUEUES.DEAD, {
      durable: true,
    });

    // Retry queue — messages here get dead-lettered back to the main queue after TTL
    await rabbitmqService.assertQueue(ORCHESTRATOR_QUEUES.RETRY, {
      durable: true,
      deadLetterExchange: "",
      deadLetterRoutingKey: ORCHESTRATOR_QUEUES.PROCESS,
      messageTtl: 10000, // 10s retry delay
    });

    // Main processing queue — failed messages go to retry queue
    await rabbitmqService.assertQueue(ORCHESTRATOR_QUEUES.PROCESS, {
      durable: true,
      deadLetterExchange: "",
      deadLetterRoutingKey: ORCHESTRATOR_QUEUES.RETRY,
    });

    debugLog("orchestrator-queue", "All orchestrator queues declared");
  }

  /**
   * Enqueue a conversation for processing.
   * If RabbitMQ is unavailable, logs a warning — the sweep job will catch it.
   */
  async enqueue(
    conversationId: string,
    organizationId: string,
    trigger: OrchestratorTrigger,
  ): Promise<boolean> {
    if (!rabbitmqService.isConnected()) {
      debugLog(
        "orchestrator-queue",
        `RabbitMQ unavailable, skipping enqueue (sweep will catch it)`,
        { conversationId, trigger },
      );
      return false;
    }

    const message: OrchestratorMessage = {
      messageId: uuidv4(),
      conversationId,
      organizationId,
      trigger,
      timestamp: new Date().toISOString(),
      attempt: 1,
    };

    const sent = await rabbitmqService.publish(ORCHESTRATOR_QUEUES.PROCESS, message);

    debugLog("orchestrator-queue", `Enqueued conversation for processing`, {
      conversationId,
      trigger,
      sent,
    });

    return sent;
  }
}

export const orchestratorQueueService = new OrchestratorQueueService();
