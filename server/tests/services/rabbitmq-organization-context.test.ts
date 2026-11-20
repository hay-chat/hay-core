/**
 * Queue handlers run in a system context named after their queue, so they can
 * declare an organization themselves once the message is parsed.
 */
import { EventEmitter } from "events";

const mockConnect = jest.fn<Promise<unknown>, []>();
jest.mock("amqplib", () => ({ __esModule: true, default: { connect: () => mockConnect() } }));

import { RabbitMQService } from "@server/services/rabbitmq.service";
import { getDatabaseContext, runInOrganization } from "@server/database/organization-context";

function fakeChannel() {
  return Object.assign(new EventEmitter(), {
    close: async () => undefined,
    prefetch: async () => undefined,
    consume: jest.fn(async () => ({ consumerTag: "tag" })),
    nack: jest.fn(),
  });
}

describe("RabbitMQ consumer database context", () => {
  const service = new RabbitMQService();
  const consumerChannel = fakeChannel();

  beforeAll(async () => {
    mockConnect.mockResolvedValue(
      Object.assign(new EventEmitter(), {
        createConfirmChannel: async () => fakeChannel(),
        createChannel: async () => consumerChannel,
        close: async () => undefined,
      }),
    );
    await service.initialize();
  });

  afterAll(async () => {
    await service.shutdown();
  });

  async function deliver(queue: string, handler: () => Promise<void>): Promise<void> {
    consumerChannel.consume.mockClear();
    await service.consume(queue, handler);
    const call = consumerChannel.consume.mock.calls[0] as unknown as [
      string,
      (msg: unknown) => Promise<void>,
    ];
    await call[1]({
      fields: { routingKey: queue },
      properties: { timestamp: Date.now() },
      content: Buffer.from("{}"),
    });
  }

  it("handles a message under a system context naming the queue", async () => {
    let seen: ReturnType<typeof getDatabaseContext>;
    let nested: ReturnType<typeof getDatabaseContext>;
    await deliver("ctx.queue", async () => {
      seen = getDatabaseContext();
      runInOrganization("11111111-1111-4111-8111-111111111111", () => {
        nested = getDatabaseContext();
      });
    });

    expect(seen).toEqual({ kind: "system", reason: "queue consumer: ctx.queue" });
    expect(nested?.kind).toBe("organization");
    expect(getDatabaseContext()).toBeUndefined();
  });

  it("still nacks without requeue when the handler throws", async () => {
    const nack = jest.spyOn(service, "nack").mockImplementation(() => undefined);
    await deliver("ctx.failing", async () => {
      throw new Error("boom");
    });

    expect(nack).toHaveBeenCalledWith(expect.anything(), false);
    nack.mockRestore();
  });
});
