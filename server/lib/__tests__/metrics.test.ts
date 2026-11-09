import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { currentRequestId } from "../logger";
import { metrics, registerCollector, renderMetrics } from "../metrics";
import { createMetricsHandler, startMetricsServer } from "../metrics-server";
import { requestContext } from "../request-context";

async function listen(handler: http.RequestListener): Promise<{ url: string; close: () => void }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}

describe("metrics rendering", () => {
  it("renders counters with labels in the Prometheus text format", async () => {
    metrics.queuePublished.inc({ queue: "render.test", outcome: "ok" });
    metrics.queuePublished.inc({ outcome: "ok", queue: "render.test" }, 2);

    const text = await renderMetrics();

    expect(text).toContain("# TYPE hay_queue_published_total counter");
    expect(text).toContain('hay_queue_published_total{queue="render.test",outcome="ok"} 3');
  });

  it("renders histograms with cumulative buckets, sum and count", async () => {
    metrics.queueWaitSeconds.observe({ queue: "hist.test" }, 0.3);
    metrics.queueWaitSeconds.observe({ queue: "hist.test" }, 3);

    const text = await renderMetrics();

    expect(text).toContain("# TYPE hay_queue_wait_seconds histogram");
    expect(text).toContain('hay_queue_wait_seconds_bucket{queue="hist.test",le="0.5"} 1');
    expect(text).toContain('hay_queue_wait_seconds_bucket{queue="hist.test",le="5"} 2');
    expect(text).toContain('hay_queue_wait_seconds_bucket{queue="hist.test",le="+Inf"} 2');
    expect(text).toContain('hay_queue_wait_seconds_count{queue="hist.test"} 2');
    expect(text).toContain('hay_queue_wait_seconds_sum{queue="hist.test"} 3.3');
  });

  it("escapes label values", async () => {
    registerCollector("hay_test_escape", "Escaping.", () => [
      { labels: { value: 'a"b\\c\nd' }, value: 1 },
    ]);
    expect(await renderMetrics()).toContain('hay_test_escape{value="a\\"b\\\\c\\nd"} 1');
  });

  it("leaves out a collector that fails and renders the rest", async () => {
    registerCollector("hay_test_broken", "Fails.", () => {
      throw new Error("nope");
    });
    registerCollector("hay_test_async_broken", "Fails.", async () => {
      throw new Error("nope");
    });
    metrics.auditWriteFailures.inc();

    const text = await renderMetrics();

    expect(text).not.toMatch(/^hay_test_async_broken /m);
    expect(text).toMatch(/^hay_audit_write_failures_total \d+$/m);
  });
});

describe("metrics access", () => {
  it("requires the bearer token when one is set", async () => {
    const { url, close } = await listen(createMetricsHandler("s3cret-token"));
    try {
      expect((await fetch(`${url}/metrics`)).status).toBe(401);
      expect(
        (await fetch(`${url}/metrics`, { headers: { Authorization: "Bearer wrong" } })).status,
      ).toBe(401);
      const ok = await fetch(`${url}/metrics`, {
        headers: { Authorization: "Bearer s3cret-token" },
      });
      expect(ok.status).toBe(200);
      expect(ok.headers.get("content-type")).toContain("version=0.0.4");
    } finally {
      close();
    }
  });

  it("serves only GET /metrics", async () => {
    const { url, close } = await listen(createMetricsHandler(""));
    try {
      expect((await fetch(`${url}/ready`)).status).toBe(404);
      expect((await fetch(`${url}/metrics`, { method: "POST" })).status).toBe(404);
    } finally {
      close();
    }
  });

  it("refuses a non-loopback bind without a token", () => {
    expect(startMetricsServer({ port: 9999, host: "0.0.0.0", token: "" })).toBeNull();
  });

  it("does not start when the port is 0", () => {
    expect(startMetricsServer({ port: 0, host: "127.0.0.1", token: "" })).toBeNull();
  });
});

describe("request context", () => {
  async function serve(): Promise<{ url: string; close: () => void }> {
    const app = express();
    app.use(requestContext);
    app.use(express.json());
    app.post("/echo", async (_req, res) => {
      await Promise.resolve();
      res.json({ requestId: currentRequestId() });
    });
    return listen(app);
  }

  const post = (url: string, headers: Record<string, string> = {}) =>
    fetch(`${url}/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: "{}",
    });

  it("exposes one id to the handler, past the body parser, and to the client", async () => {
    const { url, close } = await serve();
    try {
      const response = await post(url);
      const body = (await response.json()) as { requestId: string };
      expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.headers.get("x-request-id")).toBe(body.requestId);
    } finally {
      close();
    }
  });

  it("keeps a well-formed inbound id and replaces a malformed one", async () => {
    const { url, close } = await serve();
    try {
      const kept = await post(url, { "X-Request-Id": "proxy-abc-12345" });
      expect(kept.headers.get("x-request-id")).toBe("proxy-abc-12345");
      const replaced = await post(url, { "X-Request-Id": 'bad id" injected' });
      expect(replaced.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      close();
    }
  });

  it("counts responses by status class", async () => {
    const before = metrics.httpRequests.value({ status_class: "2xx" });
    const { url, close } = await serve();
    try {
      await post(url);
      await new Promise((resolve) => setImmediate(resolve));
      expect(metrics.httpRequests.value({ status_class: "2xx" })).toBe(before + 1);
    } finally {
      close();
    }
  });
});
