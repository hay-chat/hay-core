import { registerCollector } from "@server/lib/metrics";
import { CHANNEL_DELIVERY_QUEUES } from "./channel-delivery-queue.service";
import { ORCHESTRATOR_QUEUES } from "./orchestrator-queue.service";
import { registerAuditSinkMetrics } from "./audit-sink.service";
import { rabbitmqService } from "./rabbitmq.service";
import { redisService } from "./redis.service";
import { websocketService } from "./websocket.service";

const DEAD_LETTER_QUEUES = [ORCHESTRATOR_QUEUES.DEAD, CHANNEL_DELIVERY_QUEUES.DEAD];

/** Metrics read from live services each time they are scraped. */
export function registerRuntimeMetrics(): void {
  registerAuditSinkMetrics();
  registerCollector("hay_websocket_connections", "Open WebSocket connections.", () =>
    websocketService.getConnectionCount(),
  );
  registerCollector("hay_dependency_up", "1 when the dependency is connected.", () => [
    { labels: { dependency: "redis" }, value: Number(redisService.isConnected()) },
    { labels: { dependency: "rabbitmq" }, value: Number(rabbitmqService.isConnected()) },
  ]);
  registerCollector(
    "hay_dead_letter_queue_depth",
    "Messages waiting in a dead-letter queue.",
    async () => {
      const depths = await Promise.all(
        DEAD_LETTER_QUEUES.map(async (queue) => ({
          queue,
          depth: await rabbitmqService.queueDepth(queue),
        })),
      );
      return depths.flatMap(({ queue, depth }) =>
        depth === null ? [] : [{ labels: { queue }, value: depth }],
      );
    },
  );
}
