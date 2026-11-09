import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { EventEmitter } from "events";

const mockConnect = jest.fn<() => Promise<unknown>>();
jest.mock("amqplib", () => ({ __esModule: true, default: { connect: () => mockConnect() } }));

import { RabbitMQService } from "@server/services/rabbitmq.service";

function fakeChannel(name: string) {
  return Object.assign(new EventEmitter(), {
    name,
    close: async () => undefined,
    cancel: async () => undefined,
    prefetch: jest.fn(async (_count: number) => undefined),
    ack: jest.fn(),
    nack: jest.fn(),
    assertQueue: jest.fn(async (_queue: string, _options: unknown) => undefined),
    consume: jest.fn(async (_queue: string, _handler: unknown) => ({ consumerTag: `tag-${name}` })),
    sendToQueue: jest.fn(
      (_queue: string, _content: Buffer, _options: unknown, confirm: (err?: Error) => void) =>
        confirm(),
    ),
  });
}

function fakeConnection() {
  const publishChannels: Array<ReturnType<typeof fakeChannel>> = [];
  const consumerChannels: Array<ReturnType<typeof fakeChannel>> = [];
  return Object.assign(new EventEmitter(), {
    publishChannels,
    consumerChannels,
    createConfirmChannel: async () => {
      const channel = fakeChannel(`publish-${publishChannels.length}`);
      publishChannels.push(channel);
      return channel;
    },
    createChannel: async () => {
      const channel = fakeChannel(`consumer-${consumerChannels.length}`);
      consumerChannels.push(channel);
      return channel;
    },
    close: async () => undefined,
  });
}

describe("RabbitMQService connection recovery", () => {
  let service: RabbitMQService;

  beforeEach(() => {
    jest.useFakeTimers();
    mockConnect.mockReset();
    service = new RabbitMQService();
  });

  afterEach(async () => {
    await service.shutdown();
    jest.useRealTimers();
  });

  it("keeps retrying after the broker was down at startup and then connects", async () => {
    mockConnect.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    mockConnect.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    mockConnect.mockResolvedValue(fakeConnection());
    const connected = jest.fn();
    service.on("connected", connected);

    await expect(service.initialize()).rejects.toThrow("ECONNREFUSED");
    expect(service.isConnected()).toBe(false);

    await jest.advanceTimersByTimeAsync(1000);
    expect(service.isConnected()).toBe(false);

    await jest.advanceTimersByTimeAsync(2000);
    expect(service.isConnected()).toBe(true);
    expect(connected).toHaveBeenCalledTimes(1);
  });

  it("stops retrying once shut down", async () => {
    mockConnect.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(service.initialize()).rejects.toThrow("ECONNREFUSED");
    await service.shutdown();
    await jest.advanceTimersByTimeAsync(5000);

    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it("resolves publish only after the broker confirms, false when it rejects", async () => {
    const connection = fakeConnection();
    mockConnect.mockResolvedValue(connection);
    await service.initialize();
    const [channel] = connection.publishChannels;

    await expect(service.publish("q", { messageId: "a" })).resolves.toBe(true);

    channel.sendToQueue.mockImplementationOnce((_q, _c, _o, confirm) =>
      confirm(new Error("nacked")),
    );
    await expect(service.publish("q", { messageId: "b" })).resolves.toBe(false);
  });

  it("gives each consumer its own channel and prefetch, and acks on that channel", async () => {
    const connection = fakeConnection();
    mockConnect.mockResolvedValue(connection);
    await service.initialize();

    await service.consume("a", async () => undefined, { prefetch: 2 });
    await service.consume("b", async () => undefined, { prefetch: 10 });

    const [a, b] = connection.consumerChannels;
    expect(a.prefetch).toHaveBeenCalledWith(2);
    expect(b.prefetch).toHaveBeenCalledWith(10);

    const msg = { fields: {}, content: Buffer.from("{}") } as never;
    const deliver = b.consume.mock.calls[0][1] as (m: unknown) => Promise<void>;
    await deliver(msg);
    service.ack(msg);
    expect(b.ack).toHaveBeenCalledTimes(1);
    expect(a.ack).not.toHaveBeenCalled();
  });

  it("keeps publishing and reattaches when one consumer channel closes", async () => {
    const connection = fakeConnection();
    mockConnect.mockResolvedValue(connection);
    await service.initialize();
    await service.consume("a", async () => undefined);

    connection.consumerChannels[0].emit("close");
    await jest.advanceTimersByTimeAsync(1000);

    expect(service.isConnected()).toBe(true);
    expect(connection.consumerChannels).toHaveLength(2);
  });

  it("re-declares a queue with its original arguments after a reconnect", async () => {
    const first = fakeConnection();
    const second = fakeConnection();
    mockConnect.mockResolvedValueOnce(first).mockResolvedValue(second);
    await service.initialize();
    const options = { deadLetterExchange: "", messageTtl: 5000 };
    await service.assertQueue("retry", options);

    first.emit("close");
    await jest.advanceTimersByTimeAsync(1000);

    expect(second.publishChannels[0].assertQueue).toHaveBeenCalledWith(
      "retry",
      expect.objectContaining(options),
    );
  });
});
