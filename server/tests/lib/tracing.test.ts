/**
 * Tracing is off unless an endpoint is configured, and what it exports never
 * carries message text, emails or credentials.
 */
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  extractTraceContext,
  initTracing,
  injectTraceHeaders,
  sanitizeAttributes,
  shutdownTracing,
  startDetachedSpan,
  withSpan,
} from "@server/lib/tracing";

describe("tracing enabled", () => {
  const exporter = new InMemorySpanExporter();

  beforeAll(async () => {
    await initTracing({
      spanExporter: exporter,
      endpoint: "http://collector.invalid:4318",
      sampleRatio: 1,
    });
  });

  afterAll(async () => {
    await shutdownTracing();
  });

  beforeEach(() => exporter.reset());

  it("carries one trace from a publisher to a consumer through message headers", async () => {
    let headers: Record<string, string> | undefined;
    await withSpan("queue publish", {}, () => {
      headers = injectTraceHeaders();
    });
    expect(headers?.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);

    await withSpan("queue consume", {}, () => undefined, {
      parent: extractTraceContext(headers),
    });

    const [publish, consume] = exporter.getFinishedSpans();
    expect(consume.spanContext().traceId).toBe(publish.spanContext().traceId);
    expect(consume.parentSpanContext?.spanId).toBe(publish.spanContext().spanId);
  });

  it("nests spans started inside an async span", async () => {
    await withSpan("outer", {}, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      await withSpan("inner", {}, async () => undefined);
    });
    const spans = exporter.getFinishedSpans();
    const inner = spans.find((s) => s.name === "inner")!;
    const outer = spans.find((s) => s.name === "outer")!;
    expect(inner.parentSpanContext?.spanId).toBe(outer.spanContext().spanId);
  });

  it("never exports message text, emails or tokens", async () => {
    const text = "my order is late please call me";
    const email = "jane.doe@example.com";
    const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl";
    const apiKey = "sk-live-abcdef1234567890";

    await expect(
      withSpan(
        "probe",
        {
          "hay.tool": email,
          "hay.plugin_id": token,
          "llm.model": apiKey,
          "hay.trigger": `Bearer ${apiKey}`,
          "hay.layer": "x".repeat(500),
          // Not on the allowlist: dropped whatever the value.
          messageText: text,
          content: text,
          email,
          authorization: token,
          "http.route": "/v1/ok",
        },
        async (span) => {
          span.setAttributes({ "rpc.code": email, "hay.attempt": 2 });
          throw new Error(`failed for ${email} with ${token}: ${text}`);
        },
      ),
    ).rejects.toThrow();

    const detached = startDetachedSpan("HTTP request", { "http.method": "POST" }, { root: true });
    detached?.end({ "http.route": email, "http.status_code": 500 }, true);

    const exported = JSON.stringify(
      exporter.getFinishedSpans().map((s) => ({
        name: s.name,
        attributes: s.attributes,
        events: s.events,
        status: s.status,
      })),
    );
    for (const secret of [text, email, token, apiKey, "jane.doe"]) {
      expect(exported).not.toContain(secret);
    }
    expect(exported).toContain("/v1/ok");
    expect(exported).toContain('"error.type":"Error"');
  });

  it("keeps only allowlisted, short, clean values", () => {
    expect(sanitizeAttributes({ "hay.tool": "get_order", "hay.attempt": 1, nope: "x" })).toEqual({
      "hay.tool": "get_order",
      "hay.attempt": 1,
    });
  });
});
