import type { Context, Span, Tracer } from "@opentelemetry/api";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { config } from "@server/config/env";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("tracing");

/**
 * Distributed tracing, exported over OTLP/HTTP to a collector.
 *
 * Off unless OTEL_EXPORTER_OTLP_ENDPOINT is set. While off, no OpenTelemetry
 * package is loaded: every helper here returns after one null check and runs
 * the wrapped function directly. Spans are created by hand at chosen
 * boundaries (HTTP, tRPC, queue, orchestrator layers, LLM, plugin calls); no
 * module is monkey-patched, so child processes such as plugin workers are
 * untouched.
 *
 * Span data is limited on purpose. Attribute keys come from ALLOWED_ATTRIBUTES,
 * string values are cut short and checked for emails and credentials, and
 * errors record the class name only, never the message.
 */
type Api = typeof import("@opentelemetry/api");
type AttributeValue = string | number | boolean;
export type SpanAttributes = Record<string, AttributeValue | undefined>;

const ALLOWED_ATTRIBUTES = new Set([
  "http.method",
  "http.route",
  "http.status_code",
  "rpc.procedure",
  "rpc.type",
  "rpc.code",
  "messaging.system",
  "messaging.destination",
  "messaging.operation",
  "hay.trigger",
  "hay.attempt",
  "hay.layer",
  "hay.organization_id",
  "hay.conversation_id",
  "hay.plugin_id",
  "hay.tool",
  "hay.tool_error",
  "llm.provider",
  "llm.model",
  "llm.operation",
]);

const MAX_VALUE_LENGTH = 128;
const REDACTED = "[redacted]";
const SENSITIVE_VALUE =
  /[^\s@]+@[^\s@]+\.[^\s@]+|\beyJ[\w-]{8,}\.[\w-]{8,}|\b(?:sk|pk|rk|xox[a-z]|ghp|gho)[-_][\w-]{8,}|\bBearer\s+\S+|\b[A-Fa-f0-9]{32,}\b/;

let api: Api | null = null;
let tracer: Tracer | null = null;
let shutdownProvider: (() => Promise<void>) | null = null;

export function isTracingEnabled(): boolean {
  return tracer !== null;
}

/** Attributes that may be exported: allowlisted keys, bounded values, no credentials or emails. */
export function sanitizeAttributes(attributes: SpanAttributes): Record<string, AttributeValue> {
  const clean: Record<string, AttributeValue> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || !ALLOWED_ATTRIBUTES.has(key)) continue;
    if (typeof value !== "string") {
      clean[key] = value;
    } else {
      clean[key] =
        SENSITIVE_VALUE.test(value) || value.length > MAX_VALUE_LENGTH ? REDACTED : value;
    }
  }
  return clean;
}

/**
 * Start the exporter when an endpoint is configured. Failing to start tracing
 * never stops the application.
 */
export async function initTracing(
  options: { spanExporter?: SpanExporter; endpoint?: string; sampleRatio?: number } = {},
): Promise<void> {
  const { serviceName } = config.otel;
  const endpoint = options.endpoint ?? config.otel.endpoint;
  const sampleRatio = options.sampleRatio ?? config.otel.sampleRatio;
  if (tracer || !endpoint) return;

  try {
    const [otelApi, base, exporter, resources, contextHooks, core] = await Promise.all([
      import("@opentelemetry/api"),
      import("@opentelemetry/sdk-trace-base"),
      import("@opentelemetry/exporter-trace-otlp-http"),
      import("@opentelemetry/resources"),
      import("@opentelemetry/context-async-hooks"),
      import("@opentelemetry/core"),
    ]);

    const provider = new base.BasicTracerProvider({
      resource: resources.resourceFromAttributes({ "service.name": serviceName }),
      sampler: new base.ParentBasedSampler({
        root: new base.TraceIdRatioBasedSampler(sampleRatio),
      }),
      spanProcessors: [
        options.spanExporter
          ? new base.SimpleSpanProcessor(options.spanExporter)
          : new base.BatchSpanProcessor(
              new exporter.OTLPTraceExporter({
                url: `${endpoint.replace(/\/+$/, "")}/v1/traces`,
              }),
              { maxQueueSize: 512, maxExportBatchSize: 128, scheduledDelayMillis: 5000 },
            ),
      ],
    });
    otelApi.context.setGlobalContextManager(
      new contextHooks.AsyncLocalStorageContextManager().enable(),
    );

    otelApi.propagation.setGlobalPropagator(new core.W3CTraceContextPropagator());

    api = otelApi;
    tracer = provider.getTracer("hay-server");
    shutdownProvider = () => provider.shutdown();
    logger.info({ sampleRatio }, "Tracing enabled");
  } catch (error) {
    api = null;
    tracer = null;
    logger.error({ err: error }, "Could not start tracing, continuing without it");
  }
}

