import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { EventEmitter } from "events";

const mockConnect = jest.fn<() => Promise<unknown>>();
jest.mock("amqplib", () => ({ __esModule: true, default: { connect: () => mockConnect() } }));

import { RabbitMQService } from "@server/services/rabbitmq.service";

function fakeConnection() {
  const channel = Object.assign(new EventEmitter(), {
    close: async () => undefined,
    cancel: async () => undefined,
  });
  return Object.assign(new EventEmitter(), {
    createChannel: async () => channel,
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
});
