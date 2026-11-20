import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { redisService } from "../../services/redis.service";

type PublisherStub = {
  status: string;
  publish: jest.Mock<(channel: string, message: string) => Promise<number>>;
};

function usePublisher(publisher: PublisherStub): void {
  Object.assign(redisService, { publisher, isInitialized: true });
}

describe("redisService.publish", () => {
  afterEach(() => {
    Object.assign(redisService, { publisher: null, isInitialized: false });
  });

  it("returns without waiting while Redis is reconnecting", async () => {
    const publisher: PublisherStub = {
      status: "reconnecting",
      publish: jest.fn(() => new Promise<number>(() => undefined)),
    };
    usePublisher(publisher);

    await expect(redisService.publish("websocket:events", { type: "x" })).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("does not wait on a publish that hangs after the connection is lost", async () => {
    usePublisher({
      status: "ready",
      publish: jest.fn(() => new Promise<number>(() => undefined)),
    });

    await expect(redisService.publish("websocket:events", { type: "x" })).resolves.toBeUndefined();
  });

  it("publishes when Redis is connected", async () => {
    const publisher: PublisherStub = {
      status: "ready",
      publish: jest.fn(() => Promise.resolve(1)),
    };
    usePublisher(publisher);

    await redisService.publish("websocket:events", { type: "x" });
    expect(publisher.publish).toHaveBeenCalledWith(
      "websocket:events",
      JSON.stringify({ type: "x" }),
    );
  });
});
