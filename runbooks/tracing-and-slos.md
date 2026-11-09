# Tracing and SLOs

Traces go to a collector you run; SLOs and alerts are built on the existing
`/metrics` endpoint (Prometheus text format, port `METRICS_PORT`).

## Tracing

Off by default. With no `OTEL_EXPORTER_OTLP_ENDPOINT` the server loads no tracing
code and pays no startup or memory cost.

| Variable                      | Meaning                                                                    |
| ----------------------------- | -------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Collector base URL, for example `http://otel-collector:4318`. Unset = off. |
| `OTEL_TRACES_SAMPLE_RATIO`    | Share of new traces kept, 0 to 1. Default `0.05`.                          |
| `OTEL_SERVICE_NAME`           | Default `hay-server`.                                                      |
| `OTEL_EXPORTER_OTLP_HEADERS`  | Optional `key=value,...` sent to the collector (auth). Treat as a secret.  |

The exporter speaks OTLP over HTTP (`/v1/traces`). Restart the server after changing
any of these.

**What is traced:** each HTTP request (a new trace per request; inbound trace
headers are ignored), each tRPC procedure, queue publish and consume (the trace
context travels in the RabbitMQ message headers `traceparent`/`tracestate`), the
orchestrator turn with its perception, retrieval and execution layers, LLM chat
calls, and plugin tool calls.

**What is never exported:** message text, emails, tokens, request URLs, tool
arguments or results, error messages. Attribute names come from a fixed allowlist
in `server/lib/tracing.ts`, values are cut short and checked for emails and
credentials, and errors record only their class name. Plugin workers are separate
processes that receive no tracing code or `OTEL_*` variables.

### Running the collector (not deployed by the application)

Any OTLP-capable collector works. A minimal OpenTelemetry Collector config that
receives OTLP/HTTP on the internal network and forwards to a trace backend:

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
processors:
  batch: {}
exporters:
  otlp:
    endpoint: <backend-host>:4317
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp]
```

Run it as its own compose service on the same network as the server and keep port
4318 off the public interface. If the collector is down the server keeps working:
spans are queued (512 at most) and then dropped.

To turn tracing off again, unset `OTEL_EXPORTER_OTLP_ENDPOINT` and restart.

## SLOs

| SLO           | Indicator                                                                                                                          | Objective (28 days) |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Reply latency | Orchestrator turns finishing within 60 s: `hay_reply_turn_seconds_bucket{le="60"}` over `_count`                                   | 95% of turns        |
| Delivery      | Delivery attempts that end `delivered` or `retry`, not `failed`: `hay_delivery_attempts_total`                                     | 99% of attempts     |
| Queue age     | Messages received within 30 s of publish on `orchestrator.process` and `channel.deliver`: `hay_queue_wait_seconds_bucket{le="30"}` | 99% of messages     |

The reply-latency indicator covers the turn once a worker picks it up; time spent
waiting in the queue is the queue-age SLO.

## Alert rules (Prometheus)

```yaml
groups:
  - name: hay-slo
    rules:
      - alert: HayReplyLatencySlow
        expr: |
          1 - (
            sum(rate(hay_reply_turn_seconds_bucket{le="60"}[30m]))
            / sum(rate(hay_reply_turn_seconds_count[30m]))
          ) > 0.10
        for: 15m
        labels: { severity: page }
        annotations:
          summary: More than 10% of AI turns took over 60 s
          runbook: runbooks/rabbitmq-down.md

      - alert: HayDeliveryFailing
        expr: |
          sum(rate(hay_delivery_attempts_total{outcome="failed"}[30m]))
          / sum(rate(hay_delivery_attempts_total[30m])) > 0.05
        for: 15m
        labels: { severity: page }
        annotations:
          summary: More than 5% of channel delivery attempts end in failure

      - alert: HayQueueWaitHigh
        expr: |
          1 - (
            sum by (queue) (rate(hay_queue_wait_seconds_bucket{le="30",queue=~"orchestrator.process|channel.deliver"}[15m]))
            / sum by (queue) (rate(hay_queue_wait_seconds_count{queue=~"orchestrator.process|channel.deliver"}[15m]))
          ) > 0.05
        for: 10m
        labels: { severity: page }
        annotations:
          summary: Over 5% of messages waited more than 30 s in {{ $labels.queue }}
          runbook: runbooks/rabbitmq-down.md

      - alert: HayDeadLetters
        expr: increase(hay_dead_letters_total[15m]) > 0
        labels: { severity: ticket }
        annotations:
          summary: Work used up its retries
```

The burn-rate windows are deliberately simple for a single small host. Tighten
them once there is a month of data.
