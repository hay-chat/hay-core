/**
 * Outbound channel delivery against a real broker and database.
 *
 * Needs RABBITMQ_TEST_URL. The queue names are fixed, so point it at a
 * throwaway broker, never one a running server consumes from.
 */
import "reflect-metadata";
import { describe, it, expect, jest, beforeAll, afterAll, beforeEach } from "@jest/globals";

const brokerUrl = process.env.RABBITMQ_TEST_URL;
if (brokerUrl) process.env.RABBITMQ_URL = brokerUrl;

const mockRedis = {
  isConnected: jest.fn(() => false),
  publish: jest.fn(async () => undefined),
  subscribe: jest.fn(async () => undefined),
};
jest.mock("@server/services/redis.service", () => ({ redisService: mockRedis }));

jest.mock("@server/services/plugin-manager.service", () => ({
  pluginManagerService: {
    findPluginIdByChannel: async () => "plugin-under-test",
    getOrStartWorker: async () => ({ port: 4567 }),
    getChannelRendering: () => ({}),
  },
}));

jest.mock("@server/services/channel-health.service", () => ({
  channelHealthService: {
    recordDeliverySuccess: async () => undefined,
    recordDeliveryFailure: async () => undefined,
  },
}));

import { v4 as uuidv4 } from "uuid";
import { AppDataSource } from "@server/database/data-source";
import { RabbitMQService } from "@server/services/rabbitmq.service";
import { ChannelDeliveryService } from "@server/services/channel-delivery.service";
import { ChannelDeliveryQueueService } from "@server/services/channel-delivery-queue.service";
import { messageDeliveryRepository } from "@server/repositories/message-delivery.repository";
import { MessageType } from "@server/database/entities/message.entity";
import { DeliveryState } from "@server/types/message-feedback.types";

const describeWithBroker = brokerUrl ? describe : describe.skip;

const ORG_ID = uuidv4();
const CONVERSATION_ID = uuidv4();
const CUSTOMER_ID = uuidv4();
const conversation = { id: CONVERSATION_ID, organization_id: ORG_ID, channel: "whatsapp" };

const deliverCalls = jest.fn<(url: string) => void>();

const eventually = async (check: () => Promise<boolean> | boolean, ms = 10_000) => {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > ms) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

const statusOf = async (id: string): Promise<string | undefined> => {
  const [row] = await AppDataSource.query(`SELECT status FROM message_deliveries WHERE id = $1`, [
    id,
  ]);
  return row?.status;
};

const insertMessage = async (): Promise<string> => {
  const id = uuidv4();
  await AppDataSource.query(
    `INSERT INTO messages (id, conversation_id, content, type, delivery_state)
     VALUES ($1, $2, 'hello', $3, $4)`,
    [id, CONVERSATION_ID, MessageType.BOT_AGENT, DeliveryState.SENT],
  );
  return id;
};

const message = (id: string) =>
  ({ id, type: MessageType.BOT_AGENT, metadata: null, deliveryState: DeliveryState.SENT }) as never;

describeWithBroker("channel delivery queue", () => {
  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    await AppDataSource.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)`, [
      ORG_ID,
      "Delivery test",
      `delivery-${ORG_ID}`,
    ]);
    await AppDataSource.query(
      `INSERT INTO customers (id, organization_id, external_id) VALUES ($1, $2, '5511999999999')`,
      [CUSTOMER_ID, ORG_ID],
    );
    await AppDataSource.query(
      `INSERT INTO conversations (id, organization_id, customer_id, channel, title, status)
       VALUES ($1, $2, $3, 'whatsapp', 't', 'open')`,
      [CONVERSATION_ID, ORG_ID, CUSTOMER_ID],
    );
    global.fetch = (async (url: string) => {
      deliverCalls(url);
      return new Response(JSON.stringify({ success: true, providerMessageId: "wamid.1" }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
  });

  afterAll(async () => {
    await AppDataSource.query(`DELETE FROM organizations WHERE id = $1`, [ORG_ID]);
    await AppDataSource.destroy();
  });

  beforeEach(() => deliverCalls.mockClear());

  it("sends through exactly one of two consumers, even if the queue message is duplicated", async () => {
    const rabbitA = new RabbitMQService();
    const rabbitB = new RabbitMQService();
    await rabbitA.initialize();
    await rabbitB.initialize();
    const consumerA = new ChannelDeliveryService({ rabbit: rabbitA });
    const consumerB = new ChannelDeliveryService({ rabbit: rabbitB });
    await consumerA.initialize();
    await consumerB.initialize();

    try {
      const queue = new ChannelDeliveryQueueService(rabbitA);
      const id = await insertMessage();
      await queue.enqueueMessage(conversation as never, message(id));
      await queue.publish(id);
      await rabbitB.publish("channel.deliver", { messageId: id });

      await eventually(async () => (await statusOf(id)) === "delivered");
      await new Promise((resolve) => setTimeout(resolve, 500));

      const delivered = deliverCalls.mock.calls.filter(([url]) => url.endsWith("/deliver"));
      expect(delivered).toHaveLength(1);
    } finally {
      await rabbitA.shutdown();
      await rabbitB.shutdown();
    }
  });

  it("keeps the delivery while Redis and RabbitMQ are down and sends it after they return", async () => {
    mockRedis.isConnected.mockReturnValue(false);
    const rabbit = new RabbitMQService();
    const queue = new ChannelDeliveryQueueService(rabbit);
    const id = await insertMessage();

    await queue.enqueueMessage(conversation as never, message(id));

    expect(await statusOf(id)).toBe("pending");
    expect(deliverCalls).not.toHaveBeenCalled();

    await rabbit.initialize();
    const consumer = new ChannelDeliveryService({ rabbit, sweepGraceMs: 0 });
    await consumer.initialize();
    try {
      await consumer.sweep();
      await eventually(async () => (await statusOf(id)) === "delivered");
      expect(deliverCalls).toHaveBeenCalledTimes(1);
    } finally {
      await rabbit.shutdown();
    }
  });

  it("sends directly from the sweep while RabbitMQ stays down", async () => {
    const consumer = new ChannelDeliveryService({ rabbit: new RabbitMQService(), sweepGraceMs: 0 });
    const queue = new ChannelDeliveryQueueService(new RabbitMQService());
    const id = await insertMessage();
    await queue.enqueueMessage(conversation as never, message(id));

    await consumer.sweep();

    expect(await statusOf(id)).toBe("delivered");
    expect(deliverCalls).toHaveBeenCalledTimes(1);
  });

  it("claims a pending delivery exactly once under concurrency", async () => {
    const id = await insertMessage();
    await messageDeliveryRepository.insertMessage({
      messageId: id,
      organizationId: ORG_ID,
      conversationId: CONVERSATION_ID,
    });

    const claims = await Promise.all(
      Array.from({ length: 8 }, () => messageDeliveryRepository.claim(id)),
    );

    expect(claims.filter(Boolean)).toHaveLength(1);
    await messageDeliveryRepository.markDelivered(id);
  });
});
