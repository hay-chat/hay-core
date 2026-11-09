/**
 * With no OTLP endpoint configured, tracing costs nothing: no OpenTelemetry
 * package is loaded and every helper runs the wrapped function directly.
 */
const mockSdkLoaded = jest.fn();
for (const name of [
  "@opentelemetry/api",
  "@opentelemetry/sdk-trace-base",
  "@opentelemetry/exporter-trace-otlp-http",
  "@opentelemetry/resources",
  "@opentelemetry/context-async-hooks",
  "@opentelemetry/core",
]) {
  jest.mock(name, () => {
    mockSdkLoaded(name);
    return {};
  });
}

import {
  extractTraceContext,
  initTracing,
  injectTraceHeaders,
  isTracingEnabled,
  startDetachedSpan,
  withSpan,
} from "@server/lib/tracing";

describe("tracing disabled", () => {
  it("runs the wrapped function and loads no OpenTelemetry SDK", async () => {
    await initTracing();

    expect(isTracingEnabled()).toBe(false);
    expect(await withSpan("x", { "hay.layer": "a" }, async () => 42)).toBe(42);
    expect(() =>
      withSpan("x", {}, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(injectTraceHeaders()).toBeUndefined();
    expect(extractTraceContext({ traceparent: "00-a-b-01" })).toBeUndefined();
    expect(startDetachedSpan("x", {})).toBeNull();
    expect(mockSdkLoaded).not.toHaveBeenCalled();
  });
});
