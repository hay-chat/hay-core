/**
 * Trace context rides in the RabbitMQ message headers: the consumer's span
 * joins the trace of the publisher that sent the message.
 */
import { EventEmitter } from "events";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";

const mockConnect = jest.fn<Promise<unknown>, []>();
jest.mock("amqplib", () => ({ __esModule: true, default: { connect: () => mockConnect() } }));

import { RabbitMQService } from "@server/services/rabbitmq.service";
import { initTracing, shutdownTracing, withSpan } from "@server/lib/tracing";

function fakeChannel() {
  return Object.assign(new EventEmitter(), {
    close: async () => undefined,
    prefetch: async () => undefined,
    consume: jest.fn(async () => ({ consumerTag: "tag" })),
    sendToQueue: jest.fn(
      (_queue: string, _content: Buffer, _options: unknown, confirm: (err?: Error) => void) =>
        confirm(),
    ),
  });
}

describe("RabbitMQ trace propagation", () => {
  const exporter = new InMemorySpanExporter();
  const service = new RabbitMQService();
  const publishChannel = fakeChannel();
  const consumerChannel = fakeChannel();

  beforeAll(async () => {
    await initTracing({
      spanExporter: exporter,
      endpoint: "http://collector.invalid:4318",
      sampleRatio: 1,
    });
    mockConnect.mockResolvedValue(
      Object.assign(new EventEmitter(), {
        createConfirmChannel: async () => publishChannel,
        createChannel: async () => consumerChannel,
        close: async () => undefined,
      }),
    );
    await service.initialize();
  });

  afterAll(async () => {
    await service.shutdown();
    await shutdownTracing();
  });

  it("publishes the active trace context and continues it on the consumer side", async () => {
    await service.publish("q", { messageId: "m1" });
    const options = publishChannel.sendToQueue.mock.calls[0][2] as {
      headers?: Record<string, string>;
    };
    expect(options.headers?.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);

    await service.consume("q", async () => undefined);
    const deliver = consumerChannel.consume.mock.calls[0] as unknown as [
      string,
      (msg: unknown) => Promise<void>,
    ];
    await deliver[1]({
      fields: { routingKey: "q" },
      properties: { headers: options.headers, timestamp: Date.now() },
      content: Buffer.from("{}"),
    });

    const spans = exporter.getFinishedSpans();
    const publish = spans.find((s) => s.name === "queue publish")!;
    const consume = spans.find((s) => s.name === "queue consume")!;
    expect(consume.spanContext().traceId).toBe(publish.spanContext().traceId);
    expect(consume.parentSpanContext?.spanId).toBe(publish.spanContext().spanId);
  });

  it("keeps a publisher's own span as the parent of the publish span", async () => {
    exporter.reset();
    await withSpan("outer", {}, () => service.publish("q", { messageId: "m2" }));
    const spans = exporter.getFinishedSpans();
    const outer = spans.find((s) => s.name === "outer")!;
    const publish = spans.find((s) => s.name === "queue publish")!;
    expect(publish.parentSpanContext?.spanId).toBe(outer.spanContext().spanId);
  });
});
