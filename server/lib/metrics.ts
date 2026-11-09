import { monitorEventLoopDelay } from "node:perf_hooks";

/**
 * Prometheus metrics, rendered in the text exposition format. Label values
 * must come from a small fixed set (queue and job names, outcomes), never from
 * ids or user input, so the number of series stays bounded.
 */

type Labels = Record<string, string>;
type Sample = { labels?: Labels; value: number };
type Collect = () => number | Sample[] | Promise<number | Sample[]>;
type Metric = { name: string; help: string; type: string; samples: () => Promise<Sample[]> };

const registry: Metric[] = [];

class Counter {
  private readonly series = new Map<string, Sample>();

  inc(labels: Labels = {}, by = 1): void {
    const key = JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)));
    const sample = this.series.get(key) ?? { labels, value: 0 };
    sample.value += by;
    this.series.set(key, sample);
  }

  value(labels: Labels = {}): number {
    const key = JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)));
    return this.series.get(key)?.value ?? 0;
  }

  samples(): Sample[] {
    return [...this.series.values()];
  }
}

function counter(name: string, help: string): Counter {
  const instance = new Counter();
  registry.push({ name, help, type: "counter", samples: async () => instance.samples() });
  return instance;
}

/** A metric read at scrape time. A collector that throws leaves its samples out. */
export function registerCollector(
  name: string,
  help: string,
  collect: Collect,
  type: "gauge" | "counter" = "gauge",
): void {
  const existing = registry.findIndex((metric) => metric.name === name);
  if (existing !== -1) registry.splice(existing, 1);
  registry.push({
    name,
    help,
    type,
    samples: async () => {
      const result = await collect();
      return typeof result === "number" ? [{ value: result }] : result;
    },
  });
}

export const metrics = {
  httpRequests: counter("hay_http_requests_total", "HTTP responses by status class."),
  queuePublished: counter("hay_queue_published_total", "Messages published, by queue and outcome."),
  queueConsumed: counter("hay_queue_consumed_total", "Messages handed to a consumer, by queue."),
  queueNacked: counter("hay_queue_nacked_total", "Messages rejected by a consumer, by queue."),
  deadLetters: counter("hay_dead_letters_total", "Work that used up its retries, by queue."),
  redisUnavailable: counter(
    "hay_redis_unavailable_total",
    "Checks made without Redis, by surface and action taken.",
  ),
  schedulerRuns: counter("hay_scheduler_runs_total", "Scheduled job runs, by job and status."),
  auditSinkDeliveries: counter(
    "hay_audit_sink_deliveries_total",
    "Audit entries sent to the external sink, by outcome.",
  ),
  auditWriteFailures: counter(
    "hay_audit_write_failures_total",
    "Audit entries that failed to save.",
  ),
};

const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });

/** Node process health. Call once, from the process that serves metrics. */
export function registerProcessMetrics(): void {
  eventLoopDelay.enable();
  registerCollector(
    "process_cpu_seconds_total",
    "User and system CPU time spent.",
    () => {
      const { user, system } = process.cpuUsage();
      return (user + system) / 1e6;
    },
    "counter",
  );
  registerCollector(
    "process_resident_memory_bytes",
    "Resident memory size.",
    () => process.memoryUsage().rss,
  );
  registerCollector(
    "nodejs_heap_used_bytes",
    "V8 heap in use.",
    () => process.memoryUsage().heapUsed,
  );
  registerCollector("process_uptime_seconds", "Seconds since the process started.", () =>
    process.uptime(),
  );
  registerCollector("nodejs_eventloop_lag_p99_seconds", "99th percentile event loop delay.", () => {
    const seconds = eventLoopDelay.percentile(99) / 1e9;
    eventLoopDelay.reset();
    return seconds;
  });
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function formatSample(name: string, { labels, value }: Sample): string {
  const pairs = Object.entries(labels ?? {}).map(([k, v]) => `${k}="${escapeLabel(v)}"`);
  return `${name}${pairs.length ? `{${pairs.join(",")}}` : ""} ${value}`;
}

export async function renderMetrics(): Promise<string> {
  const blocks = await Promise.all(
    registry.map(async ({ name, help, type, samples }) => {
      const rows = await samples().catch(() => []);
      return [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`]
        .concat(rows.map((row) => formatSample(name, row)))
        .join("\n");
    }),
  );
  return `${blocks.join("\n")}\n`;
}