export async function shutdownTracing(): Promise<void> {
  const stop = shutdownProvider;
  shutdownProvider = null;
  api?.context.disable();
  api?.propagation.disable();
  api = null;
  tracer = null;
  await stop?.().catch((err) => logger.warn({ err }, "Tracing shutdown failed"));
}

type SpanOptions = { parent?: Context; root?: boolean };

/** Run fn inside a span; the span ends when fn settles. Errors record their class name only. */
export function withSpan<T>(
  name: string,
  attributes: SpanAttributes,
  fn: (span: SpanHandle) => Promise<T> | T,
  options: SpanOptions = {},
): Promise<T> | T {
  if (!api || !tracer) return fn(NOOP_SPAN);
  const otel = api;
  const parent = options.root ? otel.ROOT_CONTEXT : (options.parent ?? otel.context.active());
  const span = tracer.startSpan(name, { attributes: sanitizeAttributes(attributes) }, parent);
  const handle = new SpanHandle(span);
  const finish = (error?: unknown) => {
    if (error !== undefined) {
      const kind = error instanceof Error ? error.name : "Error";
      span.setStatus({ code: otel.SpanStatusCode.ERROR });
      span.setAttribute("error.type", kind);
    }
    span.end();
  };
  return otel.context.with(otel.trace.setSpan(parent, span), () => {
    try {
      const result = fn(handle);
      if (result instanceof Promise) {
        return result.then(
          (value) => (finish(), value),
          (error) => {
            finish(error ?? "error");
            throw error;
          },
        ) as Promise<T>;
      }
      finish();
      return result;
    } catch (error) {
      finish(error ?? "error");
      throw error;
    }
  });
}

/**
 * A span that outlives the call that starts it, such as an HTTP request that
 * ends when the response is sent. Returns null while tracing is off.
 */
export function startDetachedSpan(
  name: string,
  attributes: SpanAttributes,
  options: SpanOptions = {},
): {
  run: <T>(fn: () => T) => T;
  end: (attributes?: SpanAttributes, failed?: boolean) => void;
} | null {
  if (!api || !tracer) return null;
  const otel = api;
  const parent = options.root ? otel.ROOT_CONTEXT : (options.parent ?? otel.context.active());
  const span = tracer.startSpan(name, { attributes: sanitizeAttributes(attributes) }, parent);
  return {
    run: (fn) => otel.context.with(otel.trace.setSpan(parent, span), fn),
    end: (endAttributes = {}, failed = false) => {
      span.setAttributes(sanitizeAttributes(endAttributes));
      if (failed) span.setStatus({ code: otel.SpanStatusCode.ERROR });
      span.end();
    },
  };
}

export class SpanHandle {
  constructor(private readonly span: Span | null) {}

  setAttributes(attributes: SpanAttributes): void {
    this.span?.setAttributes(sanitizeAttributes(attributes));
  }
}

const NOOP_SPAN = new SpanHandle(null);

type Carrier = Record<string, unknown>;

/** Headers carrying the active trace context, to attach to an outgoing message. */
export function injectTraceHeaders(): Record<string, string> | undefined {
  if (!api) return undefined;
  const carrier: Record<string, string> = {};
  api.propagation.inject(api.context.active(), carrier);
  return Object.keys(carrier).length ? carrier : undefined;
}

/** The trace context carried by a consumed message's headers. */
export function extractTraceContext(headers: Carrier | undefined): Context | undefined {
  if (!api || !headers) return undefined;
  const carrier: Record<string, string> = {};
  for (const key of ["traceparent", "tracestate"]) {
    if (typeof headers[key] === "string") carrier[key] = headers[key];
  }
  return api.propagation.extract(api.context.active(), carrier);
}
